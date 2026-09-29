#!/usr/bin/env python3
"""Native GTK editor. Only the artboard is rendered by the bundled WebKit engine."""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import struct
import sys
import tempfile
import time
from urllib.parse import unquote, urlparse
import uuid

import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("WebKit", "6.0")
from gi.repository import Adw, Gdk, Gio, GLib, Gtk, WebKit  # noqa: E402

APP_ID = "app.wordwarp.WordWarp"
ENTRY = "wordwarp://app/native.html"
LOCAL_WEB = Path(__file__).resolve().parent / "web"
WEB = Path(os.environ.get("WORDWARP_WEB_ROOT", str(LOCAL_WEB if LOCAL_WEB.exists() else Path(__file__).resolve().parents[2] / "dist-native"))).resolve()
MAX_DOCUMENT = 20 * 1024 * 1024
MAX_EXPORT = 48 * 1024 * 1024


def fingerprint(value):
    def normalize(item):
        if isinstance(item, float) and item.is_integer():
            return int(item)
        if isinstance(item, dict):
            return {key: normalize(val) for key, val in item.items()}
        if isinstance(item, list):
            return [normalize(val) for val in item]
        return item
    return hashlib.sha256(json.dumps(normalize(value), sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".wordwarp-", delete=False) as output:
            temporary = Path(output.name)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def read_document(path: Path):
    with path.open("rb") as stream:
        data = stream.read(MAX_DOCUMENT + 1)
    if len(data) > MAX_DOCUMENT:
        raise ValueError("The document is too large.")
    value = json.loads(data)
    if not isinstance(value, dict):
        raise ValueError("The file must contain a WordWarp document.")
    return value


def box(vertical=False, spacing=6):
    return Gtk.Box(orientation=Gtk.Orientation.VERTICAL if vertical else Gtk.Orientation.HORIZONTAL, spacing=spacing)


def padded(widget, amount=12):
    for side in ("top", "bottom", "start", "end"):
        getattr(widget, "set_margin_" + side)(amount)
    return widget


def clear(container):
    while container.get_first_child():
        container.remove(container.get_first_child())


def button(label, callback, icon=None, tooltip=None):
    widget = Gtk.Button(icon_name=icon) if icon else Gtk.Button(label=label)
    widget.connect("clicked", lambda *_: callback())
    widget.set_tooltip_text(tooltip or label)
    return widget


def scrolled(child, width=-1):
    scroll = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER, vexpand=True)
    if width > 0:
        scroll.set_size_request(width, -1)
    scroll.set_child(child)
    return scroll


def all_fields(sections):
    for section in sections:
        yield from section.get("fields", [])
        yield from all_fields(section.get("children", []))


