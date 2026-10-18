package ch.lkmc.wordwarp.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

internal data class NativeSaveRequest(val filename: String, val mimeType: String)
internal data class NativeSaveCompletion(val document: JSONObject?, val continuation: String?)
internal class CreateNativeFile : ActivityResultContract<NativeSaveRequest, Uri?>() {
    override fun createIntent(context: Context, input: NativeSaveRequest): Intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE).setType(input.mimeType).putExtra(Intent.EXTRA_TITLE, input.filename)
    override fun parseResult(resultCode: Int, intent: Intent?): Uri? = if (resultCode == android.app.Activity.RESULT_OK) intent?.data else null
}

/** Pending deliveries survive the native system picker, including process recreation. */
internal class ExportDelivery(private val savedState: SavedStateHandle) : ViewModel() {
    var busy by mutableStateOf(false)
    private var path by mutableStateOf(savedState.get<String>("pendingFile"))
    var pendingPath: String?
        get() = path
        set(value) { path = value; savedState["pendingFile"] = value }
    var kind: String
        get() = savedState["kind"] ?: "image"
        set(value) { savedState["kind"] = value }
    var continuation: String?
        get() = savedState["continuation"]
        set(value) { savedState["continuation"] = value }
    var message by mutableStateOf<String?>(null)
    var openedDocument by mutableStateOf<JSONObject?>(null); private set
    var opening by mutableStateOf(false); private set
    private var openingJob: Job? = null
    fun open(uri: Uri, context: Context) {
        savedState["openUri"] = uri.toString()
        openedDocument = null
        resumeOpen(context)
    }
    fun resumeOpen(context: Context) {
        val uri = savedState.get<String>("openUri")?.let(Uri::parse) ?: return
        if (openingJob != null || openedDocument != null) return
        opening = true; busy = true
        // The ViewModel owns the provider read so recreation cannot consume the
        // Activity result and then cancel its file operation on the old Activity.
        openingJob = viewModelScope.launch {
            try {
                openedDocument = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use {
                        JSONObject(EngineSession.readBounded(it, EngineSession.MAX_DOCUMENT).toString(Charsets.UTF_8))
                    } ?: error("The selected file could not be opened.")
                }
            } catch (error: Exception) { finishOpen(null, "Could not open the document: ${error.localizedMessage.orEmpty()}") }
            finally { openingJob = null }
        }
    }
    fun finishOpen(document: JSONObject?, error: String? = null) {
        if (document != null && openedDocument !== document) return
        openedDocument = null; savedState["openUri"] = null
        opening = false; busy = false; message = error ?: "Document opened"
    }
    var pendingRequest by mutableStateOf(savedState.get<String>("requestName")?.let { NativeSaveRequest(it, savedState["requestMime"] ?: "application/octet-stream") }); private set
    var completedSave by mutableStateOf<NativeSaveCompletion?>(null); private set
    private var savingJob: Job? = null
    fun prepare(bytes: ByteArray, filename: String, mime: String, kind: String, continuation: String?, context: Context) {
        busy = true
        viewModelScope.launch {
            try {
                val file = withContext(Dispatchers.IO) { File.createTempFile("wordwarp-", ".tmp", context.cacheDir).apply { writeBytes(bytes) } }
                this@ExportDelivery.kind = kind; this@ExportDelivery.continuation = continuation; pendingPath = file.absolutePath
                savedState["requestName"] = filename; savedState["requestMime"] = mime
                pendingRequest = NativeSaveRequest(filename, mime)
            } catch (error: Exception) { failSave("Could not prepare the file: ${error.localizedMessage.orEmpty()}") }
        }
    }
    fun consumeRequest() { pendingRequest = null; savedState["requestName"] = null; savedState["requestMime"] = null }
    fun receiveSave(uri: Uri?, context: Context) {
        if (uri == null) { failSave("Save cancelled"); return }
        savedState["writeUri"] = uri.toString()
        resumeSave(context)
    }
    fun resumeSave(context: Context) {
        val uri = savedState.get<String>("writeUri")?.let(Uri::parse) ?: return
        if (savingJob != null || completedSave != null) return
        val file = pendingPath?.let(::File)
        if (file == null || !file.isFile) { failSave("The temporary file is no longer available. Please export again."); return }
        busy = true
        val alreadyCopied = savedState.get<Boolean>("copied") == true
        savingJob = viewModelScope.launch {
            try {
                val document = withContext(Dispatchers.IO) {
                    if (!alreadyCopied) context.contentResolver.openOutputStream(uri, "wt")?.use { output -> file.inputStream().use { it.copyTo(output) } }
                        ?: error("The selected location could not be opened.")
                    if (kind == "document") JSONObject(file.readText()) else null
                }
                savedState["copied"] = true
                completedSave = NativeSaveCompletion(document, continuation)
            } catch (error: Exception) { failSave("Could not save: ${error.localizedMessage.orEmpty()}") }
            finally { savingJob = null }
        }
    }
    fun acknowledgeSave(result: NativeSaveCompletion) {
        if (completedSave !== result) return
        val message = if (result.document != null) "Document saved" else "Image saved"
        clearSave(); this.message = message
    }
    fun failSave(message: String) { clearSave(); this.message = message }
    private fun clearSave() {
        pendingPath?.let(::File)?.delete(); pendingPath = null; continuation = null
        savedState["writeUri"] = null; savedState["copied"] = null
        consumeRequest(); completedSave = null; busy = false
    }

}

