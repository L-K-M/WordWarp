package ch.lkmc.wordwarp.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.toColorInt
import org.json.JSONObject
import kotlin.math.roundToInt

private data class EditorTool(val id: String, val label: String, val icon: Int)
private val tools = listOf(EditorTool("layers", "Layers", R.drawable.ic_layers), EditorTool("styles", "Styles", R.drawable.ic_styles),
    EditorTool("object", "Edit", R.drawable.ic_edit), EditorTool("effects", "Effects", R.drawable.ic_effects), EditorTool("animation", "Motion", R.drawable.ic_play))

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeEditorScreen(
    engine: EngineSession,
    delivering: Boolean,
    opening: Boolean,
    onOpenDocument: () -> Unit,
    onSaveDocument: (String?) -> Unit,
    onExport: (String, Int, Int) -> Unit,
) {
    var activeTool by rememberSaveable { mutableStateOf("object") }
    var panelOpen by rememberSaveable { mutableStateOf(true) }
    var layersOpen by rememberSaveable { mutableStateOf(false) }
    var stylesOpen by rememberSaveable { mutableStateOf(false) }
    var exportOpen by rememberSaveable { mutableStateOf(false) }
    var documentMenu by remember { mutableStateOf(false) }
    var licensesOpen by rememberSaveable { mutableStateOf(false) }
    var pendingDocumentAction by rememberSaveable { mutableStateOf<String?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val focus = LocalFocusManager.current
    val keyboardVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val notice = engine.notice
    LaunchedEffect(notice) { if (notice != null) { snackbar.showSnackbar(notice, withDismissAction = true); if (engine.notice == notice) engine.notice = null } }
    fun documentAction(action: String) {
        documentMenu = false
        if (engine.dirty) pendingDocumentAction = action
        else if (action == "new") engine.newDocument() else onOpenDocument()
    }
    fun chooseTool(id: String, expanded: Boolean) {
        focus.clearFocus()
        when (id) {
            "layers" -> if (expanded) { activeTool = id; panelOpen = true } else layersOpen = true
            "styles" -> if (expanded) { activeTool = id; panelOpen = true } else stylesOpen = true
            else -> { panelOpen = expanded || activeTool != id || !panelOpen; activeTool = id }
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val expanded = maxWidth >= 840.dp
        BackHandler(enabled = !expanded && panelOpen && !keyboardVisible && !layersOpen && !stylesOpen && !exportOpen) { panelOpen = false }
        Scaffold(
            modifier = Modifier.imePadding(),
            topBar = {
                TopAppBar(title = {
                    Column {
                        Text(engine.documentName + if (engine.dirty) " •" else "", maxLines = 1, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text("WordWarp", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }, navigationIcon = {
                    Box {
                        IconButton(onClick = { documentMenu = true }, modifier = Modifier.semantics { contentDescription = "Document menu" }) { EditorIcon(R.drawable.ic_menu) }
                        DropdownMenu(expanded = documentMenu, onDismissRequest = { documentMenu = false }) {
                            DropdownMenuItem(text = { Text("New document") }, onClick = { documentAction("new") }, enabled = engine.ready)
                            DropdownMenuItem(text = { Text("Open document…") }, onClick = { documentAction("open") }, enabled = engine.ready && !delivering)
                            DropdownMenuItem(text = { Text("Save document…") }, onClick = { documentMenu = false; onSaveDocument(null) }, enabled = engine.ready && !delivering)
                            HorizontalDivider()
                            DropdownMenuItem(text = { Text("Canvas settings") }, onClick = { documentMenu = false; activeTool = "document"; panelOpen = true })
                            DropdownMenuItem(text = { Text("Licenses") }, onClick = { documentMenu = false; licensesOpen = true })
                        }
                    }
                }, actions = {
                    IconButton(onClick = engine::undo, enabled = engine.ready && engine.canUndo, modifier = Modifier.semantics { contentDescription = "Undo" }) { EditorIcon(R.drawable.ic_undo) }
                    IconButton(onClick = engine::redo, enabled = engine.ready && engine.canRedo, modifier = Modifier.semantics { contentDescription = "Redo" }) { EditorIcon(R.drawable.ic_redo) }
                    TextButton(onClick = { focus.clearFocus(); exportOpen = true }, enabled = engine.ready && !engine.exporting && !delivering,
                        modifier = Modifier.testTag("export")) { Text("Export") }
                })
            },
            bottomBar = {
                if (!expanded && !keyboardVisible) NavigationBar {
                    tools.forEach { tool -> NavigationBarItem(selected = activeTool == tool.id && panelOpen,
                        onClick = { chooseTool(tool.id, false) }, enabled = engine.ready,
                        icon = { EditorIcon(tool.icon) }, label = { Text(tool.label) },
                        modifier = Modifier.testTag("tool-${tool.id}")) }
                }
            }, snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            if (expanded) Row(Modifier.fillMaxSize().padding(padding)) {
                NavigationRail {
                    tools.forEach { tool -> NavigationRailItem(selected = activeTool == tool.id,
                        onClick = { chooseTool(tool.id, true) }, enabled = engine.ready,
                        icon = { EditorIcon(tool.icon) }, label = { Text(tool.label) },
                        modifier = Modifier.testTag("tool-${tool.id}")) }
                    Spacer(Modifier.weight(1f))
                    NavigationRailItem(selected = activeTool == "document", onClick = { activeTool = "document" },
                        icon = { EditorIcon(R.drawable.ic_canvas) }, label = { Text("Canvas") })
                }
                CanvasWorkspace(engine, Modifier.weight(1f).fillMaxHeight().padding(12.dp))
                VerticalDivider()
                EditorPanel(engine, activeTool, Modifier.width(360.dp).fillMaxHeight().padding(16.dp))
            } else BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
                val availableHeight = maxHeight
                Column(Modifier.fillMaxSize()) {
                    CanvasWorkspace(engine, Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp))
                    if (panelOpen) {
                        HorizontalDivider()
                        Surface(tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth().height(availableHeight * if (keyboardVisible) 0.52f else 0.47f)) {
                            Column {
                                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(if (activeTool == "document") "Canvas" else tools.firstOrNull { it.id == activeTool }?.label ?: "Inspector",
                                        Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                                    IconButton(onClick = { focus.clearFocus(); panelOpen = false }, modifier = Modifier.semantics { contentDescription = "Close inspector" }) { EditorIcon(R.drawable.ic_close) }
                                }
                                EditorPanel(engine, activeTool, Modifier.fillMaxSize().padding(horizontal = 16.dp))
                            }
                        }
                    }
                }
            }
        }
    }
    if (layersOpen) ModalBottomSheet(onDismissRequest = { layersOpen = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)) {
        LayersPanel(engine, Modifier.fillMaxWidth().fillMaxHeight(0.85f).padding(horizontal = 20.dp))
    }
    if (stylesOpen) ModalBottomSheet(onDismissRequest = { stylesOpen = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)) {
        PresetPanel(engine, Modifier.fillMaxWidth().fillMaxHeight(0.85f).padding(horizontal = 20.dp)) { stylesOpen = false }
    }
    if (exportOpen) ExportDialog(engine, onDismiss = { exportOpen = false }) { format, scale, fps ->
        exportOpen = false; onExport(format, scale, fps)
    }
    if (licensesOpen) LicenseDialog { licensesOpen = false }
    if (engine.exporting || delivering) AlertDialog(onDismissRequest = {}, title = { Text(if (engine.exporting) "Rendering export" else if (opening) "Opening document" else "Saving file") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (engine.exporting && engine.exportProgress > 0) LinearProgressIndicator(progress = { engine.exportProgress.toFloat() }, modifier = Modifier.fillMaxWidth())
                else LinearProgressIndicator(Modifier.fillMaxWidth())
                Text(if (engine.exporting) "Your artwork is being prepared. ${if (engine.exportProgress > 0) "${(engine.exportProgress * 100).roundToInt()}%" else ""}" else if (opening) "Restoring your artwork…" else "Choose a destination in the Android file picker.")
            }
        }, confirmButton = {})
    if (pendingDocumentAction != null) AlertDialog(onDismissRequest = { pendingDocumentAction = null },
        title = { Text("Save your document?") }, text = { Text("Save a WordWarp file before opening another canvas.") },
        confirmButton = { TextButton(onClick = { val action = pendingDocumentAction; pendingDocumentAction = null; onSaveDocument(action) }) { Text("Save…") } },
        dismissButton = {
            Row {
                TextButton(onClick = { val action = pendingDocumentAction; pendingDocumentAction = null; if (action == "new") engine.newDocument() else onOpenDocument() }) { Text("Discard") }
                TextButton(onClick = { pendingDocumentAction = null }) { Text("Cancel") }
            }
        })
}

@Composable
private fun LicenseDialog(onDismiss: () -> Unit) {
    val assets = LocalContext.current.assets
    val files = remember(assets) {
        fun textFiles(directory: String): List<String> = assets.list(directory).orEmpty().flatMap { name ->
            val path = "$directory/$name"
            if (name.endsWith(".txt") || name.endsWith(".md")) listOf(path)
            else if (!name.contains('.')) textFiles(path) else emptyList()
        }
        // Only bundled notice directories are read; there is no network or general file access.
        (textFiles("licenses") + textFiles("fonts")).sorted()
    }
    var selected by rememberSaveable { mutableStateOf("licenses/LICENSING.md") }
    var choosing by remember { mutableStateOf(false) }
    val path = selected.takeIf { it in files } ?: files.firstOrNull()
    val content = remember(path) { path?.let { assets.open(it).bufferedReader().use { reader -> reader.readText() } }.orEmpty() }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Licenses") }, text = {
        Column {
            Box {
                TextButton(onClick = { choosing = true }) { Text(path?.removePrefix("licenses/") ?: "No bundled notices") }
                DropdownMenu(expanded = choosing, onDismissRequest = { choosing = false }) {
                    files.forEach { file -> DropdownMenuItem(text = { Text(file.removePrefix("licenses/")) },
                        onClick = { selected = file; choosing = false }) }
                }
            }
            key(path) {
                Text(content, Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()), style = MaterialTheme.typography.bodySmall)
            }
        }
    }, confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } })
}