class Studio(Adw.ApplicationWindow):
    def __init__(self, app, test_path=None, open_path=None):
        super().__init__(application=app, title="WordWarp", default_width=1360, default_height=850)
        self.test_path = Path(test_path) if test_path else None
        self.open_path = Path(open_path) if open_path else None
        self.snapshot_path = (Path(test_path + ".recovery.json") if test_path else
                              Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state"))) / "wordwarp/document.json")
        self.state, self.view, self.catalog = {}, {}, {}
        self.ready, self.updating, self.rendered = False, False, -1
        self.saved_fingerprint, self.current_path = None, None
        self.pending_fields, self.field_widgets, self.fields = {}, {}, {}
        self.pending_documents, self.pending_restores, self.pending_exports = {}, {}, {}
        self.expanded, self.cards = {}, {}
        self.structure = None
        self.layer_structure = None
        self.category = "object"
        self.recovery_timer = 0
        self.exporting = False
        self.allow_close = False
        self.test_stage, self.test_started, self.test_error = 0, time.monotonic(), None
        self.test_snapshot = None
        self.test_exports = []
        self.recovery = None
        self.pending_recovery = None
        if not self.test_path and self.snapshot_path.exists():
            try:
                self.recovery = read_document(self.snapshot_path)
            except (OSError, ValueError):
                pass
        self.build_window()
        self.connect("close-request", self.close_requested)
        self.web.load_uri(ENTRY)
        GLib.timeout_add_seconds(30, self.check_startup)
        if self.test_path:
            GLib.timeout_add(150, self.self_test)

    @property
    def dirty(self):
        for recovery in (self.pending_recovery, self.recovery):
            if not recovery:
                continue
            if recovery.get("drafts"):
                return True
            if isinstance(recovery.get("document"), dict):
                try:
                    if fingerprint(recovery["document"]) != recovery.get("baseline"):
                        return True
                except (TypeError, ValueError):
                    pass  # Invalid recovery documents still pass through engine validation.
        doc = self.state.get("document")
        return (bool(self.pending_fields) or bool(self.pending_recovery and self.pending_recovery.get("drafts"))
                or (bool(doc) and fingerprint(doc) != self.saved_fingerprint))

    def build_window(self):
        root = box(True, 0)
        self.header = Adw.HeaderBar()
        self.window_title = Adw.WindowTitle(title="WordWarp", subtitle="Opening canvas…")
        self.header.set_title_widget(self.window_title)
        file_menu = Gio.Menu()
        for title, name, callback, shortcut in (
            ("New", "new", lambda: self.guard_changes(lambda: self.restore(None)), "<Control>n"),
            ("Open…", "open", lambda: self.guard_changes(self.choose_open), "<Control>o"),
            ("Save", "save", self.save, "<Control>s"),
            ("Save As…", "save-as", lambda: self.save(force_dialog=True), "<Control><Shift>s"),
            ("Export…", "export", self.export_dialog, "<Control><Shift>e"),
            ("Undo", "undo", lambda: self.dispatch("undo"), "<Control>z"),
            ("Redo", "redo", lambda: self.dispatch("redo"), "<Control><Shift>z"),
            ("Fit Canvas", "fit", lambda: self.dispatch("setView", fit=True), "<Control>0"),
            ("Reload Canvas", "reload", self.reload_canvas, None),
            ("Licenses…", "licenses", self.show_licenses, None),
        ):
            action = Gio.SimpleAction.new(name, None)
            action.connect("activate", lambda _action, _param, cb=callback: cb())
            self.add_action(action)
            file_menu.append(title, "win." + name)
            if shortcut:
                self.get_application().set_accels_for_action("win." + name, [shortcut])
        self.header.pack_start(Gtk.MenuButton(icon_name="open-menu-symbolic", menu_model=file_menu, tooltip_text="Document menu"))
        insert = Gtk.MenuButton(label="Insert")
        popover = Gtk.Popover()
        items = padded(box(True))
        items.append(button("Add Text", lambda: (popover.popdown(), self.dispatch("addText")), icon=None))
        items.append(button("Add Stamp…", lambda: (popover.popdown(), self.catalog_dialog("Add Stamp", "stamps", lambda item: self.dispatch("addStamp", stampId=item["value"])))) )
        popover.set_child(items)
        insert.set_popover(popover)
        self.header.pack_start(insert)
        self.undo = button("Undo", lambda: self.dispatch("undo"), "edit-undo-symbolic")
        self.redo = button("Redo", lambda: self.dispatch("redo"), "edit-redo-symbolic")
        self.header.pack_start(self.undo)
        self.header.pack_start(self.redo)
        self.export_button = button("Export…", self.export_dialog)
        self.export_button.add_css_class("suggested-action")
        self.header.pack_end(self.export_button)
        root.append(self.header)

        self.workspace = box(False, 0)
        self.workspace.set_vexpand(True)
        sidebar = padded(box(True), 8)
        sidebar.set_size_request(224, -1)
        sidebar.set_hexpand(False)
        left_stack = Gtk.Stack(vexpand=True)
        sidebar.append(Gtk.StackSwitcher(stack=left_stack, halign=Gtk.Align.CENTER))
        self.layer_list = Gtk.ListBox(selection_mode=Gtk.SelectionMode.SINGLE)
        self.layer_list.add_css_class("navigation-sidebar")
        self.layer_list.connect("row-selected", self.layer_selected)
        layers = box(True)
        layers.append(scrolled(self.layer_list))
        actions = box()
        for label, action, icon in (("Duplicate layer", "duplicate", "edit-copy-symbolic"), ("Move forward", "up", "go-up-symbolic"), ("Move backward", "down", "go-down-symbolic"), ("Delete layer", "delete", "user-trash-symbolic")):
            actions.append(button(label, lambda a=action: self.layer_action(a), icon))
        layers.append(actions)
        left_stack.add_titled(layers, "layers", "Layers")
        style_box = box(True)
        self.style_search = Gtk.SearchEntry(placeholder_text="Search styles")
        self.style_search.connect("search-changed", lambda *_: self.show_styles())
        style_box.append(self.style_search)
        self.style_list = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE)
        style_box.append(scrolled(self.style_list))
        left_stack.add_titled(style_box, "styles", "Styles")
        sidebar.append(left_stack)
        self.workspace.append(sidebar)
        self.workspace.append(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL))

        modes = padded(box(True), 6)
        self.select_mode = Gtk.ToggleButton(label="Select", tooltip_text="Select and transform layers")
        self.pan_mode = Gtk.ToggleButton(label="Pan", tooltip_text="Pan the canvas")
        self.pan_mode.set_group(self.select_mode)
        for widget, tool in ((self.select_mode, "select"), (self.pan_mode, "pan")):
            widget.connect("toggled", lambda w, t=tool: self.dispatch("setView", tool=t) if w.get_active() and not self.updating else None)
            modes.append(widget)
        self.workspace.append(modes)
        middle = box(True, 0)
        middle.set_hexpand(True)
        self.build_webview()
        middle.append(self.web)
        footer = padded(box(), 8)
        self.play = button("Play / pause animation", self.toggle_play, "media-playback-start-symbolic")
        footer.append(self.play)
        self.timeline = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 1, 0.001)
        self.timeline.set_draw_value(False)
        self.timeline.set_hexpand(True)
        self.timeline.connect("value-changed", lambda w: self.dispatch("playback", playing=False, time=w.get_value()) if not self.updating else None)
        footer.append(self.timeline)
        self.zoom_label = Gtk.Label(label="100%", width_chars=5)
        footer.append(self.zoom_label)
        footer.append(button("Zoom out", lambda: self.zoom_by(1 / 1.2), "zoom-out-symbolic"))
        footer.append(button("Fit", lambda: self.dispatch("setView", fit=True)))
        footer.append(button("Zoom in", lambda: self.zoom_by(1.2), "zoom-in-symbolic"))
        middle.append(footer)
        self.workspace.append(middle)
        self.workspace.append(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL))

        right = padded(box(True), 10)
        right.set_size_request(340, -1)
        right.set_hexpand(False)
        tabs = box(False, 2)
        first = None
        self.category_tabs = {}
        for label, category in (("Object", "object"), ("Effects", "effects"), ("Motion", "animation"), ("Canvas", "document")):
            tab = Gtk.ToggleButton(label=label, hexpand=True)
            self.category_tabs[category] = tab
            if first:
                tab.set_group(first)
            else:
                first = tab
            tab.connect("toggled", lambda w, c=category: self.set_category(c) if w.get_active() else None)
            tabs.append(tab)
        first.set_active(True)
        right.append(tabs)
        self.inspector_box = box(True, 8)
        self.inspector_scroll = scrolled(self.inspector_box)
        right.append(self.inspector_scroll)
        self.workspace.append(right)
        root.append(self.workspace)
        self.status = Gtk.Label(label="Opening bundled canvas…", xalign=0, ellipsize=3)
        self.status.set_margin_start(12)
        self.status.set_margin_end(12)
        self.status.set_margin_bottom(6)
        root.append(self.status)
        self.set_content(root)
        css = Gtk.CssProvider()
        css.load_from_data(b".stack-card { border: 1px solid alpha(currentColor,.12); border-radius: 8px; } .stack-card button.flat { padding: 3px; min-width: 22px; min-height: 22px; } .inspector-label { font-size: .9em; } .error-status { color: #c01c28; }")
        Gtk.StyleContext.add_provider_for_display(self.get_display(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    def show_licenses(self):
        path = WEB / "licenses/index.html"
        if not path.is_file():
            self.show_error("The bundled licenses are missing. Reinstall WordWarp to restore its resources.")
            return

        def finished(launcher, result, _data):
            try:
                launcher.launch_finish(result)
            except GLib.Error as error:
                self.show_error("Could not open the bundled licenses: " + error.message)

        # Open this fixed local document in the system browser. The canvas keeps
        # its original navigation and message-origin restrictions.
        Gtk.UriLauncher.new(path.as_uri()).launch(self, None, finished, None)

    def build_webview(self):
        context = WebKit.WebContext.new()
        context.register_uri_scheme("wordwarp", self.serve_asset)
        security = context.get_security_manager()
        security.register_uri_scheme_as_secure("wordwarp")
        security.register_uri_scheme_as_cors_enabled("wordwarp")
        self.manager = WebKit.UserContentManager.new()
        self.manager.connect("script-message-received::wordwarp", self.receive)
        self.manager.register_script_message_handler("wordwarp", None)
        self.web = WebKit.WebView(web_context=context, network_session=WebKit.NetworkSession.new_ephemeral(), user_content_manager=self.manager, hexpand=True, vexpand=True)
        self.web.set_size_request(260, 240)
        self.web.get_settings().set_enable_developer_extras(False)
        self.web.connect("decide-policy", self.navigation_policy)
        self.web.connect("permission-request", lambda _web, request: (request.deny(), True)[1])
        self.web.connect("web-process-terminated", lambda *_: self.engine_failed("Canvas stopped. Choose Reload Canvas from the document menu."))

    def serve_asset(self, request):
        try:
            uri = urlparse(request.get_uri())
            path = (WEB / unquote(uri.path).lstrip("/")).resolve()
            if uri.netloc != "app" or not path.is_relative_to(WEB) or not path.is_file():
                raise ValueError("Blocked asset path")
            mime = {".js": "text/javascript", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml"}.get(path.suffix) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            data = path.read_bytes()
            request.finish(Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(data)), len(data), mime)
        except (OSError, ValueError) as error:
            request.finish_error(GLib.Error.new_literal(Gio.io_error_quark(), str(error), Gio.IOErrorEnum.PERMISSION_DENIED))

    def navigation_policy(self, _web, decision, kind):
        if kind in (WebKit.PolicyDecisionType.NAVIGATION_ACTION, WebKit.PolicyDecisionType.NEW_WINDOW_ACTION):
            if decision.get_navigation_action().get_request().get_uri() != ENTRY or kind == WebKit.PolicyDecisionType.NEW_WINDOW_ACTION:
                decision.ignore()
                return True
        return False

    def dispatch(self, command_type, **properties):
        if not self.ready:
            return
        command = json.dumps({"type": command_type, **properties}, ensure_ascii=True, allow_nan=False)
        self.web.evaluate_javascript("window.wordwarp.dispatch(" + command + ")", -1, None, ENTRY, None, self.command_finished, None)

    def command_finished(self, web, result, _data):
        try:
            web.evaluate_javascript_finish(result)
        except GLib.Error as error:
            self.show_error("Canvas command failed: " + error.message)

    def receive(self, _manager, value):
        try:
            raw = value.to_json(0)
            if len(raw) > 70 * 1024 * 1024 or self.web.get_uri() != ENTRY:
                raise ValueError("Invalid canvas message")
            event = json.loads(raw)
            kind = event["type"]
            if kind == "ready":
                if event["version"] != 2:
                    raise ValueError("Unsupported canvas bridge version")
                self.catalog = event
                self.ready = True
                self.apply_state(event["state"])
                self.saved_fingerprint = fingerprint(self.state["document"])
                self.update_title()
                self.show_styles()
                self.set_status("Ready")
                if self.open_path:
                    path, self.open_path = self.open_path, None
                    self.open_file(path)
                elif self.recovery and isinstance(self.recovery.get("document"), dict):
                    recovery, self.recovery = self.recovery, None
                    self.pending_recovery = {**recovery, "_restoring": True}
                    def recovered():
                        self.saved_fingerprint = recovery.get("baseline")
                        self.current_path = Path(recovery["path"]) if recovery.get("path") else None
                        if self.pending_recovery:
                            self.pending_recovery["_restoring"] = False
                            self.resume_recovery()
                    self.restore(recovery["document"], after=recovered, recovering=True)
            elif kind == "state":
                self.apply_state(event["state"])
            elif kind == "view":
                self.view = event["view"]
                self.sync_view()
            elif kind == "rendered":
                self.rendered = event["revision"]
            elif kind == "restored":
                pending = self.pending_restores.pop(event.get("id"), None)
                if pending:
                    path, after = pending
                    self.current_path = path
                    self.saved_fingerprint = fingerprint(self.state["document"])
                    self.set_status("Opened " + path.name if path else "New document")
                    if after:
                        after()
                    self.update_title()
                    self.persist()
            elif kind == "document":
                callback = self.pending_documents.pop(event["id"], None)
                if callback:
                    callback(event["document"])
            elif kind == "exportProgress" and event.get("id") in self.pending_exports:
                self.set_status(f"Exporting… {event['progress']:.0%}")
            elif kind == "export":
                pending = self.pending_exports.pop(event["id"], None)
                if pending:
                    self.write_export(event, *pending)
            elif kind == "error":
                request_id = event.get("id")
                if self.pending_restores.pop(request_id, None):
                    self.pending_recovery = None
                self.pending_documents.pop(request_id, None)
                if self.pending_exports.pop(request_id, None):
                    self.exporting = False
                self.pending_fields.clear()
                self.sync_fields()
                self.show_error(event["message"])
        except (KeyError, TypeError, ValueError, OSError, GLib.Error) as error:
            self.show_error(str(error))

    def apply_state(self, state):
        if self.state.get("selectedElementId") != state.get("selectedElementId"):
            self.pending_fields.clear()
        self.state, self.view = state, state["view"]
        self.fields = {field["id"]: field for field in all_fields(state["inspector"])}
        for key, queue in list(self.pending_fields.items()):
            value = self.fields.get(key, {}).get("value")
            if value in queue:
                del queue[:queue.index(value) + 1]
            if not queue or key not in self.fields:
                del self.pending_fields[key]
        self.update_layers()
        self.update_inspector()
        self.sync_fields()
        self.sync_view()
        self.undo.set_sensitive(state["canUndo"])
        self.redo.set_sensitive(state["canRedo"])
        self.update_title()
        self.resume_recovery()
        if not self.recovery_timer:
            self.recovery_timer = GLib.timeout_add(300, self.persist)

    def resume_recovery(self):
        recovery = self.pending_recovery
        if not recovery or recovery.get("_restoring"):
            return
        selected = recovery.get("selectedElementId")
        if selected and any(layer["id"] == selected for layer in self.state.get("layers", [])):
            if self.state.get("selectedElementId") != selected:
                if not recovery.get("_selecting"):
                    recovery["_selecting"] = True
                    self.dispatch("select", elementId=selected)
                return
        # Wait for the selected layer's field allowlist before sending its drafts.
        # Until then, persist() preserves the original recovery record on disk.
        self.pending_recovery = None
        drafts = recovery.get("drafts", {})
        if isinstance(drafts, dict):
            for ident, value in drafts.items():
                if ident in self.fields:
                    self.set_field(ident, value)
        self.sync_fields()
        self.update_title()
        self.set_status("Recovered your previous document")
        self.persist()

    def update_title(self):
        name = self.current_path.stem if self.current_path else self.state.get("document", {}).get("name", "Untitled")
        self.set_title(name + (" •" if self.dirty else "") + " — WordWarp")
        self.window_title.set_title(name + (" •" if self.dirty else ""))
        self.window_title.set_subtitle("WordWarp")

    def set_status(self, text):
        self.status.remove_css_class("error-status")
        self.status.set_text(text)

    def show_error(self, text):
        self.status.add_css_class("error-status")
        self.status.set_text(text[:1000])
        self.export_button.set_sensitive(self.ready and not self.exporting)
        if self.test_path:
            self.test_error = text

    def engine_failed(self, message):
        self.ready = False
        self.show_error(message)

    def check_startup(self):
        if not self.ready:
            self.show_error("Canvas could not start. Check that the package and WebKitGTK are installed, then choose Reload Canvas.")
        return False

    def reload_canvas(self):
        if self.pending_recovery:
            self.recovery = {key: value for key, value in self.pending_recovery.items() if not key.startswith("_")}
        elif self.state.get("document") and not (self.recovery and not self.ready):
            # Persist native drafts before the old WebView and its acknowledgements
            # disappear. A crash during the new canvas startup must retain them too.
            self.persist()
            self.recovery = {"document": deepcopy(self.state["document"]), "baseline": self.saved_fingerprint, "path": str(self.current_path) if self.current_path else None,
                             "selectedElementId": self.state.get("selectedElementId"),
                             "drafts": {ident: values[-1] for ident, values in self.pending_fields.items()}}
        self.pending_recovery = None
        self.ready = False
        self.pending_fields.clear()
        self.pending_documents.clear()
        self.pending_restores.clear()
        self.pending_exports.clear()
        self.exporting = False
        self.web.load_uri(ENTRY)

    def update_layers(self):
        layers = self.state.get("layers", [])
        signature = [(item["id"], item["name"], item["visible"], item["locked"]) for item in layers]
        self.updating = True
        if signature != self.layer_structure:
            self.layer_structure = signature
            clear(self.layer_list)
            for layer in reversed(layers):
                row = Gtk.ListBoxRow()
                row.layer_id = layer["id"]
                content = padded(box(), 5)
                visible = Gtk.CheckButton(active=layer["visible"], tooltip_text="Show layer")
                visible.connect("toggled", lambda _w, ident=layer["id"]: self.dispatch("layer", action="visibility", elementId=ident) if not self.updating else None)
                content.append(visible)
                content.append(Gtk.Label(label=layer["name"], xalign=0, hexpand=True, ellipsize=3, max_width_chars=17))
                lock = Gtk.ToggleButton(icon_name="changes-prevent-symbolic" if layer["locked"] else "changes-allow-symbolic", active=layer["locked"], tooltip_text="Unlock layer" if layer["locked"] else "Lock layer")
                lock.add_css_class("flat")
                lock.connect("toggled", lambda _w, ident=layer["id"]: self.dispatch("layer", action="lock", elementId=ident) if not self.updating else None)
                content.append(lock)
                row.set_child(content)
                self.layer_list.append(row)
        row = self.layer_list.get_first_child()
        while row:
            if row.layer_id == self.state.get("selectedElementId"):
                self.layer_list.select_row(row)
            row = row.get_next_sibling()
        self.updating = False

    def layer_selected(self, _list, row):
        if row and not self.updating:
            self.dispatch("select", elementId=row.layer_id)

    def layer_action(self, action):
        ident = self.state.get("selectedElementId")
        if ident:
            self.dispatch("layer", action=action, elementId=ident)

    def show_styles(self):
        clear(self.style_list)
        query = self.style_search.get_text().casefold()
        for preset in self.catalog.get("presets", []):
            if query not in (preset["name"] + " " + preset["category"]).casefold():
                continue
            row = button(preset["name"], lambda ident=preset["id"]: self.dispatch("setPreset", presetId=ident))
            row.set_tooltip_text(preset["category"] + (" · Animated" if preset.get("animated") else ""))
            row.add_css_class("flat")
            self.style_list.append(row)

    def set_category(self, category):
        self.category = category
        self.structure = None
        if hasattr(self, "inspector_box"):
            self.update_inspector()
            self.sync_fields()

    def update_inspector(self):
        sections = [s for s in self.state.get("inspector", []) if s["category"] == self.category]
        def shape(section):
            return {"id": section["id"], "label": section["label"], "fields": [{k: v for k, v in f.items() if k not in ("value", "path")} for f in section["fields"]], "actions": section.get("actions", []), "children": [shape(child) for child in section.get("children", [])]}
        signature = json.dumps([self.category, self.state.get("selectedElementId"), [shape(s) for s in sections]], sort_keys=True)
        if self.structure == signature:
            return
        self.structure = signature
        self.field_widgets.clear()
        self.cards.clear()
        clear(self.inspector_box)
        if not sections:
            self.inspector_box.append(Gtk.Label(label="Select a layer to edit it.", wrap=True))
            return
        for section in sections:
            if self.category in ("effects", "animation"):
                for child in section.get("children", []):
                    self.inspector_box.append(self.stack_card(child, self.category))
                label = "Add Effect…" if self.category == "effects" else "Add Animation…"
                catalog = "effectKinds" if self.category == "effects" else "animationKinds"
                command = "effect" if self.category == "effects" else "animation"
                self.inspector_box.append(button(label, lambda c=catalog, cmd=command, title=label: self.catalog_dialog(title, c, lambda item: self.dispatch(cmd, action="add", kind=item["value"]))))
            else:
                self.inspector_box.append(self.section_widget(section, initially_open=True))

    def stack_card(self, section, category):
        frame = box(True, 0)
        frame.add_css_class("stack-card")
        header = padded(box(False, 4), 6)
        enabled = next((f for f in section["fields"] if f["label"] == "Enabled"), None)
        if enabled:
            check = Gtk.CheckButton(tooltip_text="Enable " + section["label"])
            self.bind(enabled, check, "boolean")
            header.append(check)
        ident = section["id"]
        is_open = self.expanded.get(ident, False)
        disclosure = Gtk.Button(icon_name="pan-down-symbolic" if is_open else "pan-end-symbolic", tooltip_text="Expand or collapse " + section["label"])
        disclosure.add_css_class("flat")
        title = Gtk.Button(label=section["label"], hexpand=True)
        title.add_css_class("flat")
        title.get_child().set_xalign(0)
        body = padded(box(True, 8), 10)
        body.set_margin_top(3)
        self.populate_section(body, section, omit_enabled=True)
        body.set_visible(is_open)
        def toggle():
            expanded = not body.get_visible()
            self.expanded[ident] = expanded
            body.set_visible(expanded)
            disclosure.set_icon_name("pan-down-symbolic" if expanded else "pan-end-symbolic")
        disclosure.connect("clicked", lambda *_: toggle())
        title.connect("clicked", lambda *_: toggle())
        header.append(disclosure)
        header.append(title)
        command, key = ("effect", "effectId") if category == "effects" else ("animation", "animationId")
        if category == "effects":
            for label, action, icon in (("Move effect up", "up", "go-up-symbolic"), ("Move effect down", "down", "go-down-symbolic")):
                action_button = button(label, lambda a=action: self.dispatch(command, action=a, **{key: ident}), icon)
                action_button.add_css_class("flat")
                header.append(action_button)
        remove = button("Delete " + section["label"], lambda: self.dispatch(command, action="delete", **{key: ident}), "user-trash-symbolic")
        remove.add_css_class("flat")
        header.append(remove)
        frame.append(header)
        frame.append(body)
        self.cards[ident] = (frame, header, body, disclosure)
        return frame

    def section_widget(self, section, initially_open=False):
        expander = Gtk.Expander(label=section["label"], expanded=self.expanded.get(section["id"], initially_open))
        expander.connect("notify::expanded", lambda w, _p: self.expanded.__setitem__(section["id"], w.get_expanded()))
        content = box(True, 9)
        content.set_margin_top(10)
        content.set_margin_bottom(10)
        self.populate_section(content, section)
        expander.set_child(content)
        return expander

    def populate_section(self, content, section, omit_enabled=False):
        for field in section["fields"]:
            if omit_enabled and field["label"] == "Enabled":
                continue
            content.append(self.field_widget(field))
        for action in section.get("actions", []):
            content.append(button(action["label"], lambda ident=action["id"]: self.dispatch("inspectorAction", actionId=ident)))
        for child in section.get("children", []):
            content.append(self.section_widget(child))

    def field_widget(self, field):
        label, kind = field["label"], field["type"]
        row = box(True if kind in ("text", "curve", "choice") else False)
        if kind != "boolean":
            text = Gtk.Label(label=label, xalign=0, hexpand=True, wrap=True)
            text.add_css_class("inspector-label")
            row.append(text)
        if kind == "boolean":
            widget = Gtk.CheckButton(label=label)
        elif kind == "number":
            step = field.get("step", 1)
            widget = Gtk.SpinButton.new_with_range(field.get("min", -1000000), field.get("max", 1000000), step)
            widget.set_digits(0 if step >= 1 else 3)
            widget.set_width_chars(7)
        elif kind == "choice":
            widget = Gtk.DropDown.new_from_strings([option["label"] for option in field.get("options", [])])
            widget.set_enable_search(True)
            widget.set_hexpand(True)
        elif kind == "text":
            if field.get("multiline"):
                widget = Gtk.TextView(wrap_mode=Gtk.WrapMode.WORD_CHAR, top_margin=8, bottom_margin=8, left_margin=8, right_margin=8)
                area = Gtk.ScrolledWindow(min_content_height=90, max_content_height=180, propagate_natural_height=True)
                area.add_css_class("frame")
                area.set_child(widget)
            else:
                widget = Gtk.Entry(hexpand=True)
        elif kind == "color":
            widget = Gtk.ColorButton(use_alpha=True, title=label)
        elif kind == "curve":
            widget = Gtk.DrawingArea(content_height=90, hexpand=True)
            widget.samples = field["value"]
            widget.set_draw_func(self.draw_curve)
            drag = Gtk.GestureDrag()
            drag.connect("drag-begin", lambda _g, x, y: self.curve_start(widget, field["id"], x, y))
            drag.connect("drag-update", lambda _g, x, y: self.curve_edit(widget, field["id"], widget.origin[0] + x, widget.origin[1] + y))
            widget.add_controller(drag)
            widget.set_tooltip_text(label + ": drag to draw a contour")
        else:
            return Gtk.Label(label=label + " is unavailable")
        self.bind(field, widget, kind)
        if kind != "boolean":
            text.set_mnemonic_widget(widget)
        row.append(area if kind == "text" and field.get("multiline") else widget)
        return row

    def bind(self, field, widget, kind):
        ident = field["id"]
        self.field_widgets[ident] = (widget, kind)
        if kind == "boolean":
            widget.connect("toggled", lambda w: self.set_field(ident, w.get_active()))
        elif kind == "number":
            widget.connect("value-changed", lambda w: self.set_field(ident, w.get_value()))
        elif kind == "choice":
            options = field.get("options", [])
            widget.connect("notify::selected", lambda w, _p: self.set_field(ident, options[w.get_selected()]["value"]) if w.get_selected() < len(options) else None)
        elif kind == "color":
            widget.connect("color-set", lambda w: self.set_field(ident, [w.get_rgba().red, w.get_rgba().green, w.get_rgba().blue, w.get_rgba().alpha]))
        elif kind == "text":
            if isinstance(widget, Gtk.TextView):
                widget.get_buffer().connect("changed", lambda buffer: self.set_field(ident, buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), True)))
            else:
                widget.connect("changed", lambda w: self.set_field(ident, w.get_text()))

    def set_field(self, ident, value):
        if self.updating or not self.ready or ident not in self.fields:
            return
        current = self.pending_fields.get(ident, [self.fields[ident]["value"]])[-1]
        if current == value:
            return
        self.pending_fields.setdefault(ident, []).append(value)
        self.dispatch("setField", fieldId=ident, value=value)

    def sync_fields(self):
        self.updating = True
        for ident, (widget, kind) in self.field_widgets.items():
            field = self.fields.get(ident)
            if not field:
                continue
            value = self.pending_fields.get(ident, [field["value"]])[-1]
            if kind == "boolean":
                widget.set_active(value)
            elif kind == "number" and widget.get_value() != value:
                widget.set_value(value)
            elif kind == "choice":
                index = next((i for i, option in enumerate(field.get("options", [])) if option["value"] == value), 0)
                widget.set_selected(index)
            elif kind == "color":
                color = Gdk.RGBA()
                color.red, color.green, color.blue, color.alpha = value
                widget.set_rgba(color)
            elif kind == "curve":
                widget.samples = value
                widget.queue_draw()
            elif kind == "text":
                if isinstance(widget, Gtk.TextView):
                    buffer = widget.get_buffer()
                    if buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), True) != value:
                        buffer.set_text(value)
                elif widget.get_text() != value:
                    widget.set_text(value)
        self.updating = False

    def draw_curve(self, widget, context, width, height):
        context.set_source_rgba(.45, .45, .5, .16)
        context.paint()
        samples = widget.samples
        context.set_source_rgb(.2, .5, .95)
        context.set_line_width(2)
        for index, value in enumerate(samples):
            point = (index / max(1, len(samples) - 1) * width, (1 - value) * height)
            context.move_to(*point) if index == 0 else context.line_to(*point)
        context.stroke()

    def curve_start(self, widget, ident, x, y):
        widget.origin = (x, y)
        self.curve_edit(widget, ident, x, y)

    def curve_edit(self, widget, ident, x, y):
        values = list(widget.samples)
        index = max(0, min(len(values) - 1, round(x / max(1, widget.get_width()) * (len(values) - 1))))
        values[index] = max(0, min(1, 1 - y / max(1, widget.get_height())))
        widget.samples = values
        widget.queue_draw()
        self.set_field(ident, values)

    def sync_view(self):
        self.updating = True
        self.select_mode.set_active(self.view.get("tool", "select") == "select")
        self.pan_mode.set_active(self.view.get("tool") == "pan")
        self.timeline.set_value(self.view.get("time", 0))
        self.zoom_label.set_text(f"{self.view.get('zoom', 1):.0%}")
        self.play.set_icon_name("media-playback-pause-symbolic" if self.view.get("playing") else "media-playback-start-symbolic")
        self.updating = False

    def toggle_play(self):
        self.dispatch("playback", playing=not self.view.get("playing", False))

    def zoom_by(self, factor):
        self.dispatch("setView", zoom=max(.05, min(8, self.view.get("zoom", 1) * factor)))

    def catalog_dialog(self, title, catalog, selected):
        dialog = Adw.Window(transient_for=self, modal=True, title=title, default_width=430, default_height=540)
        content = box(True, 8)
        content.append(Adw.HeaderBar())
        search = Gtk.SearchEntry(placeholder_text="Search")
        padded(search, 10)
        content.append(search)
        choices = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE)
        content.append(scrolled(choices))
        def refresh(*_):
            clear(choices)
            query = search.get_text().casefold()
            for item in self.catalog.get(catalog, []):
                if query in (item["label"] + " " + item.get("category", "")).casefold():
                    choices.append(button(item["label"], lambda val=item: (dialog.close(), selected(val))))
        search.connect("search-changed", refresh)
        refresh()
        dialog.set_content(content)
        dialog.present()

    def persist(self):
        self.recovery_timer = 0
        if (self.allow_close or not self.state.get("document") or self.pending_restores
                or self.pending_recovery or (self.recovery and not self.ready)):
            return False
        try:
            payload = {"document": self.state["document"], "baseline": self.saved_fingerprint, "path": str(self.current_path) if self.current_path else None,
                       "selectedElementId": self.state.get("selectedElementId"),
                       "drafts": {ident: values[-1] for ident, values in self.pending_fields.items()}}
            atomic_write(self.snapshot_path, json.dumps(payload, ensure_ascii=False, allow_nan=False).encode())
        except OSError as error:
            self.show_error("Could not save recovery data: " + str(error))
        return False

    def restore(self, doc, path=None, after=None, recovering=False):
        if not recovering:
            self.pending_recovery = None
            self.recovery = None
        ident = str(uuid.uuid4())
        self.pending_fields.clear()
        self.pending_restores[ident] = (path, after)
        self.dispatch("restore" if doc is not None else "newDocument", id=ident, **({"document": doc} if doc is not None else {}))
        self.operation_timeout(ident)

    def operation_timeout(self, ident):
        def expired():
            if ident in self.pending_restores or ident in self.pending_documents or ident in self.pending_exports:
                if self.pending_restores.pop(ident, None):
                    self.pending_recovery = None
                self.pending_documents.pop(ident, None)
                self.pending_exports.pop(ident, None)
                self.exporting = False
                self.show_error("The operation did not finish. Please try again.")
            return False
        GLib.timeout_add_seconds(120 if ident in self.pending_exports else 30, expired)

    def choose_file(self, save, title, name, pattern, callback):
        chooser = Gtk.FileChooserNative(title=title, transient_for=self, action=Gtk.FileChooserAction.SAVE if save else Gtk.FileChooserAction.OPEN, accept_label="Save" if save else "Open", cancel_label="Cancel")
        file_filter = Gtk.FileFilter()
        file_filter.set_name(pattern)
        file_filter.add_pattern(pattern)
        chooser.add_filter(file_filter)
        if save:
            chooser.set_current_name(name)
        else:
            any_file = Gtk.FileFilter()
            any_file.set_name("All files")
            any_file.add_pattern("*")
            chooser.add_filter(any_file)
        def response(widget, result):
            selected = widget.get_file() if result == Gtk.ResponseType.ACCEPT else None
            widget.destroy()
            if selected and selected.get_path():
                callback(Path(selected.get_path()))
            elif selected:
                self.show_error("Choose a local or mounted folder for this file.")
            else:
                self.set_status("Cancelled")
        chooser.connect("response", response)
        chooser.show()

    def choose_open(self):
        self.choose_file(False, "Open WordWarp Document", "", "*.wordwarp", self.open_file)

    def open_file(self, path):
        try:
            self.restore(read_document(path), path)
        except (OSError, ValueError) as error:
            self.show_error("Could not open document: " + str(error))

    def save(self, after=None, force_dialog=False):
        if not self.ready:
            return
        if self.current_path and not force_dialog:
            self.save_to(self.current_path, after)
        else:
            name = self.state.get("document", {}).get("name", "WordWarp").replace("/", "_")[:80]
            self.choose_file(True, "Save WordWarp Document", name + ".wordwarp", "*.wordwarp", lambda path: self.save_to(path if path.suffix == ".wordwarp" else Path(str(path) + ".wordwarp"), after))

    def save_to(self, path, after=None):
        ident = str(uuid.uuid4())
        def received(doc):
            atomic_write(path, json.dumps(doc, ensure_ascii=False, indent=2, allow_nan=False).encode())
            self.current_path, self.saved_fingerprint = path, fingerprint(doc)
            self.persist()
            self.update_title()
            self.set_status("Saved " + path.name)
            if after:
                after()
        self.pending_documents[ident] = received
        self.dispatch("getDocument", id=ident)
        self.operation_timeout(ident)

    def guard_changes(self, callback, discard=None):
        if not self.dirty:
            callback()
            return
        dialog = Adw.MessageDialog(transient_for=self, heading="Save your document?", body="Save changes before closing or replacing this document.")
        dialog.add_responses("cancel", "Cancel", "discard", "Discard", "save", "Save")
        dialog.set_response_appearance("save", Adw.ResponseAppearance.SUGGESTED)
        dialog.set_response_appearance("discard", Adw.ResponseAppearance.DESTRUCTIVE)
        dialog.set_default_response("save")
        dialog.set_close_response("cancel")
        def response(_dialog, value):
            if value == "discard":
                (discard or callback)()
            elif value == "save":
                self.save(after=lambda: self.guard_changes(callback, discard))
        dialog.connect("response", response)
        dialog.present()

    def close_requested(self, *_):
        if self.allow_close or self.test_path:
            return False
        def close():
            self.persist()
            self.allow_close = True
            self.close()
        self.guard_changes(close, self.discard_and_close)
        return True

    def discard_and_close(self):
        try:
            self.snapshot_path.unlink(missing_ok=True)
        except OSError as error:
            self.show_error("Could not discard recovery data: " + str(error))
            return
        if self.recovery_timer:
            GLib.source_remove(self.recovery_timer)
            self.recovery_timer = 0
        self.allow_close = True
        self.close()

    def export_dialog(self):
        if not self.ready or self.exporting:
            return
        dialog = Adw.Window(transient_for=self, modal=True, title="Export Artwork", default_width=380)
        content = box(True, 12)
        content.append(Adw.HeaderBar())
        body = padded(box(True, 12), 18)
        choices = []
        for label, values in (("Format", ["PNG", "APNG", "GIF"]), ("Scale", ["1×", "2×", "3×", "4×"]), ("Frames per second", ["12", "24", "30"])):
            row = box()
            row.append(Gtk.Label(label=label, xalign=0, hexpand=True))
            choice = Gtk.DropDown.new_from_strings(values)
            row.append(choice)
            body.append(row)
            choices.append(choice)
        def export():
            format_ = ["png", "apng", "gif"][choices[0].get_selected()]
            scale, fps = choices[1].get_selected() + 1, [12, 24, 30][choices[2].get_selected()]
            dialog.close()
            self.choose_file(True, "Export Artwork", "WordWarp." + format_, "*." + format_, lambda path: self.request_export(path if path.suffix.lower() == "." + format_ else Path(str(path) + "." + format_), format_, scale, fps))
        apply = button("Export…", export)
        apply.add_css_class("suggested-action")
        body.append(apply)
        content.append(body)
        dialog.set_content(content)
        dialog.present()

    def request_export(self, path, format_="png", scale=1, fps=12):
        if self.exporting:
            return
        ident = str(uuid.uuid4())
        self.pending_exports[ident] = (path, format_)
        self.exporting = True
        self.export_button.set_sensitive(False)
        self.dispatch("export", id=ident, format=format_, scale=scale, fps=fps)
        self.operation_timeout(ident)

    def write_export(self, event, path, format_):
        try:
            mime = {"png": "image/png", "apng": "image/apng", "gif": "image/gif"}[format_]
            if event["mimeType"] != mime or len(event["base64"]) > MAX_EXPORT * 4 // 3 + 4:
                raise ValueError("Invalid exported image")
            width, height = event["width"], event["height"]
            if not (0 < width <= 16384 and 0 < height <= 16384 and width * height <= 67108864):
                raise ValueError("The exported image exceeds the supported size.")
            data = base64.b64decode(event["base64"], validate=True)
            if len(data) > MAX_EXPORT:
                raise ValueError("The exported image is too large.")
            if format_ == "gif":
                valid = data[:6] in (b"GIF87a", b"GIF89a") and struct.unpack("<HH", data[6:10]) == (width, height)
            else:
                valid = data[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", data[16:24]) == (width, height)
            if not valid:
                raise ValueError("The renderer returned an invalid image.")
            atomic_write(path, data)
            if self.test_path:
                self.test_exports.append((format_, {key: value for key, value in event.items() if key != "base64"}))
            self.set_status(f"Exported {path.name} · {width} × {height}" + (f" · adjusted to {event['fps']:g} fps for the frame budget" if event.get("reduced") else ""))
        finally:
            self.exporting = False
            self.export_button.set_sensitive(True)

    def capture_test_view(self, name):
        paintable = Gtk.WidgetPaintable.new(self)
        snapshot = Gtk.Snapshot.new()
        paintable.snapshot(snapshot, self.get_width(), self.get_height())
        texture = self.get_renderer().render_texture(snapshot.to_node(), None)
        if not texture.save_to_png(str(self.test_path) + "-" + name + ".png"):
            raise AssertionError("Could not save native UI evidence")

    def self_test(self):
        try:
            if self.test_error:
                raise AssertionError(self.test_error)
            if time.monotonic() - self.test_started > 110:
                raise AssertionError(f"Timed out at stage {self.test_stage}: {self.status.get_text()}")
            if not self.ready or not self.state or self.rendered != self.state.get("revision"):
                return True
            stage = self.test_stage
            if stage == 0:
                content = next(f for f in self.fields.values() if f["label"] == "Content")
                widget, _kind = self.field_widgets[content["id"]]
                widget.get_buffer().set_text("UBUNTU STUDIO")
            elif stage == 1:
                if self.state["text"] != "UBUNTU STUDIO":
                    return True
                self.dispatch("setPreset", presetId="gold-bar")
            elif stage == 2:
                if self.state.get("presetId") != "gold-bar":
                    return True
                self.dispatch("addStamp", stampId="heart")
            elif stage == 3:
                if len(self.state["layers"]) != 2:
                    return True
                self.dispatch("undo")
            elif stage == 4:
                if len(self.state["layers"]) != 1:
                    return True
                self.dispatch("redo")
            elif stage == 5:
                if len(self.state["layers"]) != 2:
                    return True
                self.dispatch("select", elementId=self.state["layers"][0]["id"])
            elif stage == 6:
                if self.state["text"] != "UBUNTU STUDIO":
                    return True
                self.category_tabs["effects"].set_active(True)
                self.dispatch("effect", action="add", kind="outerGlow")
            elif stage == 7:
                effect = next((e for e in self.state["document"]["elements"][0]["effects"] if e["kind"] == "outerGlow"), None)
                if not effect:
                    return True
                self.test_effect = effect["id"]
                frame, header, body, disclosure = self.cards[effect["id"]]
                assert not body.get_visible(), "New effect should be collapsed"
                assert header.get_height() > 0, "Header must be laid out"
                assert frame.get_height() <= header.get_height() + header.get_margin_top() + header.get_margin_bottom() + 4, "Collapsed card reserves body space"
                self.capture_test_view("effects-collapsed")
                disclosure.emit("clicked")
                assert body.get_visible()
                header.get_first_child().set_active(False)
            elif stage == 8:
                if next(e for e in self.state["document"]["elements"][0]["effects"] if e["id"] == self.test_effect)["enabled"]:
                    return True
                _frame, header, body, _disclosure = self.cards[self.test_effect]
                assert body.get_visible(), "Enabling must not change disclosure"
                self.capture_test_view("effects-expanded")
                header.get_first_child().set_active(True)
                self.dispatch("animation", action="add", kind="pulse")
            elif stage == 9:
                tracks = self.state["document"]["elements"][0]["animations"]
                if not tracks:
                    return True
                self.category_tabs["animation"].set_active(True)
                duration = next(f for f in self.fields.values() if f["label"] == "Loop duration (seconds)")
                self.set_field(duration["id"], .5)
            elif stage == 10:
                if self.view.get("duration") != .5:
                    return True
                track = self.state["document"]["elements"][0]["animations"][0]
                assert not self.cards[track["id"]][2].get_visible()
                self.capture_test_view("motion-collapsed")
                self.test_snapshot = deepcopy(self.state["document"])
                self.save_to(Path(str(self.test_path) + ".wordwarp"))
            elif stage == 11:
                if self.pending_documents:
                    return True
                assert read_document(Path(str(self.test_path) + ".wordwarp")) == self.test_snapshot
                assert not self.dirty
                self.restore(None)
            elif stage == 12:
                if self.pending_restores:
                    return True
                assert len(self.state["layers"]) == 1
                self.open_file(Path(str(self.test_path) + ".wordwarp"))
            elif stage == 13:
                if self.pending_restores:
                    return True
                assert self.state["document"] == self.test_snapshot
                self.request_export(self.test_path)
            elif stage == 14:
                if self.exporting:
                    return True
                assert self.test_path.stat().st_size > 1000
                self.request_export(Path(str(self.test_path) + ".apng"), "apng", 1, 6)
            elif stage == 15:
                if self.exporting:
                    return True
                assert self.test_exports[-1][1]["frameCount"] > 1
                self.request_export(Path(str(self.test_path) + ".gif"), "gif", 1, 6)
            elif stage == 16:
                if self.exporting:
                    return True
                assert self.test_exports[-1][1]["frameCount"] > 1
                self.dispatch("addText")
            elif stage == 17:
                if len(self.state["layers"]) != 3:
                    return True
                self.test_selected = self.state["selectedElementId"]
                self.category_tabs["object"].set_active(True)
                content = next(f for f in self.fields.values() if f["label"] == "Content")
                self.field_widgets[content["id"]][0].get_buffer().set_text("RECOVER SECOND TEXT")
                assert self.pending_fields and self.dirty
                self.reload_canvas()
            elif stage == 18:
                if self.pending_recovery or self.pending_restores or self.pending_fields or self.state["text"] != "RECOVER SECOND TEXT":
                    return True
                assert self.state["selectedElementId"] == self.test_selected
                assert self.dirty, "Reload must preserve the last saved baseline"
                self.persist()
                assert read_document(self.snapshot_path)["document"] == self.state["document"]
                result = f"WORDWARP_LINUX_SELF_TEST PASS: native text, presets/history, layers, compact effect/motion headers, .wordwarp save/open, pending-edit/selection recovery, PNG/APNG/GIF ({time.monotonic() - self.test_started:.2f}s)"
                print(result, flush=True)
                atomic_write(Path(str(self.test_path) + ".result"), result.encode())
                self.get_application().quit()
                return False
            self.test_stage += 1
        except Exception as error:
            self.test_error = str(error)
            result = f"WORDWARP_LINUX_SELF_TEST FAIL stage {self.test_stage}: {error}"
            print(result, file=sys.stderr, flush=True)
            atomic_write(Path(str(self.test_path) + ".result"), result.encode())
            self.get_application().test_failed = True
            self.get_application().quit()
            return False
        return True


class Application(Adw.Application):
    def __init__(self, args):
        flags = Gio.ApplicationFlags.NON_UNIQUE if args.self_test else Gio.ApplicationFlags.HANDLES_OPEN
        super().__init__(application_id=APP_ID, flags=flags)
        self.args, self.window, self.test_failed = args, None, False

    def do_activate(self):
        if not self.window:
            self.window = Studio(self, self.args.self_test, self.args.document)
        self.window.present()

    def do_open(self, files, _count, _hint):
        path = files[0].get_path() if files else None
        if not self.window:
            self.window = Studio(self, open_path=path)
        elif path:
            if self.window.ready:
                self.window.guard_changes(lambda: self.window.open_file(Path(path)))
            else:
                self.window.open_path = Path(path)
        self.window.present()


def main():
    parser = argparse.ArgumentParser(description="WordWarp native desktop editor")
    parser.add_argument("document", nargs="?")
    parser.add_argument("--self-test", metavar="OUTPUT.png")
    args = parser.parse_args()
    app = Application(args)
    result = app.run([sys.argv[0]] + ([args.document] if args.document and not args.self_test else []))
    return 1 if app.test_failed else result


if __name__ == "__main__":
    sys.exit(main())
