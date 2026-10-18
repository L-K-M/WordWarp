package ch.lkmc.wordwarp.android

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.AtomicFile
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.*
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

internal data class Preset(val id: String, val name: String, val category: String, val colors: List<String>, val animated: Boolean)
internal data class CatalogChoice(val value: String, val label: String, val category: String)
internal data class EditorLayer(val id: String, val name: String, val type: String, val visible: Boolean, val locked: Boolean)
internal data class EditorView(val tool: String = "select", val zoom: Double = 1.0, val playing: Boolean = false, val time: Double = 0.0, val duration: Double = 1.0)
internal data class NativeExport(val bytes: ByteArray, val filename: String, val mimeType: String, val width: Int, val height: Int, val frameCount: Int, val fps: Double, val reduced: Boolean)

/** Native controls use versioned metadata and commands; only the canvas is web content. */
internal class EngineSession(private val context: Context, private var resumed: JSONObject? = null) {
    var ready by mutableStateOf(false); private set
    var text by mutableStateOf(""); private set
    var presets by mutableStateOf(emptyList<Preset>()); private set
    var stamps by mutableStateOf(emptyList<CatalogChoice>()); private set
    var effectKinds by mutableStateOf(emptyList<CatalogChoice>()); private set
    var animationKinds by mutableStateOf(emptyList<CatalogChoice>()); private set
    var presetId by mutableStateOf<String?>(null); private set
    var selectedId by mutableStateOf<String?>(null); private set
    var layers by mutableStateOf(emptyList<EditorLayer>()); private set
    var inspector by mutableStateOf(emptyList<InspectorSection>()); private set
    var view by mutableStateOf(EditorView()); private set
    var documentName by mutableStateOf("Untitled warp"); private set
    var dirty by mutableStateOf(false); private set
    var canUndo by mutableStateOf(false); private set
    var canRedo by mutableStateOf(false); private set
    var revision by mutableIntStateOf(-1); private set
    var renderedRevision by mutableIntStateOf(-1); private set
    var width by mutableIntStateOf(0); private set
    var height by mutableIntStateOf(0); private set
    var fatalError by mutableStateOf<String?>(null); private set
    var notice by mutableStateOf<String?>(null)
    var exporting by mutableStateOf(false); private set
    var exportProgress by mutableDoubleStateOf(0.0); private set
    var generation by mutableIntStateOf(0); private set
    var document: JSONObject? = null; private set
    private val handler = Handler(Looper.getMainLooper())
    private val snapshot = AtomicFile(File(context.filesDir, "document-v1.json"))
    private var webView: WebView? = null
    private var destroyedView: WebView? = null
    private var exportId: String? = null
    private var exportCallback: ((NativeExport) -> Unit)? = null
    private var bridgeReady = false
    private var restoreId: String? = null
    private var restoreCallback: (() -> Unit)? = null
    private var restoreFailure: ((String) -> Unit)? = null
    private var baseline: String? = null
    private var recoveredBaseline: String? = null
    private var pendingDocumentOperation: (() -> Unit)? = null
    private var startup = true
    private var latestInspector = emptyList<InspectorSection>()
    private var acknowledgedText = ""
    private val pendingTexts = mutableListOf<String>()
    private val pendingFields = mutableMapOf<String, MutableList<Any>>()
    private val documentCallbacks = mutableMapOf<String, (JSONObject) -> Unit>()
    private var disposed = false
    private var saveSequence = 0L
    private val startupTimeout = Runnable { if (!ready) fail(context.getString(R.string.engine_timeout)) }
    private val exportTimeout = Runnable {
        if (exporting) { finishExport(); notice = "Export took too long. Try a smaller size or fewer frames." }
    }
    private val operationTimeout = Runnable {
        if (restoreId != null || documentCallbacks.isNotEmpty()) {
            restoreId = null; restoreCallback = null; documentCallbacks.clear()
            if (bridgeReady) ready = true
            val message = "The document operation did not finish. Please try again."
            val failure = restoreFailure; restoreFailure = null; failure?.invoke(message)
            notice = message
        }
    }