@Composable
private fun CanvasWorkspace(engine: EngineSession, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(engine.layers.firstOrNull { it.id == engine.selectedId }?.name ?: "Canvas", Modifier.weight(1f),
                style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            TextButton(onClick = { engine.setView(tool = if (engine.view.tool == "pan") "select" else "pan") }, enabled = engine.ready,
                modifier = Modifier.testTag("canvas-tool")) { Text(if (engine.view.tool == "pan") "Pan" else "Select") }
            IconButton(onClick = { engine.setView(zoom = engine.view.zoom / 1.2) }, enabled = engine.ready,
                modifier = Modifier.size(36.dp).semantics { contentDescription = "Zoom out" }) { EditorIcon(R.drawable.ic_remove) }
            TextButton(onClick = { engine.setView(fit = true) }, enabled = engine.ready, modifier = Modifier.testTag("fit-canvas")) { Text("Fit") }
            IconButton(onClick = { engine.setView(zoom = engine.view.zoom * 1.2) }, enabled = engine.ready,
                modifier = Modifier.size(36.dp).semantics { contentDescription = "Zoom in" }) { EditorIcon(R.drawable.ic_add) }
        }
        // A Compose clip/graphics layer can hide a hardware-composited Android WebView.
        // Leave this ancestor unclipped; the shared canvas provides its own presentation.
        Box(Modifier.weight(1f).fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer), contentAlignment = Alignment.Center) {
            key(engine.generation) {
                AndroidView(factory = { engine.createWebView(it) }, modifier = Modifier.fillMaxSize().testTag("canvas"), onRelease = engine::detach)
            }
            if (engine.fatalError != null) Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text(engine.fatalError.orEmpty()); Button(onClick = engine::retry) { Text("Retry") }
            } else if (!engine.ready || engine.renderedRevision < 0) CircularProgressIndicator()
            else if (engine.renderedRevision < engine.revision) LinearProgressIndicator(Modifier.align(Alignment.BottomCenter).fillMaxWidth())
        }
        if (engine.view.duration > 0 && engine.inspector.any { it.category == "animation" && it.children.isNotEmpty() }) PlaybackBar(engine)
    }
}

