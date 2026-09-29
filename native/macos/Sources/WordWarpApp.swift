import AppKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct Preset: Identifiable {
    let id: String
    let name: String
    let category: String
    let preview: [String]
    let animated: Bool
}

/// Serves only immutable files inside the application's bundled web resources.
final class BundledAssets: NSObject, WKURLSchemeHandler {
    let root: URL

    init(root: URL) { self.root = root.resolvingSymlinksInPath() }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              url.scheme == "wordwarp", url.host == "app",
              urlSchemeTask.request.httpMethod == "GET" else {
            urlSchemeTask.didFailWithError(URLError(.unsupportedURL))
            return
        }
        let file = root.appendingPathComponent(url.path).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/"),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let mime: String
        switch file.pathExtension.lowercased() {
        case "html": mime = "text/html"
        case "js", "mjs": mime = "text/javascript"
        case "css": mime = "text/css"
        case "json": mime = "application/json"
        case "svg": mime = "image/svg+xml"
        case "png": mime = "image/png"
        case "jpg", "jpeg": mime = "image/jpeg"
        case "woff": mime = "font/woff"
        case "woff2": mime = "font/woff2"
        case "ttf": mime = "font/ttf"
        case "otf": mime = "font/otf"
        case "wasm": mime = "application/wasm"
        default: mime = "application/octet-stream"
        }
        let response = URLResponse(url: url, mimeType: mime, expectedContentLength: data.count,
                                   textEncodingName: mime.hasPrefix("text/") ? "utf-8" : nil)
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

/// WKWebView retains message handlers; a weak forwarding object avoids a retain cycle.
final class BridgeHandler: NSObject, WKScriptMessageHandler {
    weak var owner: StudioModel?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receive(message)
    }
}

struct CanvasView: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

extension Color {
    init(presetHex: String) {
        let cleaned = presetHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let value = UInt64(cleaned, radix: 16) ?? 0x7A83A3
        self.init(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255,
                  blue: Double(value & 255) / 255)
    }
}

struct PresetRow: View {
    let preset: Preset
    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 7)
                .fill(LinearGradient(colors: (preset.preview.isEmpty ? ["#96C4FF", "#DB76C4"] : preset.preview).map { Color(presetHex: $0) },
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 31, height: 31)
                .overlay(Text("W").font(.system(size: 21, weight: .black, design: .rounded)).foregroundStyle(.white).shadow(radius: 2))
                .accessibilityHidden(true)
            Text(preset.name).lineLimit(2)
            Spacer(minLength: 0)
            if preset.animated {
                Image(systemName: "sparkles").font(.caption).foregroundStyle(.secondary)
                    .help("Animation is shown as a still image in this version")
            }
        }
        .padding(.vertical, 3)
    }
}

/// Preserve SwiftUI's window delegate while adding document-style close protection.
final class DocumentWindowDelegate: NSObject, NSWindowDelegate {
    weak var owner: StudioModel?
    weak var original: NSWindowDelegate?
    private var closeApproved = false
    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || (original?.responds(to: selector) ?? false)
    }
    override func forwardingTarget(for selector: Selector!) -> Any? {
        if original?.responds(to: selector) == true { return original }
        return super.forwardingTarget(for: selector)
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closeApproved { closeApproved = false; return original?.windowShouldClose?(sender) ?? true }
        guard let owner, owner.isDirty else { return original?.windowShouldClose?(sender) ?? true }
        owner.confirmReplacingDocument { [weak self, weak sender] in
            self?.closeApproved = true
            sender?.performClose(nil)
        }
        return false
    }
}

final class WordWarpAppDelegate: NSObject, NSApplicationDelegate {
    weak var model: StudioModel?
    var pendingOpenURL: URL?
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model, model.isDirty else { return .terminateNow }
        model.confirmReplacingDocument {
            NSApp.reply(toApplicationShouldTerminate: true)
        } cancelled: {
            NSApp.reply(toApplicationShouldTerminate: false)
        }
        return .terminateLater
    }
    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        guard let filename = filenames.first else { return }
        let url = URL(fileURLWithPath: filename)
        if let model { model.openDocument(at: url) } else { pendingOpenURL = url }
        sender.reply(toOpenOrPrint: .success)
    }
}