    companion object {
        private val storage = Executors.newSingleThreadExecutor()
        const val ENTRY = "https://appassets.androidplatform.net/assets/native.html"
        private const val MAX_MESSAGE = 68 * 1024 * 1024
        const val MAX_DOCUMENT = 8 * 1024 * 1024
        private const val MAX_EXPORT = 48 * 1024 * 1024
        fun isLocalAsset(uri: Uri): Boolean = uri.scheme == "https" &&
            uri.host == "appassets.androidplatform.net" && uri.port == -1 && uri.userInfo == null &&
            uri.path?.startsWith("/assets/") == true && !uri.path.orEmpty().split('/').contains("..")

        fun parseExport(message: JSONObject): NativeExport {
            val mime = message.getString("mimeType")
            require(mime in setOf("image/png", "image/apng", "image/gif"))
            val base64 = message.getString("base64")
            require(base64.length <= MAX_MESSAGE)
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            require(bytes.size in 24..MAX_EXPORT)
            if (mime == "image/gif") require(bytes.copyOfRange(0, 6).toString(Charsets.US_ASCII) in setOf("GIF87a", "GIF89a"))
            else require(bytes.take(8) == listOf(137, 80, 78, 71, 13, 10, 26, 10).map { it.toByte() })
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            require(options.outWidth in 1..16384 && options.outHeight in 1..16384)
            require(options.outWidth.toLong() * options.outHeight <= 67_108_864L)
            require(options.outWidth == message.getInt("width") && options.outHeight == message.getInt("height"))
            val extension = if (mime == "image/gif") "gif" else if (mime == "image/apng") "apng" else "png"
            val filename = message.optString("filename", "WordWarp.$extension").substringAfterLast('/').substringAfterLast('\\')
                .replace(Regex("[^A-Za-z0-9._ -]"), "_").take(100)
                .let { if (it.endsWith(".$extension", ignoreCase = true)) it else "WordWarp.$extension" }
            return NativeExport(bytes, filename, mime, options.outWidth, options.outHeight,
                message.optInt("frameCount", 1), message.optDouble("fps", 0.0), message.optBoolean("reduced"))
        }
        fun readBounded(input: java.io.InputStream, limit: Int): ByteArray {
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                require(output.size() + count <= limit) { "The document is too large." }
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun createWebView(viewContext: Context): WebView {
        val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()
        val nativeView = WebView(viewContext)
        webView = nativeView
        nativeView.layoutParams = android.view.ViewGroup.LayoutParams(-1, -1)
        nativeView.setBackgroundColor(android.graphics.Color.TRANSPARENT)
        nativeView.contentDescription = "Interactive artwork canvas"
        nativeView.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = false
            allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false; setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true; cacheMode = WebSettings.LOAD_NO_CACHE
            // The document renderer owns pinch/pan/selection; browser zoom would drift from it.
            setSupportZoom(false); builtInZoomControls = false; displayZoomControls = false
        }
        nativeView.addJavascriptInterface(object {
            @JavascriptInterface fun postMessage(raw: String) {
                if (raw.length > MAX_MESSAGE) return
                handler.post { if (!disposed && webView === nativeView && nativeView.url == ENTRY) receive(raw) }
            }
        }, "WordWarpAndroid")
        nativeView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !request.isForMainFrame || request.url.toString() != ENTRY
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                if (isLocalAsset(request.url)) loader.shouldInterceptRequest(request.url)?.let { return it }
                return WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(byteArrayOf()))
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame && webView === view) fail(context.getString(R.string.engine_load_failed))
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (webView === view) { fail(context.getString(R.string.engine_crashed)); webView = null }
                (view.parent as? android.view.ViewGroup)?.removeView(view)
                destroyedView = view; view.destroy()
                return true
            }
        }
        handler.postDelayed(startupTimeout, 25_000)
        nativeView.loadUrl(ENTRY)
        return nativeView
    }
    fun detach(view: WebView) {
        if (webView === view) webView = null
        if (view === destroyedView) { destroyedView = null; return }
        view.removeJavascriptInterface("WordWarpAndroid"); view.stopLoading(); view.destroy()
    }
    fun retry() {
        resumed = resumeState()
        ready = false; bridgeReady = false; startup = true
        pendingTexts.clear(); pendingFields.clear(); fatalError = null; renderedRevision = -1
        finishExport(); generation++; handler.removeCallbacks(startupTimeout)
    }
    fun command(type: String, properties: JSONObject = JSONObject()) = dispatch(properties.put("type", type))
    fun updateText(value: String) {
        if (!ready || value.length > 5000 || value == text) return
        pendingTexts.add(value); text = value; command("setText", JSONObject().put("text", value))
    }
    fun setPreset(id: String) { if (presets.any { it.id == id }) command("setPreset", JSONObject().put("presetId", id)) }
    fun select(id: String?) = command("select", JSONObject().put("elementId", id ?: JSONObject.NULL))
    fun layer(action: String, id: String) = command("layer", JSONObject().put("action", action).put("elementId", id))
    fun effect(action: String, effectId: String? = null, kind: String? = null) =
        command("effect", JSONObject().put("action", action).apply { effectId?.let { put("effectId", it) }; kind?.let { put("kind", it) } })
    fun animation(action: String, animationId: String? = null, kind: String? = null) =
        command("animation", JSONObject().put("action", action).apply { animationId?.let { put("animationId", it) }; kind?.let { put("kind", it) } })
    fun setField(id: String, value: Any) {
        if (!ready) return
        fun find(section: InspectorSection): InspectorField? = section.fields.firstOrNull { it.id == id }
            ?: section.children.firstNotNullOfOrNull(::find)
        val current = inspector.firstNotNullOfOrNull(::find) ?: return
        // No-op edits emit no JS state event, so they must never enter the ACK queue.
        if (equivalent(current.value, value)) return
        pendingFields.getOrPut(id) { mutableListOf() }.add(value)
        inspector = inspector.map { it.replaceField(id, value) }
        command("setField", JSONObject().put("fieldId", id).put("value", value))
    }
    fun inspectorAction(id: String) = command("inspectorAction", JSONObject().put("actionId", id))
    fun undo() = command("undo")
    fun redo() = command("redo")
    fun setView(tool: String? = null, zoom: Double? = null, fit: Boolean = false) = command("setView", JSONObject().apply {
        tool?.let { put("tool", it) }; zoom?.let { put("zoom", it.coerceIn(0.05, 8.0)) }; if (fit) put("fit", true)
    })
    fun playback(playing: Boolean? = null, time: Double? = null) = command("playback", JSONObject().apply {
        playing?.let { put("playing", it) }; time?.let { put("time", it.coerceIn(0.0, 1.0)) }
    })
    fun requestDocument(callback: (JSONObject) -> Unit) {
        val id = UUID.randomUUID().toString(); documentCallbacks[id] = callback
        command("getDocument", JSONObject().put("id", id)); handler.postDelayed(operationTimeout, 30_000)
    }
    fun markSaved(saved: JSONObject) { baseline = fingerprint(saved); dirty = document?.let(::fingerprint) != baseline; persistSnapshot() }
    fun restoreDocument(value: JSONObject, onSuccess: (() -> Unit)? = null, onFailure: ((String) -> Unit)? = null) {
        if (!ready) { pendingDocumentOperation = { restoreDocument(value, onSuccess, onFailure) }; return }
        pendingFields.clear(); pendingTexts.clear()
        restoreId = UUID.randomUUID().toString(); restoreCallback = onSuccess; restoreFailure = onFailure; ready = false
        command("restore", JSONObject().put("id", restoreId).put("document", value))
        handler.postDelayed(operationTimeout, 30_000)
    }
    fun newDocument() {
        if (!ready) { pendingDocumentOperation = { newDocument() }; return }
        pendingFields.clear(); pendingTexts.clear(); restoreId = UUID.randomUUID().toString(); ready = false
        command("newDocument", JSONObject().put("id", restoreId)); handler.postDelayed(operationTimeout, 30_000)
    }
    fun exportImage(format: String, scale: Int, fps: Int, callback: (NativeExport) -> Unit) {
        if (!ready || exporting || fatalError != null) return
        exportId = UUID.randomUUID().toString(); exportCallback = callback; exporting = true; exportProgress = 0.0; notice = null
        command("export", JSONObject().put("id", exportId).put("format", format).put("scale", scale).put("fps", fps))
        handler.postDelayed(exportTimeout, 120_000)
    }
    fun exportPng(scale: Int = 2, callback: (NativeExport) -> Unit) = exportImage("png", scale, 12, callback)
    fun resumeState(): JSONObject = JSONObject().put("selectedId", selectedId ?: JSONObject.NULL)
        .put("text", if (pendingTexts.isNotEmpty()) text else JSONObject.NULL)
        .put("fields", JSONObject().apply { pendingFields.forEach { (id, values) -> if (values.isNotEmpty()) put(id, values.last()) } })

    private fun dispatch(command: JSONObject) {
        if (bridgeReady && fatalError == null) webView?.evaluateJavascript("window.wordwarp.dispatch($command);", null)
    }
    private fun receive(raw: String) {
        try {
            val event = JSONObject(raw)
            when (event.getString("type")) {
                "ready" -> {
                    check(event.getInt("version") == 2)
                    handler.removeCallbacks(startupTimeout)
                    presets = event.getJSONArray("presets").objects().map { item ->
                        val colors = item.getJSONArray("preview")
                        Preset(item.getString("id"), item.getString("name"), item.getString("category"),
                            (0 until colors.length()).map { colors.getString(it) }, item.getBoolean("animated"))
                    }
                    fun choices(name: String) = event.optJSONArray(name).objects().map { CatalogChoice(it.getString("value"), it.getString("label"), it.optString("category")) }
                    stamps = choices("stamps"); effectKinds = choices("effectKinds"); animationKinds = choices("animationKinds")
                    applyState(event.getJSONObject("state"), false); bridgeReady = true; restoreSaved()
                }
                "state" -> applyState(event.getJSONObject("state"), true)
                "view" -> view = parseView(event.getJSONObject("view"))
                "rendered" -> { renderedRevision = event.getInt("revision"); width = event.getInt("width"); height = event.getInt("height") }
                "restored" -> if (event.optString("id") == restoreId) {
                    restoreId = null; handler.removeCallbacks(operationTimeout)
                    baseline = if (startup) recoveredBaseline ?: "" else document?.let(::fingerprint)
                    dirty = document?.let(::fingerprint) != baseline
                    ready = true
                    if (startup) { startup = false; applyResumed() }
                    persistSnapshot()
                    val callback = restoreCallback; restoreCallback = null; restoreFailure = null; callback?.invoke()
                    completeStartupOperation()
                }
                "document" -> documentCallbacks.remove(event.getString("id"))?.invoke(event.getJSONObject("document"))
                "exportProgress" -> if (event.optString("id") == exportId) {
                    exportProgress = event.optDouble("progress", 0.0).coerceIn(0.0, 1.0)
                    handler.removeCallbacks(exportTimeout); handler.postDelayed(exportTimeout, 120_000)
                }
                "export" -> {
                    if (!exporting || event.optString("id") != exportId) return
                    val result = try { parseExport(event) } catch (_: Exception) { finishExport(); notice = "The renderer returned an invalid image."; return }
                    val callback = exportCallback; finishExport(); callback?.invoke(result)
                }
                "error" -> {
                    val id = event.optString("id").takeIf { it.isNotEmpty() }
                    if (id == null || id == exportId) finishExport()
                    if (id == restoreId || (id == null && restoreId != null)) {
                        restoreId = null; restoreCallback = null; ready = true; startup = false
                        val failure = restoreFailure; restoreFailure = null
                        failure?.invoke(event.optString("message", context.getString(R.string.invalid_bridge)))
                    }
                    if (id != null) documentCallbacks.remove(id)
                    pendingFields.clear(); pendingTexts.clear(); inspector = latestInspector; text = acknowledgedText
                    notice = event.optString("message", context.getString(R.string.invalid_bridge)).take(1000)
                    if (ready) completeStartupOperation()
                }
            }
        } catch (_: Exception) {
            finishExport()
            if (!ready) fail(context.getString(R.string.invalid_bridge)) else notice = context.getString(R.string.invalid_bridge)
        }
    }
    private fun parseView(value: JSONObject) = EditorView(value.optString("tool", "select"), value.optDouble("zoom", 1.0),
        value.optBoolean("playing"), value.optDouble("time", 0.0), value.optDouble("duration", 1.0))
    private fun applyState(state: JSONObject, persist: Boolean) {
        val newText = state.getString("text"); require(newText.length <= 5000); acknowledgedText = newText
        val newId = state.optString("selectedElementId").takeUnless { state.isNull("selectedElementId") || it.isEmpty() }
        if (newId != selectedId) pendingTexts.clear()
        selectedId = newId
        if (pendingTexts.firstOrNull() == newText) pendingTexts.removeAt(0)
        if (pendingTexts.isEmpty()) text = newText
        presetId = state.optString("presetId").takeUnless { state.isNull("presetId") || it.isEmpty() }
        canUndo = state.getBoolean("canUndo"); canRedo = state.getBoolean("canRedo"); revision = state.getInt("revision")
        layers = state.getJSONArray("layers").objects().map { EditorLayer(it.getString("id"), it.getString("name"), it.getString("type"), it.getBoolean("visible"), it.getBoolean("locked")) }
        latestInspector = state.getJSONArray("inspector").objects().map { it.inspectorSection() }
        inspector = latestInspector.map { it.acknowledgeFields() }
        view = parseView(state.getJSONObject("view"))
        val doc = state.getJSONObject("document"); document = doc; documentName = doc.optString("name", "Untitled warp")
        if (baseline == null && !startup) baseline = fingerprint(doc)
        dirty = fingerprint(doc) != baseline
        if (persist) persistSnapshot()
        if (ready && !startup && resumed != null) applyResumed()
    }
    private fun fingerprint(value: JSONObject): String = java.security.MessageDigest.getInstance("SHA-256")
        .digest(canonicalJson(value).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    private fun canonicalJson(value: Any?): String = when (value) {
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { JSONObject.quote(it) + ":" + canonicalJson(value.get(it)) }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonicalJson(value.get(it)) }
        is Number -> JSONObject.numberToString(value)
        is Boolean -> value.toString()
        null, JSONObject.NULL -> "null"
        else -> JSONObject.quote(value.toString())
    }
    private fun persistSnapshot() {
        val doc = document ?: return
        val saved = JSONObject().put("document", doc).put("presetId", presetId ?: JSONObject.NULL)
            .put("selectedId", selectedId ?: JSONObject.NULL).put("baseline", baseline ?: JSONObject.NULL).toString()
        if (saved.length > MAX_DOCUMENT) { notice = context.getString(R.string.autosave_failed); return }
        val sequence = ++saveSequence
        storage.execute {
            var stream: java.io.FileOutputStream? = null
            try { stream = snapshot.startWrite(); stream.write(saved.toByteArray(Charsets.UTF_8)); snapshot.finishWrite(stream) }
            catch (_: Exception) { snapshot.failWrite(stream); handler.post { if (!disposed && sequence == saveSequence) notice = context.getString(R.string.autosave_failed) } }
        }
    }
    private fun completeStartupOperation() {
        // A queued Open/New must follow the restored selection and native draft
        // commands, so an old draft cannot later apply to the replacement document.
        if (!ready || resumed != null) return
        val operation = pendingDocumentOperation; pendingDocumentOperation = null; operation?.invoke()
    }
    private fun InspectorSection.acknowledgeFields(): InspectorSection = copy(fields = fields.map { field ->
        val queue = pendingFields[field.id]
        if (queue != null && queue.isNotEmpty() && equivalent(queue.first(), field.value)) queue.removeAt(0)
        if (queue.isNullOrEmpty()) { pendingFields.remove(field.id); field } else field.copy(value = queue.last())
    }, children = children.map { it.acknowledgeFields() })
    private fun InspectorSection.replaceField(id: String, value: Any): InspectorSection = copy(
        fields = fields.map { if (it.id == id) it.copy(value = value) else it }, children = children.map { it.replaceField(id, value) })
    private fun equivalent(a: Any?, b: Any?): Boolean = when {
        a is Number && b is Number -> a.toDouble() == b.toDouble()
        a is JSONArray && b is JSONArray -> a.length() == b.length() && (0 until a.length()).all { equivalent(a.get(it), b.get(it)) }
        else -> a == b
    }
    private fun restoreSaved() {
        val loadGeneration = generation
        storage.execute {
            val saved = try {
                if (snapshot.baseFile.exists() || File(snapshot.baseFile.path + ".bak").exists()) snapshot.openRead().use { JSONObject(readBounded(it, MAX_DOCUMENT).toString(Charsets.UTF_8)) } else null
            } catch (_: Exception) { handler.post { if (!disposed) notice = context.getString(R.string.restore_failed) }; null }
            handler.post {
                if (!disposed && loadGeneration == generation) {
                    if (saved != null) {
                        recoveredBaseline = saved.optString("baseline").takeUnless { saved.isNull("baseline") || it.isEmpty() }
                        if (resumed == null && !saved.isNull("selectedId")) resumed = JSONObject().put("selectedId", saved.getString("selectedId"))
                        restoreId = UUID.randomUUID().toString()
                        dispatch(JSONObject().put("type", "restore").put("id", restoreId).put("document", saved.getJSONObject("document")).put("presetId", saved.opt("presetId") ?: JSONObject.NULL))
                        handler.postDelayed(operationTimeout, 30_000)
                    } else { baseline = document?.let(::fingerprint); dirty = false; ready = true; startup = false; applyResumed(); completeStartupOperation() }
                }
            }
        }
    }
    private fun applyResumed() {
        val draft = resumed ?: return
        val id = draft.optString("selectedId").takeUnless { draft.isNull("selectedId") }
        if (id != null && layers.any { it.id == id } && selectedId != id) {
            // Selection updates its contextual inspector asynchronously. Keep the
            // draft until that state arrives, or its fields are not present yet.
            select(id)
            return
        }
        resumed = null
        if (!draft.isNull("text")) updateText(draft.getString("text"))
        draft.optJSONObject("fields")?.let { fields -> fields.keys().forEach { key -> setField(key, fields.get(key)) } }
        completeStartupOperation()
    }
    private fun finishExport() { exporting = false; exportId = null; exportCallback = null; handler.removeCallbacks(exportTimeout) }
    private fun fail(message: String) { fatalError = message; ready = false; bridgeReady = false; pendingFields.clear(); pendingTexts.clear(); finishExport(); handler.removeCallbacks(startupTimeout) }
    fun close() { disposed = true; handler.removeCallbacksAndMessages(null) }
}
