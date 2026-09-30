import AppKit
import SwiftUI

struct InspectorAction: Identifiable {
    let id: String
    let label: String
    let kind: String
    init?(_ object: [String: Any]) {
        guard let id = object["id"] as? String, let label = object["label"] as? String else { return nil }
        self.id = id; self.label = label; kind = object["kind"] as? String ?? ""
    }
}

struct InspectorField: Identifiable {
    struct Option: Identifiable {
        let value: Any
        let label: String
        var id: String { String(describing: value) }
    }
    let id: String
    let label: String
    let type: String
    let value: Any
    let minimum: Double?
    let maximum: Double?
    let step: Double
    let options: [Option]
    let multiline: Bool
    let integer: Bool
    let maxLength: Int?
    init?(_ object: [String: Any]) {
        guard let id = object["id"] as? String, let label = object["label"] as? String,
              let type = object["type"] as? String, let value = object["value"] else { return nil }
        self.id = id; self.label = label; self.type = type; self.value = value
        minimum = object["min"] as? Double; maximum = object["max"] as? Double
        step = object["step"] as? Double ?? 1
        multiline = object["multiline"] as? Bool ?? false
        integer = object["integer"] as? Bool ?? false
        maxLength = object["maxLength"] as? Int
        options = (object["options"] as? [[String: Any]] ?? []).compactMap {
            guard let value = $0["value"], let label = $0["label"] as? String else { return nil }
            return Option(value: value, label: label)
        }
    }
}

struct InspectorSection: Identifiable {
    let id: String
    let label: String
    let category: String
    let fields: [InspectorField]
    let children: [InspectorSection]
    let actions: [InspectorAction]
    init?(_ object: [String: Any]) {
        guard let id = object["id"] as? String, let label = object["label"] as? String else { return nil }
        self.id = id; self.label = label; category = object["category"] as? String ?? "object"
        fields = (object["fields"] as? [[String: Any]] ?? []).compactMap(InspectorField.init)
        children = (object["children"] as? [[String: Any]] ?? []).compactMap(InspectorSection.init)
        actions = (object["actions"] as? [[String: Any]] ?? []).compactMap(InspectorAction.init)
    }
    var allFields: [InspectorField] { fields + children.flatMap(\.allFields) }
}

/// Inspector metadata describes values, while every control remains a native AppKit/SwiftUI view.
struct InspectorSectionView: View {
    let section: InspectorSection
    let value: (InspectorField) -> Any
    let change: (InspectorField, Any) -> Void
    let action: (InspectorAction) -> Void
    var depth = 0
    let excludedFields: Set<String>
    @State private var expanded: Bool

    init(section: InspectorSection, value: @escaping (InspectorField) -> Any,
         change: @escaping (InspectorField, Any) -> Void, action: @escaping (InspectorAction) -> Void,
         depth: Int = 0, defaultExpanded: Bool = true, excludedFields: Set<String> = []) {
        self.section = section; self.value = value; self.change = change; self.action = action; self.depth = depth
        self.excludedFields = excludedFields
        _expanded = State(initialValue: defaultExpanded && (depth == 0 || section.label == "Text & font"))
    }

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            InspectorSectionContentView(section: section, value: value, change: change, action: action,
                                        depth: depth, excludedFields: excludedFields)
            .padding(.top, 10)
            .padding(.bottom, 4)
        } label: {
            Text(section.label).font(depth == 0 ? .headline : .subheadline.weight(.semibold))
        }
        .padding(.vertical, depth == 0 ? 9 : 4)
    }
}

/// Shared contents allow stack cards to own their single header without nesting another disclosure.
struct InspectorSectionContentView: View {
    let section: InspectorSection
    let value: (InspectorField) -> Any
    let change: (InspectorField, Any) -> Void
    let action: (InspectorAction) -> Void
    var depth = 0
    var excludedFields: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            ForEach(section.fields.filter { !excludedFields.contains($0.id) }) { field in
                InspectorFieldView(field: field, value: { value(field) }, change: { change(field, $0) })
            }
            ForEach(section.children) { child in
                InspectorSectionView(section: child, value: value, change: change, action: action, depth: depth + 1)
            }
            if !section.actions.isEmpty {
                HStack {
                    ForEach(section.actions) { item in
                        Button(item.label) { action(item) }.controlSize(.small)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }
}

struct InspectorStackCard<Actions: View>: View {
    let section: InspectorSection
    @ObservedObject var model: StudioModel
    @ViewBuilder let actions: () -> Actions
    @State private var expanded = false

    private var enabledField: InspectorField? {
        section.fields.first { $0.type == "boolean" && $0.id.hasSuffix("/enabled") }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let enabled = enabledField {
                Toggle("Enable \(section.label)", isOn: Binding(
                    get: { model.fieldValue(enabled) as? Bool ?? false },
                    set: { model.changeField(enabled, $0) }))
                    .toggleStyle(.checkbox).labelsHidden().fixedSize()
                    .help("Enable or disable \(section.label)")
            }
            DisclosureGroup(isExpanded: $expanded) {
                if expanded {
                    InspectorSectionContentView(section: section, value: model.fieldValue,
                        change: model.changeField, action: model.inspectorAction,
                        excludedFields: Set(enabledField.map { [$0.id] } ?? []))
                        .padding(.top, 10)
                }
            } label: {
                HStack(spacing: 8) {
                    Text(section.label).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Spacer(minLength: 0)
                    actions().buttonStyle(.borderless).font(.caption)
                }
            }
        }
        .padding(8)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
        .disabled(model.selectedLayer?.locked == true)
    }
}

struct InspectorFieldView: View {
    let field: InspectorField
    let value: () -> Any
    let change: (Any) -> Void