@Composable
private fun PlaybackBar(engine: EngineSession) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = { engine.playback(playing = !engine.view.playing) }, modifier = Modifier.testTag("playback")) { Text(if (engine.view.playing) "Pause" else "Play") }
        Slider(value = engine.view.time.toFloat().coerceIn(0f, 1f), onValueChange = { engine.playback(playing = false, time = it.toDouble()) },
            modifier = Modifier.weight(1f).testTag("timeline"))
        Text("${formatNumber(engine.view.time * engine.view.duration)}s", Modifier.width(48.dp), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun EditorPanel(engine: EngineSession, activeTool: String, modifier: Modifier) {
    when (activeTool) {
        "layers" -> LayersPanel(engine, modifier)
        "styles" -> PresetPanel(engine, modifier)
        "effects" -> StackPanel(engine, false, modifier)
        "animation" -> StackPanel(engine, true, modifier)
        else -> {
            val section = engine.inspector.firstOrNull { it.category == if (activeTool == "document") "document" else "object" }
            if (section == null) Box(modifier, contentAlignment = Alignment.Center) { Text("Select a layer to edit it.") }
            else if (activeTool != "document" && engine.layers.firstOrNull { it.id == engine.selectedId }?.locked == true) LockedPanel(engine, modifier)
            else SectionTabs(section, engine, modifier)
        }
    }
}

@Composable
private fun LockedPanel(engine: EngineSession, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("This layer is locked", style = MaterialTheme.typography.titleMedium)
        Text("Unlock it to edit text, effects, or geometry.")
        Button(onClick = { engine.selectedId?.let { engine.layer("lock", it) } }) { Text("Unlock layer") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SectionTabs(section: InspectorSection, engine: EngineSession, modifier: Modifier) {
    var selected by rememberSaveable(section.id, engine.selectedId) { mutableStateOf(section.children.firstOrNull()?.id ?: section.id) }
    val sections = buildList { if (section.fields.isNotEmpty() || section.actions.isNotEmpty()) add(section.copy(children = emptyList(), label = if (section.category == "object") "Layer" else "Document")); addAll(section.children) }
    val selectedIndex = sections.indexOfFirst { it.id == selected }.coerceAtLeast(0)
    Column(modifier) {
        if (sections.size > 1) ScrollableTabRow(selectedTabIndex = selectedIndex, edgePadding = 0.dp) {
            sections.forEach { item -> Tab(selected = item.id == selected, onClick = { selected = item.id }, text = { Text(item.label, maxLines = 1) }) }
        }
        val current = sections.getOrNull(selectedIndex)
        if (current != null) InspectorSectionContent(current, engine::setField, engine::inspectorAction,
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(vertical = 16.dp), showTitle = sections.size <= 1)
    }
}

@Composable
private fun StackPanel(engine: EngineSession, animation: Boolean, modifier: Modifier) {
    val section = engine.inspector.firstOrNull { it.category == if (animation) "animation" else "effects" }
    var adding by remember { mutableStateOf(false) }
    val locked = engine.layers.firstOrNull { it.id == engine.selectedId }?.locked == true
    if (locked) { LockedPanel(engine, modifier); return }
    if (section == null) { Box(modifier, contentAlignment = Alignment.Center) { Text("Select a layer first.") }; return }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(if (animation) "Animation tracks" else "Effect stack", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            TextButton(onClick = { adding = true }, modifier = Modifier.testTag(if (animation) "add-animation" else "add-effect")) { Text("Add") }
        }
        LazyColumn(Modifier.weight(1f).testTag("stack-list"), verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 18.dp)) {
            if (section.children.isEmpty()) item { Text(if (animation) "Add a track to animate this layer." else "Add an effect to style this layer.", style = MaterialTheme.typography.bodyMedium) }
            items(if (animation) section.children else section.children.asReversed(), key = { it.id }) { entry ->
                var open by rememberSaveable(engine.selectedId, entry.id) { mutableStateOf(false) }
                var actionsOpen by remember { mutableStateOf(false) }
                val enabledField = entry.fields.firstOrNull { it.type == "boolean" && it.id.endsWith("/enabled") }
                OutlinedCard(Modifier.fillMaxWidth().testTag("stack-card-${entry.id}")) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = enabledField?.value != false, onCheckedChange = { enabled ->
                            if (enabledField != null) engine.setField(enabledField.id, enabled)
                        }, modifier = Modifier.testTag("stack-enabled-${entry.id}").semantics { contentDescription = "Enable ${entry.label}" })
                        Row(Modifier.weight(1f).heightIn(min = 48.dp).testTag("stack-${entry.id}")
                            .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
                            .clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
                            Icon(painterResource(R.drawable.ic_expand_more), null, Modifier.size(20.dp).rotate(if (open) 0f else -90f))
                            Spacer(Modifier.width(4.dp))
                            Text(entry.label, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Box {
                            IconButton(onClick = { actionsOpen = true }, modifier = Modifier.testTag("stack-actions-${entry.id}")) {
                                Icon(painterResource(R.drawable.ic_more), "Actions for ${entry.label}")
                            }
                            DropdownMenu(expanded = actionsOpen, onDismissRequest = { actionsOpen = false }) {
                                if (!animation) {
                                    DropdownMenuItem(text = { Text("Move up") }, onClick = { engine.effect("up", entry.id); actionsOpen = false })
                                    DropdownMenuItem(text = { Text("Move down") }, onClick = { engine.effect("down", entry.id); actionsOpen = false })
                                }
                                DropdownMenuItem(text = { Text("Delete", color = MaterialTheme.colorScheme.error) }, onClick = {
                                    if (animation) engine.animation("delete", entry.id) else engine.effect("delete", entry.id)
                                    actionsOpen = false
                                })
                            }
                        }
                    }
                    if (open) InspectorSectionContent(entry.copy(fields = entry.fields.filter { it.id != enabledField?.id }),
                        engine::setField, engine::inspectorAction,
                        Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp), showTitle = false)
                }
            }
        }
    }
    if (adding) CatalogDialog(if (animation) "Add animation" else "Add effect", if (animation) engine.animationKinds else engine.effectKinds,
        onDismiss = { adding = false }) { choice ->
        if (animation) engine.animation("add", kind = choice.value) else engine.effect("add", kind = choice.value)
        adding = false
    }
}

