package app.wordwarp.android

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.graphics.Rect
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class NativeEditorTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val engine get() = compose.activity.engine
    private val automation get() = InstrumentationRegistry.getInstrumentation().uiAutomation
    private fun fields(section: InspectorSection): List<InspectorField> = section.fields + section.children.flatMap(::fields)
    private fun field(label: String) = engine.inspector.flatMap(::fields).first { it.label == label }
    private fun section(category: String) = engine.inspector.first { it.category == category }
    private fun waitForCanvas() {
        compose.waitUntil(60_000) { engine.ready && engine.renderedRevision >= 0 && engine.renderedRevision == engine.revision }
        assertNull(engine.fatalError)
    }
    private fun freshDocument() {
        waitForCanvas()
        val oldId = engine.selectedId
        compose.runOnIdle { engine.newDocument() }
        compose.waitUntil(20_000) { engine.selectedId != oldId && engine.layers.size == 1 }
        waitForCanvas()
    }
    private fun hideKeyboard() {
        compose.runOnIdle {
            (compose.activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                .hideSoftInputFromWindow(compose.activity.window.decorView.windowToken, 0)
            compose.activity.currentFocus?.clearFocus()
        }
        compose.waitForIdle()
    }
    private fun menu(label: String) {
        hideKeyboard()
        compose.onNodeWithContentDescription("Document menu").performClick()
        compose.onNodeWithText(label).performClick()
    }
    private fun chooseCatalog(kind: String) {
        compose.onNodeWithTag("catalog-search").performTextReplacement((engine.stamps + engine.effectKinds + engine.animationKinds).first { it.value == kind }.label)
        compose.onNodeWithTag("catalog-$kind").performClick()
        hideKeyboard()
    }
    private fun waitForFiles() {
        try { compose.waitUntil(30_000) { automation.rootInActiveWindow?.packageName?.toString()?.contains("documentsui") == true } }
        catch (failure: Throwable) {
            val root = automation.rootInActiveWindow
            fun texts(node: android.view.accessibility.AccessibilityNodeInfo?): List<String> = if (node == null) emptyList() else
                listOfNotNull(node.text?.toString()) + (0 until node.childCount).flatMap { texts(node.getChild(it)) }
            throw AssertionError("Picker absent: ready=${engine.ready} dirty=${engine.dirty} notice=${engine.notice} layers=${engine.layers.size} doc=${engine.documentName} busy=${compose.activity.delivery.busy} opening=${compose.activity.delivery.opening} window=${root?.packageName} texts=${texts(root)}", failure)
        }
    }
    private fun clickSystemText(text: String) {
        compose.waitUntil(15_000) {
            automation.rootInActiveWindow?.findAccessibilityNodeInfosByText(text)?.any { it.text?.toString() == text } == true
        }
        val node = automation.rootInActiveWindow.findAccessibilityNodeInfosByText(text).first { it.text?.toString() == text }
        val bounds = Rect(); node.getBoundsInScreen(bounds)
        assertFalse("System file control should have visible bounds: $text", bounds.isEmpty)
        // Use Android's real finger tap and wait for it to finish. The basic
        // MotionEvent overload leaves toolType UNKNOWN, which DocumentsUI ignores.
        automation.executeShellCommand("input tap ${bounds.centerX()} ${bounds.centerY()}").use { descriptor ->
            FileInputStream(descriptor.fileDescriptor).use { it.readBytes() }
        }
    }

    @Test fun compactStackHeadersToggleWithoutOpeningAndCollapseWithoutSpace() {
        freshDocument()
        compose.runOnIdle { engine.animation("add", kind = "pulse") }
        compose.waitUntil(20_000) { section("animation").children.isNotEmpty() }
        for (category in listOf("effects", "animation")) {
            compose.onNodeWithTag("tool-$category").performClick()
            val entry = if (category == "effects") section(category).children.last() else section(category).children.first()
            val enabled = entry.fields.first { it.id.endsWith("/enabled") }
            val parameter = entry.fields.first { it.type == "number" }
            val card = "stack-card-${entry.id}"
            val header = "stack-${entry.id}"
            val toggle = "stack-enabled-${entry.id}"
            compose.onNodeWithTag("stack-list").performScrollToNode(hasTestTag(header))
            val collapsed = compose.onNodeWithTag(card).fetchSemanticsNode().boundsInRoot
            val checkbox = compose.onNodeWithTag(toggle).fetchSemanticsNode().boundsInRoot
            val title = compose.onNodeWithTag(header).fetchSemanticsNode().boundsInRoot
            val actions = compose.onNodeWithTag("stack-actions-${entry.id}").fetchSemanticsNode().boundsInRoot
            assertEquals("Collapsed card contains only its touch-sized header", title.height, collapsed.height, 2f)
            assertEquals("Checkbox and disclosure share one row", checkbox.center.y, title.center.y, 2f)
            assertEquals("Actions share the header row", checkbox.center.y, actions.center.y, 2f)
            File(compose.activity.getExternalFilesDir(null), "compact-$category.png").outputStream().use {
                compose.onNodeWithTag("stack-list").captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            compose.onNodeWithTag(toggle).performClick()
            compose.waitUntil(20_000) { section(category).children.first { it.id == entry.id }.fields.first { it.id == enabled.id }.value == false }
            compose.onNodeWithTag("input-${parameter.id}").assertDoesNotExist()
            compose.onNodeWithTag(header).performClick()
            compose.onNodeWithTag("field-${enabled.id}").assertDoesNotExist()
            compose.onNodeWithTag("input-${parameter.id}").assertExists()
            compose.onNodeWithTag("stack-list").performScrollToNode(hasTestTag(header))
            compose.onNodeWithTag(header).performClick()
            compose.onNodeWithTag("input-${parameter.id}").assertDoesNotExist()
            assertEquals("Collapse removes the entire field body", collapsed.height,
                compose.onNodeWithTag(card).fetchSemanticsNode().boundsInRoot.height, 2f)
            compose.onNodeWithTag(toggle).performClick()
            compose.waitUntil(20_000) { section(category).children.first { it.id == entry.id }.fields.first { it.id == enabled.id }.value == true }
        }
    }

    @Test fun fullNativeControlsDocumentRoundTripAndRecreation() {
        freshDocument()
        // A bridge render event alone missed a real Compose clipping regression.
        compose.waitUntil(10_000) {
            val pixels = compose.onNodeWithTag("canvas").captureToImage().toPixelMap()
            val colors = mutableSetOf<androidx.compose.ui.graphics.Color>()
            for (y in 8 until pixels.height - 8 step 9) for (x in 8 until pixels.width - 8 step 9) colors.add(pixels[x, y])
            colors.size > 32
        }
        val content = field("Content").id
        compose.onNodeWithTag("field-$content").performTextReplacement("ANDROID \"PRO\" \\ ✨")
        compose.waitUntil(20_000) { field("Content").value == "ANDROID \"PRO\" \\ ✨" }
        hideKeyboard()
        compose.onNodeWithTag("tool-styles").performClick()
        compose.onNodeWithTag("style-search").performTextReplacement("Gold Bar")
        compose.onNodeWithTag("preset-${engine.presets.first { it.name == "Gold Bar" }.id}").performClick()
        hideKeyboard()
        try { compose.waitUntil(20_000) { engine.presets.firstOrNull { it.id == engine.presetId }?.name == "Gold Bar" } }
        catch (failure: Throwable) { throw AssertionError("Preset=${engine.presetId}, selected=${engine.selectedId}, text=${engine.text}, notice=${engine.notice}, fields=${field("Content").value}", failure) }
        waitForCanvas()
        // Actual native binding stays current while old asynchronous state echoes arrive.
        compose.runOnIdle {
            engine.setField(content, "A"); engine.setField(content, "AN"); engine.setField(content, "ANDROID PRO")
        }
        compose.waitUntil(20_000) { engine.text == "ANDROID PRO" }
        compose.onNodeWithTag("field-$content").assertTextContains("ANDROID PRO")
        val font = field("Font family")
        val otherFont = font.options.first { it.value != font.value }.value
        compose.runOnIdle { engine.setField(font.id, font.value!!); engine.setField(font.id, otherFont) }
        compose.waitUntil(20_000) { field("Font family").value == otherFont }
        compose.runOnIdle { engine.undo() }
        compose.waitUntil(20_000) { field("Font family").value == font.value }

        compose.onNodeWithTag("tool-effects").performClick()
        compose.onNodeWithTag("add-effect").performClick()
        chooseCatalog("outerGlow")
        compose.waitUntil(20_000) { section("effects").children.any { it.label == "Outer Glow" } }
        val glow = section("effects").children.last { it.label == "Outer Glow" }
        compose.onNodeWithTag("stack-list").performScrollToNode(hasTestTag("stack-${glow.id}"))
        compose.onNodeWithTag("stack-${glow.id}").performClick()
        val sizeId = glow.fields.first { it.label == "Size" }.id
        compose.onNodeWithTag("input-$sizeId").performScrollTo().performTextReplacement("14")
        compose.onNodeWithTag("input-$sizeId").performImeAction()
        compose.waitUntil(20_000) { (section("effects").children.first { it.id == glow.id }.fields.first { it.id == sizeId }.value as Number).toDouble() == 14.0 }
        hideKeyboard()
        val colorId = fields(glow).first { it.type == "color" }.id
        compose.onNodeWithText("Paint").performScrollTo().performClick()
        compose.onNodeWithTag("field-$colorId").performScrollTo().performClick()
        compose.onNodeWithTag("color-hex").performTextReplacement("FF4466")
        hideKeyboard()
        compose.onNodeWithText("Apply").performClick()
        compose.waitUntil(20_000) { fields(section("effects").children.first { it.id == glow.id }).first { it.id == colorId }.value.numberValues().let { it[0] == 1.0 && kotlin.math.abs(it[1] - 68.0 / 255) < 0.0001 } }

        compose.onNodeWithTag("tool-animation").performClick()
        compose.onNodeWithTag("add-animation").performClick()
        chooseCatalog("pulse")
        compose.waitUntil(20_000) { section("animation").children.isNotEmpty() }
        val track = section("animation").children.last()
        compose.onNodeWithTag("stack-${track.id}").performClick()
        val durationId = track.fields.first { it.label == "Loop duration (seconds)" }.id
        compose.onNodeWithTag("input-$durationId").performScrollTo().performTextReplacement("0.5")
        compose.onNodeWithTag("input-$durationId").performImeAction()
        hideKeyboard()
        compose.waitUntil(20_000) { engine.view.duration == 0.5 }
        compose.onNodeWithTag("playback").performClick()
        compose.waitUntil(10_000) { engine.view.playing }
        compose.onNodeWithTag("playback").performClick()
        compose.waitUntil(10_000) { !engine.view.playing }

        val textId = engine.selectedId!!
        compose.onNodeWithTag("tool-layers").performClick()
        compose.onNodeWithTag("add-stamp").performClick()
        chooseCatalog("heart")
        compose.waitUntil(20_000) { engine.layers.size == 2 }
        val stampId = engine.selectedId!!
        compose.onNodeWithContentDescription("Layer actions for ${engine.layers.first { it.id == stampId }.name}").performClick()
        compose.onNodeWithText("Duplicate").performClick()
        compose.waitUntil(20_000) { engine.layers.size == 3 }
        val duplicated = engine.selectedId!!
        compose.runOnIdle { engine.layer("back", duplicated); engine.layer("visibility", duplicated); engine.layer("lock", duplicated) }
        compose.waitUntil(20_000) { engine.layers.first().id == duplicated && engine.layers.first().locked && !engine.layers.first().visible }
        automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
        compose.waitForIdle()
        compose.runOnIdle { engine.select(textId) }
        compose.waitUntil(20_000) { engine.selectedId == textId }
        waitForCanvas()
        // File interchange uses actual Android provider streams and schema-validated restore.
        val filename = "Android QA ${System.currentTimeMillis()}"
        compose.runOnIdle { engine.setField(field("Document name").id, filename) }
        compose.waitUntil(20_000) { engine.documentName == filename }
        menu("Save document…")
        waitForFiles()
        val beforeSaveRecreation = compose.activity
        compose.activityRule.scenario.onActivity { it.recreate() }
        compose.waitUntil(30_000) { compose.activity !== beforeSaveRecreation && engine.ready }
        waitForFiles()
        clickSystemText("SAVE")
        compose.waitUntil(30_000) {
            automation.rootInActiveWindow?.packageName == "app.wordwarp.android" && engine.ready &&
                !compose.activity.delivery.busy && compose.activity.delivery.completedSave == null &&
                engine.documentName == filename && engine.layers.size == 3 && !engine.dirty
        }
        waitForCanvas()
        menu("New document")
        compose.waitUntil(20_000) { engine.layers.size == 1 && engine.selectedId != textId }
        waitForCanvas()
        assertFalse("A freshly acknowledged New document should be clean", engine.dirty)
        menu("Open document…")
        waitForFiles()
        // ActivityScenario.recreate waits for RESUMED, which cannot happen while
        // the real system picker is foreground. Request recreation without that wait.
        val beforeOpenRecreation = compose.activity
        compose.activityRule.scenario.onActivity { it.recreate() }
        compose.waitUntil(30_000) { compose.activity !== beforeOpenRecreation && engine.ready }
        waitForFiles()
        clickSystemText("$filename.wordwarp")
        try { compose.waitUntil(30_000) {
            automation.rootInActiveWindow?.packageName == "app.wordwarp.android" && engine.ready &&
                !compose.activity.delivery.opening && !compose.activity.delivery.busy &&
                engine.documentName == filename && engine.layers.size == 3
        } }
        catch (failure: Throwable) {
            automation.executeShellCommand("screencap -p /sdcard/Download/wordwarp-test-failure.png").use { descriptor ->
                FileInputStream(descriptor.fileDescriptor).use { it.readBytes() }
            }
            val root = automation.rootInActiveWindow
            val choices = root?.findAccessibilityNodeInfosByText(filename)?.map { "${it.text} clickable=${it.isClickable} selected=${it.isSelected} parent=${it.parent?.className}" }
            throw AssertionError("Open stalled: activity=${compose.activity.hashCode()} state=${compose.activityRule.scenario.state} ready=${engine.ready} notice=${engine.notice} layers=${engine.layers.size} doc=${engine.documentName} opening=${compose.activity.delivery.opening} opened=${compose.activity.delivery.openedDocument?.optString("name")} window=${root?.packageName} choices=$choices", failure)
        }
        compose.runOnIdle { engine.select(textId) }
        compose.waitUntil(20_000) { engine.selectedId == textId }
        assertEquals("ANDROID PRO", engine.text)
        assertTrue(section("effects").children.any { it.id == glow.id })
        assertTrue(section("animation").children.any { it.id == track.id })

        compose.runOnIdle { engine.setField(content, "RESTORED NATIVE EDIT") }
        compose.activityRule.scenario.recreate()
        waitForCanvas()
        compose.waitUntil(20_000) { engine.text == "RESTORED NATIVE EDIT" }
        assertEquals(3, engine.layers.size)
        assertTrue("Recovered unsaved edits must still prompt before discard", engine.dirty)
        menu("New document")
        compose.onNodeWithText("Save your document?").assertExists()
        compose.onNodeWithText("Cancel").performClick()
    }

    @Test fun transparentPngAnimatedApngGifAndNativePickerCancellation() {
        freshDocument()
        compose.runOnIdle {
            engine.updateText("EXPORT")
            engine.animation("add", kind = "pulse")
        }
        compose.waitUntil(20_000) { section("animation").children.isNotEmpty() }
        val duration = section("animation").children.last().fields.first { it.label == "Loop duration (seconds)" }
        compose.runOnIdle { engine.setField(duration.id, 0.5) }
        compose.waitUntil(20_000) { engine.view.duration == 0.5 }
        waitForCanvas()
        listOf("png", "apng", "gif").forEach { format ->
            val result = AtomicReference<NativeExport?>()
            compose.runOnIdle { engine.exportImage(format, 1, 4) { result.set(it) } }
            compose.waitUntil(120_000) { result.get() != null || (!engine.exporting && engine.notice != null) }
            val image = result.get() ?: error("$format failed: ${engine.notice}")
            val bitmap = BitmapFactory.decodeByteArray(image.bytes, 0, image.bytes.size)
            assertNotNull(bitmap); assertEquals(image.width, bitmap.width); assertEquals(image.height, bitmap.height)
            if (format == "png") {
                var transparent = false; var visible = false
                for (y in 0 until bitmap.height step 7) for (x in 0 until bitmap.width step 7) {
                    val alpha = bitmap.getPixel(x, y).ushr(24); transparent = transparent || alpha == 0; visible = visible || alpha > 0
                }
                assertTrue(transparent); assertTrue(visible)
            } else {
                assertTrue("Animation must contain multiple frames", image.frameCount > 1)
                if (format == "apng") assertTrue(image.bytes.toString(Charsets.ISO_8859_1).contains("acTL"))
                else assertTrue(image.bytes.take(6).toByteArray().toString(Charsets.US_ASCII).startsWith("GIF8"))
            }
            bitmap.recycle()
            File(compose.activity.cacheDir, "integration-export.$format").writeBytes(image.bytes)
        }
        compose.onNodeWithTag("export").performClick()
        compose.onNodeWithTag("confirm-export").performClick()
        waitForFiles()
        automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
        compose.waitUntil(10_000) { automation.rootInActiveWindow?.packageName == "app.wordwarp.android" }
        compose.onNodeWithTag("export").assertIsEnabled()
        compose.onNodeWithText("Save cancelled").assertExists()
    }

    @Test fun nativeCanvasPinchDragAndUndo() {
        freshDocument()
        compose.onNodeWithContentDescription("Close inspector").performClick()
        waitForCanvas()
        compose.runOnIdle { engine.setView(fit = true) }
        compose.waitForIdle()
        val beforeZoom = engine.view.zoom
        compose.onNodeWithTag("canvas").performTouchInput {
            down(0, center + Offset(-50f, 0f)); down(1, center + Offset(50f, 0f))
            moveTo(0, center + Offset(-110f, 0f)); moveTo(1, center + Offset(110f, 0f))
            advanceEventTime(40); up(1)
            moveTo(0, center + Offset(-125f, 20f)); advanceEventTime(40); up(0)
        }
        compose.waitUntil(15_000) { engine.view.zoom > beforeZoom * 1.5 }
        compose.runOnIdle { engine.setView(fit = true) }
        compose.waitForIdle()
        val original = engine.document!!.getJSONArray("elements").getJSONObject(0).getJSONObject("transform").getDouble("x")
        compose.onNodeWithTag("canvas").performTouchInput { swipe(center, center + Offset(48f, 18f), 350) }
        compose.waitUntil(20_000) { engine.document!!.getJSONArray("elements").getJSONObject(0).getJSONObject("transform").getDouble("x") != original }
        compose.onNodeWithContentDescription("Undo").performClick()
        compose.waitUntil(20_000) { engine.document!!.getJSONArray("elements").getJSONObject(0).getJSONObject("transform").getDouble("x") == original }
    }

    @Test fun rejectsExternalOriginsAndMalformedExport() {
        assertTrue(EngineSession.isLocalAsset(Uri.parse(EngineSession.ENTRY)))
        listOf("http://appassets.androidplatform.net/assets/native.html", "https://example.com/assets/native.html",
            "file:///etc/passwd", "https://appassets.androidplatform.net:443/assets/native.html",
            "https://appassets.androidplatform.net/assets/../private", "https://user@appassets.androidplatform.net/assets/native.html").forEach {
            assertFalse(it, EngineSession.isLocalAsset(Uri.parse(it)))
        }
        try {
            EngineSession.parseExport(JSONObject().put("mimeType", "image/png").put("base64", "SGVsbG8=")
                .put("width", 10).put("height", 10).put("filename", "wrong.png"))
            fail("Malformed images must not be delivered to Android storage")
        } catch (_: IllegalArgumentException) { /* expected */ }
    }
}
