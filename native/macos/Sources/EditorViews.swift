import AppKit
import SwiftUI

struct LayerSummary: Identifiable {
    let id: String
    let name: String
    let type: String
    let visible: Bool
    let locked: Bool
    let effectCount: Int
    init?(_ object: [String: Any]) {
        guard let id = object["id"] as? String else { return nil }
        self.id = id; name = object["name"] as? String ?? "Layer"
        type = object["type"] as? String ?? "text"
        visible = object["visible"] as? Bool ?? true; locked = object["locked"] as? Bool ?? false
        effectCount = object["effectCount"] as? Int ?? (object["effects"] as? [Any])?.count ?? 0
    }
    var symbol: String { type == "text" ? "textformat" : type == "shape" ? "seal" : "photo" }
}

struct CatalogItem: Identifiable {
    let id: String
    let label: String
    let category: String
    init?(_ object: [String: Any]) {
        guard let id = object["value"] as? String ?? object["id"] as? String ?? object["kind"] as? String else { return nil }
        self.id = id; label = object["label"] as? String ?? object["name"] as? String ?? id
        category = object["category"] as? String ?? object["group"] as? String ?? ""
    }
}

struct FullStudioView: View {
    @ObservedObject var model: StudioModel
    @State private var sidebarMode = "layers"
    @State private var searchText = ""
    @State private var inspectorVisible = true
    @State private var exportSheet = false
    @State private var exportAfterDismiss = false
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    var filteredPresets: [Preset] {
        model.presets.filter { searchText.isEmpty || $0.name.localizedCaseInsensitiveContains(searchText) || $0.category.localizedCaseInsensitiveContains(searchText) }
    }
    var categories: [String] { Array(Set(filteredPresets.map(\.category))).sorted() }
    var layerSelection: Binding<String?> { Binding(get: { model.selectedLayerID }, set: { model.selectLayer($0) }) }

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            VStack(spacing: 0) {
                Picker("Library", selection: $sidebarMode) {
                    Text("Layers").tag("layers")
                    Text("Styles").tag("styles")
                }.pickerStyle(.segmented).labelsHidden().padding(12)
                if sidebarMode == "layers" { layersSidebar }
                else { stylesSidebar }
            }
            .navigationSplitViewColumnWidth(min: 210, ideal: 245, max: 350)
            .navigationTitle("WordWarp")
        } detail: {
            HStack(spacing: 0) {
                toolsStrip
                Divider()
                VStack(spacing: 0) {
                    canvas
                    Divider()
                    playbackBar
                    Divider()
                    statusBar
                }
            }
            .navigationTitle(model.documentTitle)
            .navigationSubtitle(model.selectedLayer?.name ?? "Document")
            .inspector(isPresented: $inspectorVisible) {
                contextualInspector.inspectorColumnWidth(min: 285, ideal: 315, max: 400)
            }
            .toolbar {
                ToolbarItemGroup(placement: .navigation) {
                    Button(action: model.undo) { Label("Undo", systemImage: "arrow.uturn.backward") }
                        .disabled(!model.canUndo).help("Undo (⌘Z)")
                    Button(action: model.redo) { Label("Redo", systemImage: "arrow.uturn.forward") }
                        .disabled(!model.canRedo).help("Redo (⇧⌘Z)")
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    Menu {
                        Button("Text Layer", action: model.addText)
                        Menu("Stamp") { stampMenuItems }
                    } label: { Label("Insert", systemImage: "plus") }
                        .disabled(!model.isReady).accessibilityLabel("Insert").help("Insert a text layer or stamp")
                    Button(action: { model.saveDocument() }) { Label("Save", systemImage: "square.and.arrow.down") }
                        .disabled(!model.isReady).help("Save document (⌘S)")
                    Button { exportSheet = true } label: { Label("Export", systemImage: "square.and.arrow.up") }
                        .disabled(!model.isReady || model.isExporting).help("Export image or animation (⇧⌘E)")
                    Button { inspectorVisible.toggle() } label: { Label("Inspector", systemImage: "sidebar.right") }
                        .help("Show or hide inspector")
                }
            }
        }
        .frame(minWidth: 1050, minHeight: 650)
        .sheet(isPresented: $exportSheet, onDismiss: {
            if exportAfterDismiss { exportAfterDismiss = false; model.exportArtwork() }
        }) { NativeExportSheet(model: model, exportAction: { exportAfterDismiss = true; exportSheet = false }) }
        .onReceive(NotificationCenter.default.publisher(for: .wordwarpShowExport)) { _ in exportSheet = true }
        .onReceive(NotificationCenter.default.publisher(for: .wordwarpToggleInspector)) { _ in inspectorVisible.toggle() }
        .onReceive(NotificationCenter.default.publisher(for: .wordwarpShowStyles)) { _ in sidebarMode = "styles"; columnVisibility = .all }
    }

    private var layersSidebar: some View {
        VStack(spacing: 0) {
            List(selection: layerSelection) {
                ForEach(model.layers.reversed()) { layer in
                    HStack(spacing: 8) {
                        Image(systemName: layer.symbol).font(.system(size: 17, weight: .medium))
                            .frame(width: 32, height: 34)
                            .foregroundStyle(layer.visible ? .primary : .secondary)
                            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(layer.name).lineLimit(1)
                            Text(layer.type == "text" ? "Text" : layer.type.capitalized)
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        if layer.effectCount > 0 { Text("ƒx").font(.caption).foregroundStyle(.secondary) }
                        Button { model.toggleLayerLock(layer) } label: {
                            Image(systemName: layer.locked ? "lock.fill" : "lock.open")
                                .opacity(layer.locked ? 1 : 0.35)
                        }.buttonStyle(.plain).help(layer.locked ? "Unlock layer" : "Lock layer")
                            .accessibilityLabel("\(layer.locked ? "Unlock" : "Lock") \(layer.name)")
                        Button { model.toggleLayerVisibility(layer) } label: { Image(systemName: layer.visible ? "eye" : "eye.slash") }
                            .buttonStyle(.plain).help(layer.visible ? "Hide layer" : "Show layer")
                            .accessibilityLabel("\(layer.visible ? "Hide" : "Show") \(layer.name)")
                    }
                    .padding(.vertical, 3).tag(layer.id)
                    .contextMenu {
                        Button("Duplicate Layer") { model.duplicateLayer(layer.id) }.disabled(layer.locked)
                        Button(layer.locked ? "Unlock Layer" : "Lock Layer") { model.toggleLayerLock(layer) }
                        Button(layer.visible ? "Hide Layer" : "Show Layer") { model.toggleLayerVisibility(layer) }
                        Divider()
                        Button("Bring Forward") { model.moveLayer(layer.id, direction: 1) }
                        Button("Send Backward") { model.moveLayer(layer.id, direction: -1) }
                        Divider()
                        Button("Delete Layer", role: .destructive) { model.deleteLayer(layer.id) }.disabled(layer.locked)
                    }
                }
                .onMove(perform: model.reorderLayerRows)
            }
            .listStyle(.sidebar)
            .overlay {
                if model.isReady && model.layers.isEmpty {
                    ContentUnavailableView("Start your composition", systemImage: "square.3.layers.3d", description: Text("Add text or a stamp using the controls below."))
                }
            }
            Divider()
            HStack(spacing: 12) {
                Menu {
                    Button("Text Layer", action: model.addText)
                    Divider()
                    stampMenuItems
                } label: { Image(systemName: "plus") }.menuStyle(.borderlessButton).fixedSize().help("Add layer")
                Button { if let id = model.selectedLayerID { model.duplicateLayer(id) } } label: { Image(systemName: "plus.square.on.square") }
                    .disabled(model.selectedLayer == nil || model.selectedLayer?.locked == true).help("Duplicate layer (⌘J)")
                Button { if let id = model.selectedLayerID { model.moveLayer(id, direction: 1) } } label: { Image(systemName: "arrow.up") }
                    .disabled(model.selectedLayer == nil || model.selectedLayer?.locked == true).help("Bring forward")
                Button { if let id = model.selectedLayerID { model.moveLayer(id, direction: -1) } } label: { Image(systemName: "arrow.down") }
                    .disabled(model.selectedLayer == nil || model.selectedLayer?.locked == true).help("Send backward")
                Spacer(minLength: 0)
                Button { if let id = model.selectedLayerID { model.deleteLayer(id) } } label: { Image(systemName: "trash") }
                    .disabled(model.selectedLayer == nil || model.selectedLayer?.locked == true).help("Delete layer")
            }
            .buttonStyle(.borderless).padding(12)
        }
        .disabled(!model.isReady)
    }

    private var stylesSidebar: some View {
        VStack(spacing: 0) {
            NativeStyleSearch(text: $searchText).frame(height: 26).padding(.horizontal, 12).padding(.bottom, 8)
            List(selection: Binding(get: { model.selectedPresetID }, set: { model.selectPreset($0) })) {
                ForEach(categories, id: \.self) { category in
                    Section(category.capitalized) {
                        ForEach(filteredPresets.filter { $0.category == category }) { preset in
                            PresetRow(preset: preset).tag(preset.id)
                        }
                    }
                }
            }.listStyle(.sidebar)
            Divider()
            Text(model.selectedLayer == nil ? "Select a layer to apply a style." : "Apply a complete effect stack to the selected layer.")
                .font(.caption).foregroundStyle(.secondary).padding(12)
        }
        .disabled(!model.isReady || model.selectedLayer == nil || model.selectedLayer?.locked == true)
    }

    private var toolsStrip: some View {
        VStack(spacing: 12) {
            Button { model.chooseTool("select") } label: { Image(systemName: "cursorarrow") }
                .accessibilityLabel("Select").help("Select and transform layers")
                .foregroundStyle(model.canvasTool == "select" ? Color.accentColor : Color.primary)
            Button { model.chooseTool("pan") } label: { Image(systemName: "hand.draw") }
                .accessibilityLabel("Pan").help("Pan the canvas")
                .foregroundStyle(model.canvasTool == "pan" ? Color.accentColor : Color.primary)
            Spacer()
        }
        .buttonStyle(.borderless).font(.system(size: 18))
        .padding(.vertical, 16).padding(.horizontal, 10).frame(width: 46)
        .background(.bar).disabled(!model.isReady)
    }

    @ViewBuilder private var stampMenuItems: some View {
        ForEach(Array(Set(model.stamps.map(\.category))).sorted(), id: \.self) { category in
            Menu(category.isEmpty ? "Stamps" : category.capitalized) {
                ForEach(model.stamps.filter { $0.category == category }) { stamp in
                    Button(stamp.label) { model.addStamp(stamp.id) }
                }
            }
        }
    }

    private var canvas: some View {
        ZStack {
            Color(nsColor: .underPageBackgroundColor)
            CanvasView(webView: model.webView).accessibilityLabel("WordWarp canvas preview")
            if let error = model.fatalErrorMessage {
                ContentUnavailableView {
                    Label("Canvas unavailable", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("Reopen Canvas", action: model.load).buttonStyle(.borderedProminent)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).background(.regularMaterial)
            } else if !model.hasRendered {
                ProgressView("Preparing canvas…").padding(24).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    private var playbackBar: some View {
        HStack(spacing: 10) {
            Button { model.setPlaying(!model.isPlaying) } label: { Image(systemName: model.isPlaying ? "pause.fill" : "play.fill") }
                .buttonStyle(.borderless).disabled(!model.hasAnimation).help(model.isPlaying ? "Pause animation" : "Play animation")
            Slider(value: Binding(get: { model.animationTime }, set: model.scrub), in: 0...1)
                .frame(maxWidth: 230).disabled(!model.hasAnimation).accessibilityLabel("Animation playhead")
            Text(String(format: "%.2f s", model.animationTime * model.animationDuration))
                .font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 58, alignment: .leading)
            Spacer(minLength: 6)
            Button { model.setZoom(model.zoom / 1.2) } label: { Image(systemName: "minus.magnifyingglass") }.buttonStyle(.borderless).help("Zoom out")
            Menu {
                Button("Fit Canvas", action: model.fitCanvas)
                Divider()
                ForEach([0.25, 0.5, 1, 2, 4], id: \.self) { zoom in
                    Button("\(Int(zoom * 100))%") { model.setZoom(zoom) }
                }
            } label: { Text("\(Int(model.zoom * 100))%") }.menuStyle(.borderlessButton).fixedSize().frame(width: 66)
            Button { model.setZoom(model.zoom * 1.2) } label: { Image(systemName: "plus.magnifyingglass") }.buttonStyle(.borderless).help("Zoom in")
        }.padding(.horizontal, 14).padding(.vertical, 9).background(.bar).disabled(!model.isReady)
    }

    private var statusBar: some View {
        HStack(spacing: 8) {
            if model.isExporting { ProgressView(value: model.exportProgress).frame(width: 65) }
            else { Image(systemName: model.errorMessage == nil ? "checkmark.circle" : "exclamationmark.triangle").foregroundStyle(.secondary) }
            Text(model.errorMessage ?? model.status).lineLimit(2)
            Spacer()
            if !model.canvasSize.isEmpty { Text(model.canvasSize).monospacedDigit().foregroundStyle(.secondary) }
        }.font(.caption).padding(.horizontal, 14).padding(.vertical, 8).background(.bar).accessibilityElement(children: .combine)
    }

    private var contextualInspector: some View {
        VStack(spacing: 0) {
            Picker("Inspector", selection: $model.inspectorTab) {
                Text("Object").tag("object")
                Text("Effects").tag("effects")
                Text("Motion").tag("animation")
                Text("Canvas").tag("document")
            }.pickerStyle(.segmented).labelsHidden().padding(12)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 5) {
                    if model.inspectorTab != "document", let layer = model.selectedLayer {
                        HStack {
                            Image(systemName: layer.symbol).foregroundStyle(.secondary)
                            Text(layer.name).font(.headline).lineLimit(1)
                            Spacer()
                            if layer.locked { Image(systemName: "lock.fill").foregroundStyle(.secondary) }
                        }.padding(.vertical, 8)
                        if layer.locked {
                            Label("Unlock this layer to edit it.", systemImage: "lock").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if model.inspectorTab == "effects" { effectInspector }
                    else if model.inspectorTab == "animation" { animationInspector }
                    else {
                        ForEach(model.inspector.filter { $0.category == model.inspectorTab }) { section in
                            InspectorSectionView(section: section, value: model.fieldValue, change: model.changeField, action: model.inspectorAction)
                                .disabled(model.inspectorTab != "document" && model.selectedLayer?.locked == true)
                        }
                    }
                    if model.inspectorTab != "document" && model.selectedLayer == nil {
                        ContentUnavailableView("No layer selected", systemImage: "cursorarrow", description: Text("Select a layer in the canvas or layer list."))
                    }
                }.padding(.horizontal, 16).padding(.bottom, 20)
            }
        }.background(.regularMaterial).disabled(!model.isReady)
    }

    private var effectInspector: some View {
        VStack(alignment: .leading, spacing: 8) {
            Menu {
                ForEach(model.effectKinds) { item in Button(item.label) { model.addEffect(item.id) } }
            } label: { Label("Add Effect", systemImage: "plus") }.disabled(model.selectedLayer == nil || model.selectedLayer?.locked == true)
            ForEach(model.inspector.filter { $0.category == "effects" }.flatMap(\.children).reversed()) { section in
                InspectorStackCard(section: section, model: model) {
                    Button { model.moveEffect(section.id, direction: -1) } label: { Image(systemName: "arrow.up") }.help("Move effect up")
                    Button { model.moveEffect(section.id, direction: 1) } label: { Image(systemName: "arrow.down") }.help("Move effect down")
                    Button { model.removeEffect(section.id) } label: { Image(systemName: "trash") }.help("Remove effect")
                }
            }
        }
    }

    private var animationInspector: some View {
        VStack(alignment: .leading, spacing: 8) {
            Menu {
                ForEach(model.animationKinds) { item in Button(item.label) { model.addAnimation(item.id) } }
            } label: { Label("Add Animation", systemImage: "plus") }.disabled(model.selectedLayer == nil || model.selectedLayer?.locked == true)
            ForEach(model.inspector.filter { $0.category == "animation" }.flatMap(\.children)) { section in
                InspectorStackCard(section: section, model: model) {
                    Button { model.removeAnimation(section.id) } label: { Image(systemName: "trash") }.help("Remove animation")
                }
            }
            if model.inspector.filter({ $0.category == "animation" }).flatMap(\.children).isEmpty {
                Text("Add a track to animate the selected layer. Use the playhead below the canvas to preview any frame.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

}

struct NativeExportSheet: View {
    @ObservedObject var model: StudioModel
    let exportAction: () -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Image(systemName: "square.and.arrow.up").font(.title2).foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Export Artwork").font(.title2.weight(.semibold))
                    Text("Save an image or an animated loop.").foregroundStyle(.secondary)
                }
            }
            Form {
                Picker("Format", selection: $model.exportFormat) {
                    Text("PNG · still image").tag("png")
                    Text("APNG · transparent animation").tag("apng")
                    Text("GIF · animated image").tag("gif")
                }
                Picker("Resolution", selection: $model.exportScale) {
                    Text("1×").tag(1); Text("2×").tag(2); Text("4×").tag(4)
                }
                if model.exportFormat != "png" {
                    Picker("Frame rate", selection: $model.exportFPS) {
                        Text("12 fps").tag(12); Text("24 fps").tag(24); Text("30 fps").tag(30)
                    }
                    HStack {
                        Text("Duration")
                        Spacer()
                        Text(String(format: "%.2f seconds", model.animationDuration)).foregroundStyle(.secondary)
                    }
                }
            }
            .formStyle(.grouped)
            .frame(minHeight: model.exportFormat == "png" ? 104 : 180)
            Text(model.exportFormat == "gif" ? "GIF uses a reduced color palette and one-bit transparency. APNG preserves smooth transparency." : "Transparency and layer effects are preserved. Document bounds include shadows and glows.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Export…", action: exportAction).buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(model.isExporting)
            }
        }.padding(24).frame(width: 430)
    }
}

extension Notification.Name {
    static let wordwarpShowExport = Notification.Name("WordWarpShowExport")
    static let wordwarpToggleInspector = Notification.Name("WordWarpToggleInspector")
    static let wordwarpShowStyles = Notification.Name("WordWarpShowStyles")
}

/// A native search field keeps its own local text undo, separate from document history.
struct NativeStyleSearch: NSViewRepresentable {
    @Binding var text: String
    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }
    func makeNSView(context: Context) -> NSSearchField {
        let field = NSSearchField()
        field.placeholderString = "Find a style"
        field.sendsSearchStringImmediately = true
        field.delegate = context.coordinator
        field.setAccessibilityLabel("Find a style")
        return field
    }
    func updateNSView(_ field: NSSearchField, context: Context) {
        context.coordinator.text = $text
        if field.stringValue != text { field.stringValue = text }
    }
    final class Coordinator: NSObject, NSSearchFieldDelegate {
        var text: Binding<String>
        init(text: Binding<String>) { self.text = text }
        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSSearchField else { return }
            text.wrappedValue = field.stringValue
        }
    }
}
