import AppKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

final class StudioModel: NSObject, ObservableObject, WKNavigationDelegate {
    @Published private(set) var text = ""
    @Published private(set) var presets: [Preset] = []
    @Published private(set) var selectedPresetID: String?
    @Published private(set) var canUndo = false
    @Published private(set) var canRedo = false
    @Published private(set) var isReady = false
    @Published private(set) var hasRendered = false
    @Published private(set) var isExporting = false
    @Published private(set) var status = "Opening your studio…"
    @Published private(set) var errorMessage: String?
    @Published private(set) var fatalErrorMessage: String?
    @Published private(set) var canvasSize = ""
    @Published var exportScale = 1
    @Published var exportFormat = "png"
    @Published var exportFPS = 24
    @Published private(set) var exportProgress = 0.0
    @Published private(set) var layers: [LayerSummary] = []
    @Published private(set) var selectedLayerID: String?
    @Published private(set) var stamps: [CatalogItem] = []
    @Published private(set) var effectKinds: [CatalogItem] = []
    @Published private(set) var animationKinds: [CatalogItem] = []
    @Published private(set) var inspector: [InspectorSection] = []
    @Published var inspectorTab = "object"
    @Published private(set) var canvasTool = "select"
    @Published private(set) var zoom = 1.0
    @Published private(set) var isPlaying = false
    @Published private(set) var animationTime = 0.0
    @Published private(set) var animationDuration = 2.0
    @Published private(set) var hasAnimation = false
    @Published private(set) var documentTitle = "Untitled"
    @Published private(set) var isDirty = false
    @Published private var fieldOverrides: [String: Any] = [:]
    let webView: WKWebView

    private let bridge: BridgeHandler
    private var windowDelegate: DocumentWindowDelegate?
    private var historyKeyMonitor: Any?
    private var lastSnapshot: [String: Any]?
    private var pendingTextValues: [String] = []
    private var pendingFields: [String: [Any]] = [:]
    private var currentDocumentURL: URL?
    private var savedDocumentData: Data?
    private var pendingDocuments: [String: (URL, (Bool) -> Void)] = [:]
    private var pendingRestores: [String: URL?] = [:]
    private var pendingOpenURL: URL?
    private var exportRequest: (id: String, destination: URL, format: String)?
    private var loadTimeout: DispatchWorkItem?
    private var exportTimeout: DispatchWorkItem?
    private let snapshotURL: URL
    private let selfTestPath: String?
    private let selfTestImportURL: URL?
    private var testImportedDocument: [String: Any]?
    private let testStartedAt = Date()
    private var testStage = "ready"
    private var testPresetID: String?
    private var testOriginalPresetID: String?
    private var testRendered = false
    private var testFinished = false
    private var testLayerID: String?
    private var testEffectCount = 0
    private var testExportDescriptions: [String] = []

