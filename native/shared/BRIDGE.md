# Native editor bridge, version 2

Bundled native.html contains only the interactive canvas. SwiftUI/AppKit, Compose and
GTK4/libadwaita own editor controls, document pickers, and export destinations.
No server/service worker.
Hosts call window.wordwarp.dispatch(command) using JSON serialization. Engine events go to
window.webkit.messageHandlers.wordwarp.postMessage (objects) or
window.WordWarpAndroid.postMessage (JSON strings). Only bundled origins may use the bridge.
macOS WKWebView and Ubuntu WebKitGTK use the object transport at
`wordwarp://app/native.html`; Android uses its bundled WebViewAssetLoader origin.
Adding the GTK host does not change the bridge or document schema version.

## Commands
Every command includes type plus the listed properties.
- setText {text}: selected text, max 5000 UTF-16 characters.
- setPreset {presetId}: selected text or stamp.
- select {elementId:string|null}; addText {}; addStamp {stampId}.
- nudge {dx:number,dy:number}: shift selected layer by canvas units (each -100…100).
- layer {action:"duplicate"|"delete"|"up"|"down"|"front"|"back"|"visibility"|"lock",elementId}.
- setField {fieldId,value}; inspectorAction {actionId}. IDs come from current metadata.
- effect {action:"add"|"delete"|"up"|"down"|"toggle",kind?:string,effectId?:string}.
- animation {action:"add"|"delete"|"toggle",kind?:string,animationId?:string}.
- undo {}; redo {}.
- newDocument {id?:string}; restore {id?:string,document,presetId?:string|null}.
- getDocument {id}: validated snapshot after preceding edits.
- setView {tool?:"select"|"pan",zoom?:number,fit?:boolean}. Absolute zoom 0.05…8; fit recenters.
- playback {playing?:boolean,time?:number}. Normalized loop time 0…1.
- export {id,format:"png"|"apng"|"gif",scale:1|2|3|4,fps?:number}. FPS 1…30.
- exportPng {id,scale:1|2}: compatibility alias.

Structural edits stop playback. Locked layers reject editing but allow unlock/visibility/selection.
Document/state layer order is back to front; native lists display it reversed.

## Events
- ready {version:2,presets:PresetSummary[],stamps:Choice[],effectKinds:Choice[],animationKinds:Choice[],state:State}.
- state {state:State}: document/history/selection updates.
- view {view:View}: viewport/playback updates, no autosave required.
- rendered {revision,width,height}.
- document {id,document}: response to getDocument.
- restored {id?:string}: successful restore/new.
- exportProgress {id,progress:number}: 0…1.
- export {id,filename,mimeType,base64,width,height,frameCount?:number,fps?:number,reduced?:boolean}.
- error {id?:string,message}: correlated errors clear pending operations.

State = {text,presetId,canUndo,canRedo,revision,document,selectedElementId,layers,inspector,view}.
text is selected text or empty; presetId:string|null.
layers = [{id,name,type,visible,locked}].
View = {tool:"select"|"pan",zoom:number,playing:boolean,time:number,duration:number}.
Choice = {value:string,label:string,category?:string}.
PresetSummary = {id,name,category,preview:string[],animated:boolean}.

inspector is sections {id,label,category,fields,children?,actions?}.
Top category is "object"|"effects"|"animation"|"document".
Fields = {id,label,type,value,min?,max?,step?,integer?,maxLength?,options?:[{value,label}],multiline?}.
Types = number|boolean|text|choice|color (RGBA 0…1 array)|curve (number array).
Actions = {id,label,kind,…}. Hosts echo only field/action IDs.
Internal paths/operations are diagnostic, never interpreted by hosts.
Nested sections provide semantic paint/gradient/contour/lighting groups.
The metadata also powers deeper web inspector controls; native hosts never need a
generic JSON editor. Effect/animation child section IDs identify their corresponding
effect/track. Hosts may render their enabled field, disclosure, title and structural
actions in one header, leaving no body space while collapsed. Host UI arrangement
does not alter command semantics or the document's back-to-front order.

Open/restore use existing schema migrations. Preview/export share rendering. Gestures use
bounded undo transactions. Saved .wordwarp files are plain document JSON, interoperable
with web editor; document schema remains version 3. Exports snapshot at receipt. Animation
reports budget-adjusted frame rates. Hosts validate request IDs/base64 and use native file dialogs.
Bundled font choices render offline. Missing imported fonts produce a useful error.

Hosts must reconcile pending field values with state acknowledgements so earlier
events cannot overwrite newer native input. A recovery snapshot that retains drafts
also needs the selected element identity: restore the document, select that element,
wait for its state/inspector acknowledgement, then send valid draft field IDs.
Do not overwrite recovery storage with an intermediate restore state before that
sequence finishes. Keep the saved-document baseline separate so recovered unsaved
changes continue to prompt before close or replacement.
