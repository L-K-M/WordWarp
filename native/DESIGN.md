# Native editor design

The native apps expose the implemented WordWarp editor through platform controls while
sharing document schemas, history, geometry, effects, animation and export. The embedded
web view contains only the artboard and its direct-manipulation handles.

## macOS

A persistent Layers/Styles sidebar gives the composition a stable structure. A compact
Select/Pan strip contains canvas modes; separate Insert commands add text and stamps.
Panel navigation stays in its sidebar or inspector. The right inspector changes
between Object, Effects, Motion and Canvas, with disclosure groups for detailed settings.
Effects are ordered front to back, like the layer list. A footer holds playback and zoom.

This organization draws on [Pixelmator's separate layers, canvas and contextual tool pane](https://support.apple.com/en-sg/guide/pixelmator-pro/pix96e754af4/mac)
and [Acorn's tool palette and inspector](https://flyingmeat.com/acorn/docs/tools_palette.html).
The implementation uses SwiftUI/AppKit controls, system colors, native color selection,
standard document menus and save/open panels. Numeric values remain precisely editable;
contours have an interactive curve control. Advanced controls stay collapsed until needed.

Effect and animation cards share one compact header containing enable checkbox,
disclosure, title and actions. Collapsing a card removes its body and body padding;
the remaining height comes entirely from the header. Effect ordering and deletion
remain available without expanding detailed controls.

## Ubuntu

GTK4/libadwaita provides the same desktop organization as macOS, with native layer
lists, searchable style choices, precise numeric inputs, color dialogs, text editing,
and open/save dialogs. Only the artboard lives in WebKitGTK. Standard Linux keyboard
shortcuts use Control; system colors and widgets follow the desktop theme.

The `.deb` bundles Python and the shared canvas assets and depends on Ubuntu's GTK,
libadwaita and WebKitGTK libraries. Documents open through desktop file association
or the native Open command. Recovery lives in the user's XDG state directory.
The desktop application uses one process for normal activation to avoid competing
writes to its recovery file. Diagnostic self-tests run separately with isolated state.

## Android

The canvas remains visible while a focused panel shows Edit, Effects or Motion. Layers
and searchable style catalogs use sheets; document and export choices use system file
pickers. Tablets move the inspector alongside the canvas and use a navigation rail.
The canvas refits when the available area changes, including the software keyboard.

This follows Android's [supporting-pane guidance](https://developer.android.com/develop/adaptive-apps/guides/build-a-supporting-pane-layout)
and [partial bottom-sheet pattern](https://developer.android.com/develop/ui/compose/components/bottom-sheets-partial).
Compose controls provide touch-sized targets, exact numeric entry, sliders, searchable
choices, RGBA color selection and curve editing. Back dismisses the focused surface.
Rotation preserves acknowledged documents and pending native edits/file delivery.

## Web

The web editor uses Object/Effects/Motion/Canvas inspectors and the same compact
effect/animation header organization. Semantic metadata supplies field labels,
choices, ranges, paint groups and curves for deeper controls, while React renders
browser controls. The web's full font catalog and interactive gradient editor remain
available. All hosts use the same document validation, renderer and export semantics.

## Capability map

| Editing task | Native representation |
| --- | --- |
| Text, fonts, paragraph layout | Native editor and typography inspector |
| Stamps and multiple layers | Catalog, layer list, ordering, lock/visibility, duplicate/delete |
| Position, scale, rotation, skew | Canvas handles and precise transform fields |
| Envelope, perspective, mesh, path warp | Contextual warp controls and point/node fields |
| Fill, strokes, bevel, extrusion, shadows, glows, textures, post effects | Reorderable effect stack with semantic subgroups |
| Paint and gradients | Native colors, ramp choices, editable stops and interpolation |
| Animation | Track list, parameters, seed/duration, playback and scrubber |
| Document and canvas | Native name/size/background/crop/padding/light controls |
| Editable files | Validated and migrated .wordwarp JSON |
| Export | PNG, APNG, GIF; native destinations and shared bounds/frame budgets |

Control definitions use stable identity-based IDs, never host-generated property paths.
Edits are validated inside history transactions. Rapid native input is reconciled with
engine acknowledgements without letting older values overwrite newer typing. Canvas
gestures produce one undo entry per gesture; arrow-key nudges merge while repeated.

The full-editor scope is the implemented engine, not every future feature in PLAN.md.
Image/group layers, external asset textures and per-character animation staggering are
still unsupported. Native apps offer bundled fonts so offline documents render on all
three platforms. Runtime engines can differ in rasterization; output geometry/transparency and
visible appearance are checked without promising byte identity between platforms.