    override init() {
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "--self-test"), args.indices.contains(index + 1) {
            selfTestPath = args[index + 1]
        } else {
            selfTestPath = nil
        }
        if let index = args.firstIndex(of: "--self-test-import"), args.indices.contains(index + 1) {
            selfTestImportURL = URL(fileURLWithPath: args[index + 1])
        } else {
            selfTestImportURL = nil
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        snapshotURL = selfTestPath.map { URL(fileURLWithPath: $0 + ".document.json") }
            ?? support.appendingPathComponent("WordWarp/native-document.json")
        bridge = BridgeHandler()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.setURLSchemeHandler(BundledAssets(root: Bundle.main.resourceURL!.appendingPathComponent("Web")),
                                          forURLScheme: "wordwarp")
        configuration.userContentController.add(bridge, name: "wordwarp")
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        bridge.owner = self
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")
        // Native text controls have private undo managers. Route the document's
        // standard history shortcuts through its shared engine, matching Edit menu
        // and toolbar behavior, while leaving system file/dialog editing alone.
        historyKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, event.modifierFlags.contains(.command), !event.modifierFlags.contains(.option),
                  event.charactersIgnoringModifiers?.lowercased() == "z",
                  let window = self.webView.window, NSApp.keyWindow == window, window.attachedSheet == nil else { return event }
            if let editor = window.firstResponder as? NSTextView, editor.delegate is NSSearchField { return event }
            if window.firstResponder is NSSearchField { return event }
            if event.modifierFlags.contains(.shift) { self.redo() } else { self.undo() }
            return nil
        }
        if selfTestPath == nil,
           let data = try? Data(contentsOf: snapshotURL),
           data.count <= 20_000_000,
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            lastSnapshot = object
            if let path = object["fileURL"] as? String {
                currentDocumentURL = URL(fileURLWithPath: path)
                if let original = try? Data(contentsOf: currentDocumentURL!),
                   let originalObject = try? JSONSerialization.jsonObject(with: original) {
                    savedDocumentData = try? JSONSerialization.data(withJSONObject: originalObject, options: [.sortedKeys])
                }
            }
        }
        load()
        if selfTestPath != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in
                guard let self, !self.testFinished else { return }
                self.finishTest(false, "Timed out at stage \(self.testStage): \(self.errorMessage ?? self.status)")
            }
        }
    }

    deinit {
        if let historyKeyMonitor { NSEvent.removeMonitor(historyKeyMonitor) }
    }

    var selectedLayer: LayerSummary? { layers.first { $0.id == selectedLayerID } }

    var selectedPreset: Preset? { presets.first { $0.id == selectedPresetID } }

    func showLicenses() {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("Web/licenses/index.html"),
              FileManager.default.fileExists(atPath: url.path),
              NSWorkspace.shared.open(url) else {
            errorMessage = "Could not open the bundled licenses. Reinstall the app if its resources are missing."
            return
        }
    }

    func load() {
        loadTimeout?.cancel()
        exportTimeout?.cancel()
        isReady = false
        pendingTextValues.removeAll()
        pendingFields.removeAll()
        fieldOverrides.removeAll()
        hasRendered = false
        isExporting = false
        exportRequest = nil
        fatalErrorMessage = nil
        errorMessage = nil
        status = "Opening your studio…"
        webView.load(URLRequest(url: URL(string: "wordwarp://app/native.html")!))
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, !self.isReady else { return }
            self.failLoad("The canvas took too long to load. Try reopening it.")
        }
        loadTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: timeout)
    }

    func changeText(_ value: String) {
        // JavaScript's 5000-character bound counts UTF-16 code units. Preserve whole graphemes.
        var bounded = ""
        for character in value {
            let next = bounded + String(character)
            if next.utf16.count > 5000 { break }
            bounded = next
        }
        guard bounded != text, isReady else { return }
        text = bounded
        pendingTextValues.append(bounded)
        send(["type": "setText", "text": bounded])
    }

    func selectPreset(_ id: String?) {
        guard let id, id != selectedPresetID, isReady else { return }
        send(["type": "setPreset", "presetId": id])
    }

    func undo() { if canUndo { send(["type": "undo"]) } }
    func redo() { if canRedo { send(["type": "redo"]) } }

    private func send(_ command: [String: Any]) {
        guard isReady else { return }
        guard JSONSerialization.isValidJSONObject(command),
              let data = try? JSONSerialization.data(withJSONObject: command),
              let json = String(data: data, encoding: .utf8) else {
            errorMessage = "The edit could not be prepared. Please try again."
            return
        }
        webView.evaluateJavaScript("window.wordwarp.dispatch(\(json))") { [weak self] _, error in
            if let error { self?.reportError("Canvas communication failed: \(error.localizedDescription)") }
        }
    }

    func receive(_ message: WKScriptMessage) {
        guard message.name == "wordwarp", message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url,
              url.scheme == "wordwarp", url.host == "app", url.path == "/native.html",
              let event = message.body as? [String: Any], let type = event["type"] as? String else { return }
        switch type {
        case "ready":
            guard event["version"] as? Int == 2, let entries = event["presets"] as? [[String: Any]] else {
                failLoad("This canvas version is incompatible with the app.")
                return
            }
            presets = entries.compactMap { item in
                guard let id = item["id"] as? String, let name = item["name"] as? String,
                      let category = item["category"] as? String else { return nil }
                return Preset(id: id, name: name, category: category,
                              preview: item["preview"] as? [String] ?? [], animated: item["animated"] as? Bool ?? false)
            }
            stamps = (event["stamps"] as? [[String: Any]] ?? []).compactMap(CatalogItem.init)
            effectKinds = (event["effectKinds"] as? [[String: Any]] ?? []).compactMap(CatalogItem.init)
            animationKinds = (event["animationKinds"] as? [[String: Any]] ?? []).compactMap(CatalogItem.init)
            loadTimeout?.cancel()
            isReady = true
            status = "Ready"
            let saved = lastSnapshot
            applyState(event["state"] as? [String: Any], persist: false)
            if selfTestPath != nil {
                testOriginalPresetID = selectedPresetID
                testPresetID = presets.first { $0.id != selectedPresetID }?.id
                guard testPresetID != nil else { finishTest(false, "Preset catalogue is empty"); return }
                testStage = "text"
                changeText("N")
                changeText("Na")
                changeText("Native WordWarp")
            } else if let pending = pendingOpenURL {
                pendingOpenURL = nil
                readDocument(pending)
            } else if let document = saved?["document"] as? [String: Any] {
                send(["type": "restore", "document": document, "presetId": saved?["presetId"] ?? NSNull()])
            } else {
                savedDocumentData = canonicalDocument()
                isDirty = false
            }
        case "state":
            applyState(event["state"] as? [String: Any], persist: true)
            advanceTest()
        case "view":
            applyView(event["view"] as? [String: Any])
            advanceViewTest()
        case "document":
            receiveDocument(event)
        case "restored":
            errorMessage = nil
            if let id = event["id"] as? String, pendingRestores.keys.contains(id) {
                currentDocumentURL = pendingRestores.removeValue(forKey: id) ?? nil
                if let url = currentDocumentURL { lastSnapshot?["fileURL"] = url.path }
                else { lastSnapshot?.removeValue(forKey: "fileURL") }
                savedDocumentData = canonicalDocument()
                isDirty = false
                refreshWindow()
                saveSnapshot()
                status = currentDocumentURL == nil ? "New document" : "Opened \(currentDocumentURL!.lastPathComponent)"
            }
            advanceTest()
        case "exportProgress":
            if event["id"] as? String == exportRequest?.id {
                exportProgress = min(1, max(0, event["progress"] as? Double ?? 0))
                status = "Exporting \(exportRequest!.format.uppercased()) · \(Int(exportProgress * 100))%"
            }
        case "rendered":
            hasRendered = true
            testRendered = true
            if let width = event["width"] as? Int, let height = event["height"] as? Int {
                canvasSize = "\(width) × \(height)"
            }
        case "render-failed":
            let message = event["message"] as? String ?? "preview renderer failed"
            if selfTestPath != nil {
                finishTest(false, "Stage \(testStage): \(message)")
            } else {
                status = message
            }
        case "export":
            receiveExport(event)
        case "error":
            if let id = event["id"] as? String {
                if let pending = pendingDocuments.removeValue(forKey: id) { pending.1(false) }
                else if pendingRestores.keys.contains(id) { pendingRestores.removeValue(forKey: id) }
                else if id != exportRequest?.id { return }
            }
            pendingFields.removeAll()
            fieldOverrides.removeAll()
            reportError(event["message"] as? String ?? "The canvas could not complete that action.")
        default: break
        }
    }

    private func applyState(_ state: [String: Any]?, persist: Bool) {
        guard let state, let incomingText = state["text"] as? String,
              let document = state["document"] as? [String: Any] else { return }
        // State events may trail typing. An old acknowledgement must never overwrite
        // text the native editor has already accepted (or move its insertion point).
        if let acknowledgement = pendingTextValues.firstIndex(of: incomingText) {
            pendingTextValues.removeFirst(acknowledgement + 1)
        }
        if pendingTextValues.isEmpty { text = incomingText }
        selectedPresetID = state["presetId"] as? String
        canUndo = state["canUndo"] as? Bool ?? false
        canRedo = state["canRedo"] as? Bool ?? false
        selectedLayerID = state["selectedElementId"] as? String
        layers = (state["layers"] as? [[String: Any]] ?? []).compactMap(LayerSummary.init)
        inspector = (state["inspector"] as? [[String: Any]] ?? []).compactMap(InspectorSection.init)
        let allFields = inspector.flatMap(\.allFields)
        for (id, queued) in pendingFields {
            guard let field = allFields.first(where: { $0.id == id }) else {
                pendingFields.removeValue(forKey: id); fieldOverrides.removeValue(forKey: id); continue
            }
            if let index = queued.firstIndex(where: { equalValues($0, field.value) }) {
                let remaining = Array(queued.dropFirst(index + 1))
                if remaining.isEmpty { pendingFields.removeValue(forKey: id); fieldOverrides.removeValue(forKey: id) }
                else { pendingFields[id] = remaining }
            }
        }
        applyView(state["view"] as? [String: Any])
        let elements = document["elements"] as? [[String: Any]] ?? []
        hasAnimation = elements.contains { element in
            (element["animations"] as? [[String: Any]] ?? []).contains { $0["enabled"] as? Bool == true }
        }
        lastSnapshot = ["document": document, "presetId": selectedPresetID as Any? ?? NSNull()]
        if let url = currentDocumentURL { lastSnapshot?["fileURL"] = url.path }
        documentTitle = currentDocumentURL?.deletingPathExtension().lastPathComponent ?? document["name"] as? String ?? "Untitled"
        if persist { isDirty = canonicalDocument() != savedDocumentData; saveSnapshot() }
        refreshWindow()
    }

    private func saveSnapshot() {
        guard let snapshot = lastSnapshot else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: snapshot)
            try FileManager.default.createDirectory(at: snapshotURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: snapshotURL, options: .atomic)
        } catch {
            errorMessage = "Your changes could not be saved locally: \(error.localizedDescription)"
        }
    }

    func exportPNG() { exportFormat = "png"; exportArtwork() }

    func exportArtwork() {
        guard isReady, !isExporting else { return }
        // The canvas belongs to the document window even while AppKit moves key
        // focus between panels. Capture its owner before creating the save panel.
        let ownerWindow = webView.window ?? NSApp.mainWindow ?? NSApp.keyWindow
        let panel = NSSavePanel()
        panel.title = "Export " + exportFormat.uppercased()
        panel.prompt = "Export"
        panel.allowedContentTypes = exportFormat == "gif" ? [.gif] : [.png]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = documentTitle + (exportFormat == "gif" ? ".gif" : ".png")
        panel.message = "Save \(exportFormat.uppercased()) artwork at \(exportScale)× resolution."
        isExporting = true
        status = "Choose where to export…"
        let completed: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self else { return }
            guard response == .OK, let destination = panel.url else {
                self.isExporting = false
                self.status = "Export cancelled"
                return
            }
            self.requestExport(to: destination)
        }
        if let window = ownerWindow { panel.beginSheetModal(for: window, completionHandler: completed) }
        else { panel.begin(completionHandler: completed) }
    }

    private func requestExport(to destination: URL) {
        let id = UUID().uuidString
        exportRequest = (id, destination, exportFormat)
        exportProgress = 0
        isExporting = true
        errorMessage = nil
        status = "Rendering " + exportFormat.uppercased() + "…"
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.exportRequest?.id == id else { return }
            self.reportError("Export took too long. Please try again at a lower resolution or frame rate.")
        }
        exportTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 180, execute: timeout)
        send(["type": "export", "id": id, "format": exportFormat, "scale": exportScale, "fps": exportFPS])
    }

    private func receiveExport(_ event: [String: Any]) {
        guard let request = exportRequest, event["id"] as? String == request.id else { return }
        let expectedMIME = request.format == "gif" ? "image/gif" : "image/png"
        guard let mime = event["mimeType"] as? String,
              mime == expectedMIME || (request.format == "apng" && mime == "image/apng"),
              let encoded = event["base64"] as? String, encoded.utf8.count <= 280_000_000,
              let data = Data(base64Encoded: encoded), data.count > 8 else {
            reportError("The canvas returned invalid image data. Please try exporting again.")
            return
        }
        let validSignature = request.format == "gif"
            ? String(data: data.prefix(6), encoding: .ascii)?.hasPrefix("GIF8") == true
            : data.prefix(8) == Data([137, 80, 78, 71, 13, 10, 26, 10])
        guard validSignature, let image = NSBitmapImageRep(data: data), image.pixelsWide > 0, image.pixelsHigh > 0 else {
            reportError("The exported image could not be decoded.")
            return
        }
        do {
            try data.write(to: request.destination, options: .atomic)
            exportTimeout?.cancel()
            exportRequest = nil
            isExporting = false
            exportProgress = 1
            status = "Saved \(request.destination.lastPathComponent) · \(image.pixelsWide) × \(image.pixelsHigh)"
            if let count = event["frameCount"] as? Int { status += " · \(count) frames" }
            if event["reduced"] as? Bool == true { status += " · adjusted frame rate" }
            if selfTestPath != nil {
                advanceExportTest(data: data, image: image, destination: request.destination)
            }
        } catch {
            reportError("The image could not be saved: \(error.localizedDescription)")
        }
    }

    private func reportError(_ message: String) {
        errorMessage = message
        status = "Action failed"
        exportTimeout?.cancel()
        exportRequest = nil
        isExporting = false
        if selfTestPath != nil { finishTest(false, "Stage \(testStage): \(message)") }
    }

    private func failLoad(_ message: String) {
        fatalErrorMessage = message
        isReady = false
        reportError(message)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let allowed = url?.scheme == "wordwarp" && url?.host == "app" && url?.path == "/native.html"
        decisionHandler(allowed && navigationAction.targetFrame?.isMainFrame == true ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failLoad("The canvas could not load: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failLoad("The canvas could not load: \(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        failLoad("The canvas stopped unexpectedly. Reopen it to recover your last edit.")
    }

    private func equalValues(_ lhs: Any, _ rhs: Any) -> Bool {
        guard let left = try? JSONSerialization.data(withJSONObject: [lhs], options: [.sortedKeys]),
              let right = try? JSONSerialization.data(withJSONObject: [rhs], options: [.sortedKeys]) else { return false }
        return left == right
    }

    func fieldValue(_ field: InspectorField) -> Any { fieldOverrides[field.id] ?? field.value }

    func changeField(_ field: InspectorField, _ value: Any) {
        guard isReady else { return }
        let safeValue: Any
        if let text = value as? String, let maximum = field.maxLength {
            var bounded = ""
            for character in text {
                let next = bounded + String(character)
                if next.utf16.count > maximum { break }
                bounded = next
            }
            safeValue = bounded
        } else if field.integer, let number = value as? Double { safeValue = number.rounded() }
        else { safeValue = value }
        guard !equalValues(fieldValue(field), safeValue) else { return }
        fieldOverrides[field.id] = safeValue
        pendingFields[field.id, default: []].append(safeValue)
        isDirty = true
        refreshWindow()
        send(["type": "setField", "fieldId": field.id, "value": safeValue])
    }

    func inspectorAction(_ action: InspectorAction) { send(["type": "inspectorAction", "actionId": action.id]) }
    func selectLayer(_ id: String?) { send(["type": "select", "elementId": id as Any? ?? NSNull()]) }
    func addText() { inspectorTab = "object"; send(["type": "addText"]) }
    func addStamp(_ id: String) { inspectorTab = "object"; send(["type": "addStamp", "stampId": id]) }
    func duplicateLayer(_ id: String) { send(["type": "layer", "action": "duplicate", "elementId": id]) }
    func deleteLayer(_ id: String) { send(["type": "layer", "action": "delete", "elementId": id]) }
    func toggleLayerLock(_ layer: LayerSummary) { send(["type": "layer", "action": "lock", "elementId": layer.id]) }
    func toggleLayerVisibility(_ layer: LayerSummary) { send(["type": "layer", "action": "visibility", "elementId": layer.id]) }
    func moveLayer(_ id: String, direction: Int) { send(["type": "layer", "action": direction > 0 ? "up" : "down", "elementId": id]) }
    func reorderLayerRows(fromOffsets source: IndexSet, toOffset destination: Int) {
        let frontToBack = Array(layers.reversed())
        // The native list allows single selection. Each command identifies the layer,
        // so delayed acknowledgements cannot reorder a different row.
        guard let from = source.first, frontToBack.indices.contains(from) else { return }
        let target = destination > from ? destination - 1 : destination
        let distance = target - from
        if distance != 0 {
            for _ in 0..<abs(distance) { moveLayer(frontToBack[from].id, direction: distance > 0 ? -1 : 1) }
        }
    }
    func addEffect(_ kind: String) { send(["type": "effect", "action": "add", "kind": kind]) }
    func removeEffect(_ id: String) { send(["type": "effect", "action": "delete", "effectId": id]) }
    func moveEffect(_ id: String, direction: Int) { send(["type": "effect", "action": direction < 0 ? "up" : "down", "effectId": id]) }
    func addAnimation(_ kind: String) { send(["type": "animation", "action": "add", "kind": kind]) }
    func removeAnimation(_ id: String) { send(["type": "animation", "action": "delete", "animationId": id]) }
    func chooseTool(_ tool: String) { send(["type": "setView", "tool": tool]) }
    func setZoom(_ value: Double) { send(["type": "setView", "zoom": min(8, max(0.05, value))]) }
    func fitCanvas() { send(["type": "setView", "fit": true]) }
    func setPlaying(_ playing: Bool) { send(["type": "playback", "playing": playing]) }
    func scrub(_ time: Double) { send(["type": "playback", "playing": false, "time": min(1, max(0, time))]) }

    private func applyView(_ view: [String: Any]?) {
        guard let view else { return }
        canvasTool = view["tool"] as? String ?? "select"
        zoom = view["zoom"] as? Double ?? 1
        isPlaying = view["playing"] as? Bool ?? false
        animationTime = view["time"] as? Double ?? 0
        animationDuration = view["duration"] as? Double ?? 2
    }

    private func canonicalDocument() -> Data? {
        guard let document = lastSnapshot?["document"] else { return nil }
        return try? JSONSerialization.data(withJSONObject: document, options: [.sortedKeys])
    }

    private func refreshWindow() {
        if let window = webView.window, windowDelegate == nil {
            let delegate = DocumentWindowDelegate()
            delegate.owner = self
            delegate.original = window.delegate
            windowDelegate = delegate
            window.delegate = delegate
        }
        webView.window?.isDocumentEdited = isDirty
        webView.window?.representedURL = currentDocumentURL
        if let document = lastSnapshot?["document"] as? [String: Any] {
            documentTitle = currentDocumentURL?.deletingPathExtension().lastPathComponent ?? document["name"] as? String ?? "Untitled"
        }
    }

    func confirmReplacingDocument(_ proceed: @escaping () -> Void, cancelled: @escaping () -> Void = {}) {
        guard isDirty else { proceed(); return }
        let alert = NSAlert()
        alert.messageText = "Save changes to “\(documentTitle)”?"
        alert.informativeText = "Save a WordWarp document to keep this composition before continuing."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Don’t Save")
        let finished: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            switch response {
            case .alertFirstButtonReturn:
                self?.saveDocument { saved in if saved { proceed() } else { cancelled() } }
            case .alertThirdButtonReturn: proceed()
            default: cancelled()
            }
        }
        if let window = webView.window { alert.beginSheetModal(for: window, completionHandler: finished) }
        else { finished(alert.runModal()) }
    }

    func newDocument() {
        guard isReady else { return }
        confirmReplacingDocument { [weak self] in
            guard let self else { return }
            let id = UUID().uuidString
            self.pendingRestores[id] = .some(nil)
            self.errorMessage = nil
            self.send(["type": "newDocument", "id": id])
        }
    }

    func chooseDocument() {
        guard isReady else { return }
        let owner = webView.window ?? NSApp.mainWindow
        let panel = NSOpenPanel()
        panel.title = "Open WordWarp Document"
        panel.allowedContentTypes = [UTType.wordwarpDocument, .json]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        let completion: (NSApplication.ModalResponse) -> Void = { [weak self] result in
            guard result == .OK, let url = panel.url else { return }
            self?.openDocument(at: url)
        }
        if let owner { panel.beginSheetModal(for: owner, completionHandler: completion) }
        else { panel.begin(completionHandler: completion) }
    }

    func openDocument(at url: URL) {
        guard isReady else { pendingOpenURL = url; return }
        confirmReplacingDocument { [weak self] in self?.readDocument(url) }
    }

    private func readDocument(_ url: URL) {
        errorMessage = nil
        status = "Opening " + url.lastPathComponent + "…"
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= 20_000_000 else { throw CocoaError(.fileReadTooLarge) }
            let data = try Data(contentsOf: url)
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw CocoaError(.fileReadCorruptFile)
            }
            let id = UUID().uuidString
            pendingRestores[id] = .some(url)
            send(["type": "restore", "id": id, "document": object])
        } catch { reportError("The document could not be opened: \(error.localizedDescription)") }
    }

    func saveDocument(saveAs: Bool = false, completion: @escaping (Bool) -> Void = { _ in }) {
        guard isReady else { completion(false); return }
        if !saveAs, let destination = currentDocumentURL { requestDocument(to: destination, completion: completion); return }
        let owner = webView.window ?? NSApp.mainWindow
        let panel = NSSavePanel()
        panel.title = "Save WordWarp Document"
        panel.allowedContentTypes = [.wordwarpDocument]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = documentTitle + ".wordwarp"
        let finished: (NSApplication.ModalResponse) -> Void = { [weak self] result in
            guard result == .OK, let url = panel.url else { completion(false); return }
            self?.requestDocument(to: url, completion: completion)
        }
        if let owner { panel.beginSheetModal(for: owner, completionHandler: finished) }
        else { panel.begin(completionHandler: finished) }
    }

    private func requestDocument(to destination: URL, completion: @escaping (Bool) -> Void = { _ in }) {
        let id = UUID().uuidString
        pendingDocuments[id] = (destination, completion)
        // Queued behind pending edit commands so Cmd-S always captures the latest input.
        send(["type": "getDocument", "id": id])
    }

    private func receiveDocument(_ event: [String: Any]) {
        guard let id = event["id"] as? String, let pending = pendingDocuments.removeValue(forKey: id),
              let document = event["document"] as? [String: Any] else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: document, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: pending.0, options: .atomic)
            currentDocumentURL = pending.0
            savedDocumentData = try JSONSerialization.data(withJSONObject: document, options: [.sortedKeys])
            isDirty = canonicalDocument() != savedDocumentData || !pendingFields.isEmpty || !pendingTextValues.isEmpty
            lastSnapshot?["fileURL"] = currentDocumentURL?.path
            saveSnapshot()
            refreshWindow()
            status = "Saved \(pending.0.lastPathComponent)"
            NSDocumentController.shared.noteNewRecentDocumentURL(pending.0)
            pending.1(true)
        } catch {
            pending.1(false)
            reportError("The document could not be saved: \(error.localizedDescription)")
        }
    }

    private func advanceExportTest(data: Data, image: NSBitmapImageRep, destination: URL) {
        guard let path = selfTestPath else { return }
        testExportDescriptions.append("\(exportFormat.uppercased()) \(image.pixelsWide)×\(image.pixelsHigh) (\(data.count) bytes)")
        if testStage == "png" {
            testStage = "apng"
            exportFormat = "apng"
            exportFPS = 12
            requestExport(to: URL(fileURLWithPath: path + ".apng.png"))
        } else if testStage == "apng" {
            testStage = "gif"
            exportFormat = "gif"
            requestExport(to: URL(fileURLWithPath: path + ".gif"))
        } else if testStage == "gif", let fixture = selfTestImportURL {
            do {
                let data = try Data(contentsOf: fixture)
                guard let document = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    finishTest(false, "Import fixture is not a document object"); return
                }
                testImportedDocument = document
                testStage = "fixtureOpen"
                readDocument(fixture)
            } catch { finishTest(false, "Import fixture could not be read: \(error.localizedDescription)") }
        } else if testStage == "gif" || testStage == "fixtureExport" {
            let imported = selfTestImportURL == nil ? "" : "; cross-platform fixture import, lossless save and PNG export"
            finishTest(testRendered, "Rapid typing, presets/history, native inspector, layers/stamps/lock/visibility, effects, animation/playback/zoom, atomic autosave, .wordwarp save/open and exports passed: " + testExportDescriptions.joined(separator: "; ") + imported)
        }
    }

    private var testFields: [InspectorField] { inspector.flatMap(\.allFields) }
    private func testField(_ suffix: String) -> InspectorField? { testFields.first { $0.id.hasSuffix(suffix) } }
    private var testEffects: [InspectorSection] { inspector.first { $0.id == "effects" }?.children ?? [] }

    private func advanceTest() {
        guard selfTestPath != nil else { return }
        switch testStage {
        case "fixtureOpen" where pendingRestores.isEmpty && !canUndo:
            guard let expected = testImportedDocument, let actual = lastSnapshot?["document"], equalValues(expected, actual) else {
                finishTest(false, "Cross-platform import changed document data"); return
            }
            testStage = "fixtureSave"
            let destination = URL(fileURLWithPath: selfTestPath! + ".imported.wordwarp")
            requestDocument(to: destination) { [weak self] saved in
                guard let self else { return }
                guard saved, let data = try? Data(contentsOf: destination),
                      let object = try? JSONSerialization.jsonObject(with: data), self.equalValues(expected, object) else {
                    self.finishTest(false, "Cross-platform roundtrip changed document data"); return
                }
                self.testStage = "fixtureExport"
                self.exportFormat = "png"; self.exportScale = 1
                self.requestExport(to: URL(fileURLWithPath: self.selfTestPath! + ".imported.png"))
            }
        case "text" where !pendingTextValues.isEmpty:
            if text != "Native WordWarp" { finishTest(false, "A delayed state acknowledgement reverted native typing") }
        case "text" where text == "Native WordWarp" && canUndo:
            testStage = "preset"; selectPreset(testPresetID)
        case "preset" where selectedPresetID == testPresetID:
            testStage = "undo"; undo()
        case "undo" where selectedPresetID == testOriginalPresetID && canRedo:
            testStage = "redo"; redo()
        case "redo" where selectedPresetID == testPresetID && !canRedo:
            testStage = "restore"
            do {
                let data = try Data(contentsOf: snapshotURL)
                guard let saved = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let document = saved["document"] as? [String: Any] else {
                    finishTest(false, "Saved document snapshot was invalid"); return
                }
                send(["type": "restore", "document": document, "presetId": saved["presetId"] ?? NSNull()])
            } catch { finishTest(false, "Autosaved snapshot could not be read: \(error.localizedDescription)") }
        case "restore" where selectedPresetID == testPresetID && text == "Native WordWarp" && !canUndo && !canRedo:
            guard let size = testField("/layout/size") else { finishTest(false, "Missing native typography metadata"); return }
            testStage = "size"; changeField(size, 64.0)
        case "size" where testField("/layout/size")?.value as? Double == 64:
            testStage = "stamp"; addStamp("star")
        case "stamp" where layers.count == 2 && selectedLayer?.type == "shape":
            guard let id = selectedLayerID else { return }
            testStage = "duplicate"; duplicateLayer(id)
        case "duplicate" where layers.count == 3:
            guard let layer = selectedLayer else { return }
            testLayerID = layer.id; testStage = "lock"; toggleLayerLock(layer)
        case "lock" where selectedLayer?.locked == true:
            guard let layer = selectedLayer else { return }
            testStage = "hide"; toggleLayerVisibility(layer)
        case "hide" where selectedLayer?.visible == false:
            guard let layer = selectedLayer else { return }
            testStage = "show"; toggleLayerVisibility(layer)
        case "show" where selectedLayer?.visible == true:
            guard let layer = selectedLayer else { return }
            testStage = "unlock"; toggleLayerLock(layer)
        case "unlock" where selectedLayer?.locked == false:
            guard let id = testLayerID else { return }
            testStage = "delete"; deleteLayer(id)
        case "delete" where layers.count == 2:
            testEffectCount = testEffects.count
            testStage = "effect"; addEffect("stroke")
        case "effect" where testEffects.count > testEffectCount:
            guard let width = testFields.first(where: { $0.id.contains("/effect:") && $0.id.hasSuffix("/width") }) else {
                finishTest(false, "Missing effect parameter metadata"); return
            }
            testStage = "effectField"; changeField(width, 7.0)
        case "effectField" where testFields.contains(where: { $0.id.contains("/effect:") && $0.id.hasSuffix("/width") && $0.value as? Double == 7 }):
            testStage = "animation"; addAnimation("pulse")
        case "animation" where hasAnimation:
            guard let duration = testFields.first(where: { $0.id.contains("/animation:") && $0.id.hasSuffix("/duration") }) else {
                finishTest(false, "Missing animation parameter metadata"); return
            }
            testStage = "duration"; changeField(duration, 0.25)
        case "duration" where animationDuration <= 0.3:
            testStage = "play"; setPlaying(true)
        case "open" where pendingRestores.isEmpty && !canUndo && layers.count == 2 && hasAnimation:
            testStage = "png"
            exportFormat = "png"; exportScale = 1
            requestExport(to: URL(fileURLWithPath: selfTestPath!))
        default: break
        }
    }

    private func advanceViewTest() {
        guard selfTestPath != nil else { return }
        if testStage == "play" && isPlaying {
            testStage = "scrub"; scrub(0.25)
        } else if testStage == "scrub" && !isPlaying && abs(animationTime - 0.25) < 0.001 {
            testStage = "zoom"; setZoom(0.75)
        } else if testStage == "zoom" && abs(zoom - 0.75) < 0.001 {
            testStage = "fit"; fitCanvas()
        } else if testStage == "fit" {
            testStage = "save"
            let destination = URL(fileURLWithPath: selfTestPath! + ".wordwarp")
            requestDocument(to: destination) { [weak self] saved in
                guard let self else { return }
                guard saved else { self.finishTest(false, "Native .wordwarp save failed"); return }
                self.testStage = "open"
                self.readDocument(destination)
            }
        }
    }

    private func finishTest(_ success: Bool, _ message: String) {
        guard !testFinished else { return }
        testFinished = true
        let elapsed = String(format: "%.2f", Date().timeIntervalSince(testStartedAt))
        let line = "WORDWARP_SELF_TEST \(success ? "PASS" : "FAIL") [\(elapsed)s]: \(message)\n"
        FileHandle.standardOutput.write(Data(line.utf8))
        if let path = selfTestPath {
            try? Data(line.utf8).write(to: URL(fileURLWithPath: path + ".result"), options: .atomic)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { exit(success ? 0 : 1) }
    }
}


extension UTType {
    static let wordwarpDocument = UTType(exportedAs: "app.wordwarp.document", conformingTo: .json)
}