    private var number: Double { value() as? Double ?? 0 }
    private var string: String { value() as? String ?? String(describing: value()) }
    private var rgba: [Double] { value() as? [Double] ?? [0, 0, 0, 1] }
    private var color: Color {
        let components = rgba.count == 4 ? rgba : [0, 0, 0, 1]
        return Color(.sRGB, red: components[0], green: components[1], blue: components[2], opacity: components[3])
    }

    @ViewBuilder var body: some View {
        switch field.type {
        case "boolean":
            Toggle(field.label, isOn: Binding(get: { value() as? Bool ?? false }, set: { change($0) }))
                .toggleStyle(.checkbox)
        case "number":
            HStack(spacing: 8) {
                Text(field.label).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
                TextField(field.label, value: Binding(get: { number }, set: { change(clamp($0)) }), format: .number.precision(.fractionLength(0...3)))
                    .labelsHidden().multilineTextAlignment(.trailing).textFieldStyle(.roundedBorder)
                    .frame(width: 79).accessibilityLabel(field.label)
                Stepper(field.label, onIncrement: { change(clamp(number + field.step)) }, onDecrement: { change(clamp(number - field.step)) })
                    .labelsHidden().fixedSize()
            }
        case "choice":
            HStack(spacing: 8) {
                Text(field.label).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
                Picker(field.label, selection: Binding(get: { choiceID(value()) }, set: { id in
                    if let option = field.options.first(where: { choiceID($0.value) == id }) { change(option.value) }
                })) {
                    ForEach(field.options) { option in Text(option.label).tag(choiceID(option.value)) }
                }
                .labelsHidden().frame(maxWidth: 160).accessibilityLabel(field.label)
            }
        case "color":
            ColorPicker(field.label, selection: Binding(get: { color }, set: { selected in
                guard let converted = NSColor(selected).usingColorSpace(.sRGB) else { return }
                change([converted.redComponent, converted.greenComponent, converted.blueComponent, converted.alphaComponent])
            }), supportsOpacity: true)
            .font(.subheadline)
        case "curve":
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(field.label).font(.subheadline)
                    Spacer()
                    Menu {
                        Button("Linear") { change((0..<max(2, rgba.count)).map { Double($0) / Double(max(1, rgba.count - 1)) }) }
                        Button("Smooth") { change((0..<max(2, rgba.count)).map { index in
                            let t = Double(index) / Double(max(1, rgba.count - 1)); return t * t * (3 - 2 * t)
                        }) }
                        Button("Invert") { change(rgba.map { 1 - $0 }) }
                    } label: { Image(systemName: "ellipsis.circle") }.menuStyle(.borderlessButton).fixedSize()
                }
                CurveControl(samples: rgba, change: change).frame(height: 66)
                Text("Drag the curve to shape its response.").font(.caption2).foregroundStyle(.secondary)
            }
        default:
            if field.multiline {
                VStack(alignment: .leading, spacing: 6) {
                    Text(field.label).font(.subheadline)
                    TextEditor(text: Binding(get: { string }, set: { change($0) }))
                        .font(.system(size: 15)).scrollContentBackground(.hidden)
                        .padding(6).frame(minHeight: 88, maxHeight: 140)
                        .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.quaternary))
                        .accessibilityLabel(field.label)
                }
            } else {
                HStack(spacing: 8) {
                    Text(field.label).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
                    TextField(field.label, text: Binding(get: { string }, set: { change($0) }))
                        .labelsHidden().textFieldStyle(.roundedBorder).frame(maxWidth: 170)
                        .accessibilityLabel(field.label)
                }
            }
        }
    }

    private func clamp(_ input: Double) -> Double { min(field.maximum ?? .greatestFiniteMagnitude, max(field.minimum ?? -.greatestFiniteMagnitude, input)) }
    private func choiceID(_ value: Any) -> String { String(describing: value) }
}

struct CurveControl: View {
    let samples: [Double]
    let change: (Any) -> Void
    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                let bounds = CGRect(origin: .zero, size: size)
                context.fill(Path(roundedRect: bounds, cornerRadius: 5), with: .color(Color(nsColor: .textBackgroundColor)))
                var grid = Path()
                for fraction in [0.25, 0.5, 0.75] {
                    grid.move(to: CGPoint(x: size.width * fraction, y: 0)); grid.addLine(to: CGPoint(x: size.width * fraction, y: size.height))
                    grid.move(to: CGPoint(x: 0, y: size.height * fraction)); grid.addLine(to: CGPoint(x: size.width, y: size.height * fraction))
                }
                context.stroke(grid, with: .color(.secondary.opacity(0.15)), lineWidth: 1)
                var curve = Path()
                for (index, sample) in samples.enumerated() {
                    let point = CGPoint(x: Double(index) / Double(max(1, samples.count - 1)) * size.width,
                                        y: (1 - min(1, max(0, sample))) * size.height)
                    if index == 0 { curve.move(to: point) } else { curve.addLine(to: point) }
                }
                context.stroke(curve, with: .color(.accentColor), lineWidth: 2)
            }
            .gesture(DragGesture(minimumDistance: 0).onChanged { position in
                guard !samples.isEmpty else { return }
                var edited = samples
                let index = min(samples.count - 1, max(0, Int((position.location.x / geometry.size.width * Double(samples.count - 1)).rounded())))
                edited[index] = min(1, max(0, 1 - Double(position.location.y / geometry.size.height)))
                change(edited)
            })
        }
        .accessibilityLabel("Editable response curve")
    }
}