@main
struct WordWarpApp: App {
    @NSApplicationDelegateAdaptor(WordWarpAppDelegate.self) private var appDelegate
    @StateObject private var model = StudioModel()
    var body: some Scene {
        Window("WordWarp", id: "studio") {
            FullStudioView(model: model)
                .onAppear {
                    appDelegate.model = model
                    if let url = appDelegate.pendingOpenURL { appDelegate.pendingOpenURL = nil; model.openDocument(at: url) }
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                }
        }
        .defaultSize(width: 1380, height: 880)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Document", action: model.newDocument).keyboardShortcut("n")
                Button("Open…", action: model.chooseDocument).keyboardShortcut("o")
            }
            CommandGroup(replacing: .saveItem) {
                Button("Save", action: { model.saveDocument() }).keyboardShortcut("s").disabled(!model.isReady)
                Button("Save As…", action: { model.saveDocument(saveAs: true) }).keyboardShortcut("s", modifiers: [.command, .shift]).disabled(!model.isReady)
            }
            CommandGroup(replacing: .undoRedo) {
                Button("Undo", action: model.undo).keyboardShortcut("z").disabled(!model.canUndo)
                Button("Redo", action: model.redo).keyboardShortcut("z", modifiers: [.command, .shift]).disabled(!model.canRedo)
            }
            CommandGroup(after: .importExport) {
                Button("Export Artwork…") { NotificationCenter.default.post(name: .wordwarpShowExport, object: nil) }
                    .keyboardShortcut("e", modifiers: [.command, .shift]).disabled(!model.isReady || model.isExporting)
            }
            CommandMenu("Layer") {
                Button("New Text Layer", action: model.addText).keyboardShortcut("t", modifiers: [.command, .shift])
                Menu("New Stamp") {
                    ForEach(model.stamps) { stamp in Button(stamp.label) { model.addStamp(stamp.id) } }
                }
                Divider()
                Button("Duplicate Layer") { if let id = model.selectedLayerID { model.duplicateLayer(id) } }
                    .keyboardShortcut("j").disabled(model.selectedLayer == nil || model.selectedLayer?.locked == true)
                Button("Delete Layer") { if let id = model.selectedLayerID { model.deleteLayer(id) } }
                    .keyboardShortcut(.delete, modifiers: [.command]).disabled(model.selectedLayer == nil || model.selectedLayer?.locked == true)
                Divider()
                Button("Bring Forward") { if let id = model.selectedLayerID { model.moveLayer(id, direction: 1) } }
                    .keyboardShortcut("]").disabled(model.selectedLayer == nil)
                Button("Send Backward") { if let id = model.selectedLayerID { model.moveLayer(id, direction: -1) } }
                    .keyboardShortcut("[").disabled(model.selectedLayer == nil)
            }
            CommandGroup(after: .sidebar) {
                Button("Show Styles") { NotificationCenter.default.post(name: .wordwarpShowStyles, object: nil) }.keyboardShortcut("f", modifiers: [.command, .shift])
                Button("Show/Hide Inspector") { NotificationCenter.default.post(name: .wordwarpToggleInspector, object: nil) }.keyboardShortcut("i", modifiers: [.command, .option])
                Divider()
                Button("Zoom In") { model.setZoom(model.zoom * 1.2) }.keyboardShortcut("+")
                Button("Zoom Out") { model.setZoom(model.zoom / 1.2) }.keyboardShortcut("-")
                Button("Fit Canvas", action: model.fitCanvas).keyboardShortcut("0")
                Button("Actual Size") { model.setZoom(1) }.keyboardShortcut("1")
            }
            CommandGroup(replacing: .help) {
                Button("Licenses…", action: model.showLicenses)
            }
        }
    }
}