@Composable
private fun LayersPanel(engine: EngineSession, modifier: Modifier) {
    var stampsOpen by remember { mutableStateOf(false) }
    var layerMenu by remember { mutableStateOf<String?>(null) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Layers", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = { engine.command("addText") }, modifier = Modifier.testTag("add-text")) { Text("+ Text") }
            TextButton(onClick = { stampsOpen = true }, modifier = Modifier.testTag("add-stamp")) { Text("+ Stamp") }
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            items(engine.layers.reversed(), key = { it.id }) { layer ->
                Card(colors = CardDefaults.cardColors(containerColor = if (layer.id == engine.selectedId) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.fillMaxWidth().testTag("layer-${layer.id}")) {
                    Row(Modifier.fillMaxWidth().clickable { engine.select(layer.id) }.padding(start = 14.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(if (layer.type == "text") "T" else "◇", Modifier.padding(end = 12.dp), style = MaterialTheme.typography.titleLarge)
                        Column(Modifier.weight(1f).padding(vertical = 14.dp)) {
                            Text(layer.name, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                            Text(if (layer.locked) "Locked" else if (layer.visible) "Visible" else "Hidden", style = MaterialTheme.typography.labelSmall)
                        }
                        Switch(checked = layer.visible, onCheckedChange = { engine.layer("visibility", layer.id) }, modifier = Modifier.semantics { contentDescription = "Visibility of ${layer.name}" })
                        Box {
                            IconButton(onClick = { layerMenu = layer.id }, modifier = Modifier.semantics { contentDescription = "Layer actions for ${layer.name}" }) { EditorIcon(R.drawable.ic_more) }
                            DropdownMenu(expanded = layerMenu == layer.id, onDismissRequest = { layerMenu = null }) {
                                listOf("lock" to if (layer.locked) "Unlock" else "Lock", "duplicate" to "Duplicate", "up" to "Move forward", "down" to "Move backward", "front" to "Bring to front", "back" to "Send to back", "delete" to "Delete").forEach { (action, label) ->
                                    DropdownMenuItem(text = { Text(label) }, onClick = { engine.layer(action, layer.id); layerMenu = null })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (stampsOpen) CatalogDialog("Add a stamp", engine.stamps, onDismiss = { stampsOpen = false }) {
        engine.command("addStamp", JSONObject().put("stampId", it.value)); stampsOpen = false
    }
}

@Composable
private fun PresetPanel(engine: EngineSession, modifier: Modifier, onApplied: () -> Unit = {}) {
    var query by rememberSaveable { mutableStateOf("") }
    val filtered = remember(query, engine.presets) { engine.presets.filter { it.name.contains(query, true) || it.category.contains(query, true) } }
    val canApply = engine.selectedId != null && engine.layers.firstOrNull { it.id == engine.selectedId }?.locked != true
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Styles", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(query, { query = it }, singleLine = true, label = { Text("Search styles") }, modifier = Modifier.fillMaxWidth().testTag("style-search"), shape = RoundedCornerShape(16.dp))
        if (!canApply) Text("Select an unlocked text or stamp layer to apply a style.", style = MaterialTheme.typography.bodySmall)
        LazyVerticalGrid(columns = GridCells.Adaptive(140.dp), modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(filtered, key = { it.id }) { preset ->
                Card(onClick = { engine.setPreset(preset.id); onApplied() }, enabled = canApply,
                    colors = CardDefaults.cardColors(containerColor = if (preset.id == engine.presetId) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh),
                    modifier = Modifier.fillMaxWidth().testTag("preset-${preset.id}")) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        PresetSwatch(preset.colors, Modifier.fillMaxWidth().height(42.dp))
                        Text(preset.name, style = MaterialTheme.typography.titleSmall, maxLines = 2)
                        Text(preset.category + if (preset.animated) " · Animated" else "", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun PresetSwatch(values: List<String>, modifier: Modifier) {
    val colors = remember(values) { values.mapNotNull { runCatching { Color(it.toColorInt()) }.getOrNull() }.ifEmpty { listOf(Color.Gray) } }
    Canvas(modifier.clip(RoundedCornerShape(10.dp))) {
        colors.forEachIndexed { index, color -> val width = size.width / colors.size; drawRect(color, Offset(index * width, 0f), Size(width + 1, size.height)) }
    }
}

@Composable
private fun CatalogDialog(title: String, choices: List<CatalogChoice>, onDismiss: () -> Unit, onChoose: (CatalogChoice) -> Unit) {
    var search by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) }, text = {
        Column(Modifier.heightIn(max = 480.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(search, { search = it }, label = { Text("Search") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("catalog-search"))
            LazyColumn {
                items(choices.filter { it.label.contains(search, true) || it.category.contains(search, true) }, key = { it.value }) { option ->
                    ListItem(headlineContent = { Text(option.label) }, supportingContent = if (option.category.isNotBlank()) ({ Text(option.category) }) else null,
                        modifier = Modifier.clickable { onChoose(option) }.testTag("catalog-${option.value}"))
                }
            }
        }
    }, confirmButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

@Composable
private fun ExportDialog(engine: EngineSession, onDismiss: () -> Unit, onExport: (String, Int, Int) -> Unit) {
    var format by rememberSaveable { mutableStateOf("png") }
    var scale by rememberSaveable { mutableIntStateOf(2) }
    var fps by rememberSaveable { mutableIntStateOf(12) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Export artwork") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            NativeChoiceField("Format", format, listOf(InspectorOption("png", "PNG · Still image"), InspectorOption("apng", "APNG · Animated PNG"), InspectorOption("gif", "GIF · Animated image")), Modifier.fillMaxWidth()) { format = it.toString() }
            NativeChoiceField("Resolution", scale, (1..4).map { InspectorOption(it, "$it×") }, Modifier.fillMaxWidth()) { scale = (it as Number).toInt() }
            if (format != "png") {
                Text("Frame rate: $fps fps", style = MaterialTheme.typography.labelLarge)
                Slider(value = fps.toFloat(), onValueChange = { fps = it.roundToInt() }, valueRange = 1f..30f, steps = 28)
                Text("Duration: ${formatNumber(engine.view.duration)} seconds. Large animations may use fewer frames to fit device limits.", style = MaterialTheme.typography.bodySmall)
            }
            Text(if (format == "gif") "GIF uses a limited palette and one-bit transparency. Use APNG for smooth translucent edges." else "Transparency is preserved when the canvas background is None.", style = MaterialTheme.typography.bodySmall)
        }
    }, confirmButton = { TextButton(onClick = { onExport(format, scale, fps) }, modifier = Modifier.testTag("confirm-export")) { Text("Export") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

@Composable
private fun EditorIcon(resource: Int) { Icon(painterResource(resource), contentDescription = null, modifier = Modifier.size(24.dp)) }
