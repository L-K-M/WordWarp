#!/usr/bin/env python3
"""Exercise the real recovery coordinator without opening a GTK display.

Run with the Ubuntu GTK dependencies installed: python3 native/linux/test_recovery.py
The real packaged-editor self-test separately covers rendering and widget integration.
"""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from wordwarp import ENTRY, Studio, fingerprint


DOCUMENT = {"name": "Two layers", "elements": [
    {"id": "first", "text": "First"}, {"id": "second", "text": "Second"},
]}
FIRST_FIELD = "element:first/text"
SECOND_FIELD = "element:second/text"


def state(selected="first", document=None):
    document = deepcopy(document or DOCUMENT)
    element = next(item for item in document["elements"] if item["id"] == selected)
    return {"document": document, "selectedElementId": selected, "view": {},
            "canUndo": False, "canRedo": False, "layers": document["elements"],
            "inspector": [{"fields": [{"id": f"element:{selected}/text", "value": element["text"]}]}]}


class Host:
    """Native view stand-ins; recovery, message handling and storage are production code."""
    dirty = Studio.dirty
    receive = Studio.receive
    apply_state = Studio.apply_state
    resume_recovery = Studio.resume_recovery
    reload_canvas = Studio.reload_canvas
    set_field = Studio.set_field
    persist = Studio.persist
    restore = Studio.restore
    discard_and_close = Studio.discard_and_close
    close_requested = Studio.close_requested

    def __init__(self, directory):
        self.state, self.view, self.fields = {}, {}, {}
        self.ready, self.updating = False, False
        self.recovery, self.pending_recovery = None, None
        self.pending_fields, self.pending_restores = {}, {}
        self.pending_documents, self.pending_exports = {}, {}
        self.saved_fingerprint, self.current_path = None, None
        self.recovery_timer, self.open_path = 0, None
        self.snapshot_path = directory / "recovery.json"
        self.allow_close, self.test_path = False, None
        self.exporting = False
        self.commands = []
        self.web = Mock()
        self.web.get_uri.return_value = ENTRY
        self.undo, self.redo = Mock(), Mock()
        for name in ("update_layers", "update_inspector", "sync_fields", "sync_view",
                     "update_title", "show_styles", "set_status", "show_error",
                     "operation_timeout", "close", "guard_changes"):
            setattr(self, name, Mock())

    def dispatch(self, command_type, **properties):
        self.commands.append({"type": command_type, **properties})

    def event(self, kind, **properties):
        message = Mock()
        message.to_json.return_value = json.dumps({"type": kind, **properties})
        self.receive(None, message)
        if self.show_error.called:
            raise AssertionError(self.show_error.call_args)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.host = Host(Path(self.directory.name))
        self.timeout = patch("wordwarp.GLib.timeout_add", return_value=1)
        self.timeout.start()
        self.addCleanup(self.timeout.stop)

    def start_recovery(self):
        saved = Path(self.directory.name) / "saved.wordwarp"
        saved.write_text(json.dumps(DOCUMENT))
        recovery = {"document": deepcopy(DOCUMENT), "baseline": fingerprint(DOCUMENT),
                    "path": str(saved), "selectedElementId": "second",
                    "drafts": {SECOND_FIELD: "Latest native draft", FIRST_FIELD: "Wrong layer", "unknown": 123}}
        self.host.recovery = deepcopy(recovery)
        self.host.snapshot_path.write_text(json.dumps(recovery))
        original = self.host.snapshot_path.read_bytes()
        self.host.event("ready", version=2, state=state())
        restore_id = self.host.commands[-1]["id"]
        self.host.event("state", state=state())
        self.host.event("restored", id=restore_id)
        return original

    def test_drafts_wait_for_selection_ack_and_preserve_baseline(self):
        original = self.start_recovery()
        self.assertEqual([command["type"] for command in self.host.commands], ["restore", "select"])
        self.assertEqual(self.host.commands[-1]["elementId"], "second")
        self.host.persist()
        self.assertEqual(self.host.snapshot_path.read_bytes(), original)
        self.host.event("state", state=state())  # an older acknowledgement
        self.assertEqual(len(self.host.commands), 2)
        self.assertTrue(self.host.dirty)

        self.host.event("state", state=state("second"))
        self.assertEqual(self.host.commands[-1], {"type": "setField", "fieldId": SECOND_FIELD,
                                                   "value": "Latest native draft"})
        self.assertEqual(len(self.host.commands), 3)  # wrong-layer and unknown IDs were ignored
        self.assertIsNone(self.host.pending_recovery)
        stored = json.loads(self.host.snapshot_path.read_text())
        self.assertEqual(stored["selectedElementId"], "second")
        self.assertEqual(stored["drafts"], {SECOND_FIELD: "Latest native draft"})
        self.assertEqual(stored["baseline"], fingerprint(DOCUMENT))

        edited = deepcopy(DOCUMENT)
        edited["elements"][1]["text"] = "Latest native draft"
        self.host.event("state", state=state("second", edited))
        self.assertEqual(self.host.pending_fields, {})
        self.assertTrue(self.host.dirty)  # recovery did not turn unsaved changes into a save

    def test_reload_during_selection_wait_preserves_original_drafts(self):
        self.start_recovery()
        self.host.reload_canvas()
        self.assertIsNone(self.host.pending_recovery)
        self.assertEqual(self.host.recovery["selectedElementId"], "second")
        self.assertEqual(self.host.recovery["drafts"][SECOND_FIELD], "Latest native draft")
        self.assertNotIn("_selecting", self.host.recovery)
        self.assertNotIn("_restoring", self.host.recovery)
        self.host.web.load_uri.assert_called_once_with(ENTRY)

    def test_reload_keeps_latest_pending_field_and_selection(self):
        self.host.event("ready", version=2, state=state("second"))
        self.host.set_field(SECOND_FIELD, "Earlier")
        self.host.set_field(SECOND_FIELD, "Latest")
        self.assertTrue(self.host.dirty)
        self.host.reload_canvas()
        self.assertEqual(self.host.recovery["drafts"], {SECOND_FIELD: "Latest"})
        self.assertEqual(self.host.recovery["selectedElementId"], "second")
        self.assertEqual(self.host.recovery["baseline"], fingerprint(DOCUMENT))
        stored = self.host.snapshot_path.read_bytes()
        self.assertEqual(json.loads(stored)["drafts"], {SECOND_FIELD: "Latest"})
        self.assertTrue(self.host.dirty)  # clean acknowledged state is not the pending draft
        self.host.persist()
        self.assertEqual(self.host.snapshot_path.read_bytes(), stored)
        self.host.reload_canvas()  # another reload before ready must not drop the draft
        self.assertEqual(self.host.recovery["drafts"], {SECOND_FIELD: "Latest"})

    def test_unacknowledged_recovery_document_stays_dirty(self):
        self.host.event("ready", version=2, state=state())
        changed = deepcopy(DOCUMENT)
        changed["name"] = "Unsaved document name"
        self.host.pending_recovery = {"document": changed, "baseline": fingerprint(DOCUMENT),
                                      "drafts": {}, "_restoring": True}
        self.assertTrue(self.host.dirty)
        self.host.pending_recovery["document"] = deepcopy(DOCUMENT)
        self.assertFalse(self.host.dirty)

    def test_ready_status_and_legacy_recovery_without_selection(self):
        self.host.event("ready", version=2, state=state())
        self.host.set_status.assert_called_with("Ready")
        self.host.pending_recovery = {"document": DOCUMENT, "drafts": {FIRST_FIELD: "Legacy draft"}}
        self.host.resume_recovery()
        self.assertEqual(self.host.commands[-1]["fieldId"], FIRST_FIELD)

    def test_explicit_document_replacement_cancels_unprocessed_recovery(self):
        self.start_recovery()
        self.host.restore(None)
        self.assertIsNone(self.host.pending_recovery)
        self.assertIsNone(self.host.recovery)
        self.assertEqual(self.host.commands[-1]["type"], "newDocument")
        self.host.event("state", state=state())
        self.assertFalse(any(command["type"] == "setField" for command in self.host.commands))
        self.assertEqual(self.host.pending_fields, {})

    def test_discard_close_removes_only_recovery_and_cancels_timer(self):
        self.start_recovery()
        saved = self.host.current_path
        saved_contents = saved.read_bytes()
        self.host.recovery_timer = 1
        self.assertTrue(self.host.close_requested())
        callback, discard = self.host.guard_changes.call_args.args
        self.assertNotEqual(callback, discard)
        with patch("wordwarp.GLib.source_remove") as remove:
            discard()
        remove.assert_called_once_with(1)
        self.assertFalse(self.host.snapshot_path.exists())
        self.assertEqual(saved.read_bytes(), saved_contents)
        self.assertTrue(self.host.allow_close)
        self.host.close.assert_called_once()
        self.host.pending_recovery = None
        self.host.persist()  # a late callback cannot resurrect discarded data
        self.assertFalse(self.host.snapshot_path.exists())


if __name__ == "__main__":
    unittest.main()