class MainActivity : ComponentActivity() {
    internal lateinit var engine: EngineSession
        private set
    internal val delivery: ExportDelivery by viewModels()
    private val openDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) delivery.open(uri, applicationContext)
    }
    private val saveFile = registerForActivityResult(CreateNativeFile()) { uri ->
        delivery.receiveSave(uri, applicationContext)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val resumed = savedInstanceState?.getString("editorDraft")?.let { runCatching { JSONObject(it) }.getOrNull() }
        engine = EngineSession(applicationContext, resumed)
        delivery.resumeOpen(applicationContext)
        delivery.resumeSave(applicationContext)
        setContent {
            WordWarpTheme {
                val notice = delivery.message
                LaunchedEffect(notice) { if (notice != null) { engine.notice = notice; delivery.message = null } }
                val opened = delivery.openedDocument
                LaunchedEffect(engine, opened) {
                    if (opened != null) engine.restoreDocument(opened,
                        onSuccess = { delivery.finishOpen(opened) },
                        onFailure = { delivery.finishOpen(opened, it) })
                }
                val lifecycleState by lifecycle.currentStateFlow.collectAsState()
                val request = delivery.pendingRequest
                LaunchedEffect(request, lifecycleState) {
                    if (request != null && lifecycleState.isAtLeast(Lifecycle.State.RESUMED)) {
                        delivery.consumeRequest()
                        try { saveFile.launch(request) } catch (error: Exception) { delivery.failSave("Could not open the file picker: ${error.localizedMessage.orEmpty()}") }
                    }
                }
                val completed = delivery.completedSave
                LaunchedEffect(completed, lifecycleState, engine.ready) {
                    if (completed != null && engine.ready && lifecycleState.isAtLeast(Lifecycle.State.RESUMED)) {
                        completed.document?.let(engine::markSaved)
                        delivery.acknowledgeSave(completed)
                        when (completed.continuation) { "new" -> engine.newDocument(); "open" -> launchOpenDocument() }
                    }
                }
                NativeEditorScreen(engine, delivery.busy || delivery.pendingPath != null, delivery.opening,
                    onOpenDocument = ::launchOpenDocument,
                    onSaveDocument = ::saveDocument,
                    onExport = ::export)
            }
        }
    }
    private fun launchOpenDocument() = openDocument.launch(arrayOf("application/json", "application/octet-stream", "*/*"))
    private fun saveDocument(continuation: String? = null) {
        engine.requestDocument { document ->
            val name = document.optString("name", "WordWarp").replace(Regex("[^A-Za-z0-9._ -]"), "_").take(80).ifBlank { "WordWarp" }
            deliver(document.toString(2).toByteArray(), "$name.wordwarp", "application/vnd.wordwarp+json", "document", continuation)
        }
    }
    private fun export(format: String, scale: Int, fps: Int) {
        engine.exportImage(format, scale, fps) { image ->
            if (image.reduced) delivery.message = "Animation adjusted to ${formatNumber(image.fps)} fps to fit the export budget."
            deliver(image.bytes, image.filename, image.mimeType, "image", null)
        }
    }
    private fun deliver(bytes: ByteArray, filename: String, mime: String, kind: String, continuation: String?) =
        delivery.prepare(bytes, filename, mime, kind, continuation, applicationContext)
    override fun onSaveInstanceState(outState: Bundle) {
        if (engine.ready) outState.putString("editorDraft", engine.resumeState().toString())
        super.onSaveInstanceState(outState)
    }
    override fun onDestroy() { engine.close(); super.onDestroy() }
}

@Composable
internal fun WordWarpTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    val colors = when {
        Build.VERSION.SDK_INT >= 31 -> if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> darkColorScheme(primary = Color(0xFFB9C3FF), secondary = Color(0xFFDDC1FA))
        else -> lightColorScheme(primary = Color(0xFF4056B5), secondary = Color(0xFF71558C))
    }
    MaterialTheme(colorScheme = colors, content = content)
}
