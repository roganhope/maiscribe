"""Tests for src/scripts/setup_modal.py — the --json progress contract.

The desktop app parses these lines to drive its setup progress bar, so the event
shape here is a contract with `provision.ts`, not just console output.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "scripts"))

import setup_modal
from _common import FAIL, PASS, Outcome


def _capture(capsys):
    """Parse stdout into the JSON events the app would see."""
    out = capsys.readouterr().out
    return [json.loads(line) for line in out.splitlines() if line.startswith("{")]


def _reset(total=6):
    setup_modal._progress["index"] = 0
    setup_modal._progress["total"] = total


# --- emit ------------------------------------------------------------------

def test_emit_is_silent_without_the_flag(capsys):
    setup_modal.JSON_OUTPUT = False
    setup_modal.emit("step", message="hello")
    assert capsys.readouterr().out == ""


def test_emit_writes_one_json_object_per_line(capsys):
    setup_modal.JSON_OUTPUT = True
    try:
        setup_modal.emit("done", message="ok")
    finally:
        setup_modal.JSON_OUTPUT = False
    assert _capture(capsys) == [{"event": "done", "message": "ok"}]


# --- step numbering --------------------------------------------------------

def test_emit_step_counts_up_and_carries_the_total(capsys):
    setup_modal.JSON_OUTPUT = True
    _reset(total=6)
    try:
        setup_modal.emit_step("Checking credentials")
        setup_modal.emit_step("Syncing Hugging Face secret")
    finally:
        setup_modal.JSON_OUTPUT = False
    assert _capture(capsys) == [
        {"event": "step", "message": "Checking credentials", "index": 1, "total": 6},
        {"event": "step", "message": "Syncing Hugging Face secret", "index": 2, "total": 6},
    ]


def test_the_six_labels_are_distinct_and_ordered():
    """Three local steps then three models — the order the bar walks through."""
    labels = list(setup_modal.STEP_LABELS.values()) + list(setup_modal.MODEL_LABELS.values())
    assert labels == [
        "Checking credentials",
        "Syncing Hugging Face secret",
        "Building GPU image",
        "Downloading Whisper model",
        "Downloading diarization model",
        "Downloading embedding model",
    ]
    assert len(set(labels)) == len(labels)


def test_every_run_steps_name_has_a_label():
    """A missing label would surface the raw step name in the UI."""
    for name in ("credentials", "secret", "image and models"):
        assert name in setup_modal.STEP_LABELS


# --- the prefetch summary contract -----------------------------------------

def _fake_gen(records):
    def gen():
        yield from records
    return gen


def test_step_prefetch_emits_a_step_per_model_and_keeps_the_summary(capsys, monkeypatch):
    """The generator drives both the progress events and the final Outcome."""
    records = [
        {"kind": "started", "name": "whisper"},
        {"kind": "result", "name": "whisper", "ok": True, "error": None, "seconds": 1.0},
        {"kind": "started", "name": "diarization"},
        {"kind": "result", "name": "diarization", "ok": True, "error": None, "seconds": 2.0},
        {"kind": "started", "name": "embedding"},
        {"kind": "result", "name": "embedding", "ok": True, "error": None, "seconds": 3.0},
        {
            "kind": "summary",
            "ok": True,
            "steps": [
                {"name": "whisper", "ok": True, "error": None, "seconds": 1.0},
                {"name": "diarization", "ok": True, "error": None, "seconds": 2.0},
                {"name": "embedding", "ok": True, "error": None, "seconds": 3.0},
            ],
            "volume": {"megabytes_before": 0, "megabytes_after": 3000, "committed": True},
        },
    ]

    outcome = _run_prefetch(monkeypatch, records)
    events = _capture(capsys)

    assert [e["message"] for e in events] == [
        "Downloading Whisper model",
        "Downloading diarization model",
        "Downloading embedding model",
    ]
    assert [e["index"] for e in events] == [4, 5, 6]
    assert outcome.status == PASS
    # The notes still carry the per-model timings the CLI has always printed.
    assert any("whisper" in note for note in outcome.notes)
    assert any("3000" in note for note in outcome.notes)


def test_step_prefetch_fails_when_no_summary_arrives(monkeypatch):
    """A container killed mid-download yields records but never a summary."""
    records = [
        {"kind": "started", "name": "whisper"},
        {"kind": "result", "name": "whisper", "ok": True, "error": None, "seconds": 1.0},
    ]
    outcome = _run_prefetch(monkeypatch, records)
    assert outcome.status == FAIL
    assert "summary" in outcome.message


def test_step_prefetch_fails_when_a_model_fails(monkeypatch):
    records = [
        {"kind": "started", "name": "whisper"},
        {"kind": "result", "name": "whisper", "ok": False, "error": "gated", "seconds": 1.0},
        {
            "kind": "summary",
            "ok": False,
            "steps": [{"name": "whisper", "ok": False, "error": "gated", "seconds": 1.0}],
            "volume": {"megabytes_before": 0, "megabytes_after": 0, "committed": False},
        },
    ]
    outcome = _run_prefetch(monkeypatch, records)
    assert outcome.status == FAIL
    assert any("gated" in note for note in outcome.notes)


def test_step_prefetch_skipped_emits_nothing(capsys, monkeypatch):
    setup_modal.JSON_OUTPUT = True
    _reset(total=3)
    try:
        outcome = setup_modal.step_prefetch({"skip_prefetch": True})
    finally:
        setup_modal.JSON_OUTPUT = False
    assert outcome.status == "SKIP"
    assert _capture(capsys) == []


def _run_prefetch(monkeypatch, records):
    """Drive step_prefetch with a stubbed Modal app and generator."""
    import types

    class _FakeRun:
        def __enter__(self): return self
        def __exit__(self, *a): return False

    fake_app = types.SimpleNamespace(run=lambda: _FakeRun())
    fake_prefetch = types.SimpleNamespace(remote_gen=_fake_gen(records))
    fake_modal_app = types.SimpleNamespace(app=fake_app, prefetch_models=fake_prefetch)
    fake_modal = types.SimpleNamespace(enable_output=lambda: _FakeRun())

    monkeypatch.setitem(sys.modules, "modal_app", fake_modal_app)
    monkeypatch.setitem(sys.modules, "modal", fake_modal)
    monkeypatch.setattr(setup_modal, "export_modal_credentials", lambda creds: None)
    monkeypatch.setattr(setup_modal, "import_pipeline", lambda: None)

    setup_modal.JSON_OUTPUT = True
    _reset(total=6)
    setup_modal._progress["index"] = 3  # the three local steps already ran
    try:
        return setup_modal.step_prefetch({"skip_prefetch": False, "creds": {}})
    finally:
        setup_modal.JSON_OUTPUT = False


# --- main() end to end -----------------------------------------------------

def test_main_json_emits_an_error_event_when_credentials_are_missing(capsys, monkeypatch):
    """The exit-2 path still has to speak JSON, or the bar hangs on 'Starting'."""
    monkeypatch.setattr(sys, "argv", ["setup_modal.py", "--json"])
    monkeypatch.setattr(setup_modal, "maybe_reexec", lambda *a, **k: None)
    monkeypatch.setattr(setup_modal, "load_credentials", lambda: {})

    code = setup_modal.main()
    events = _capture(capsys)

    assert code == 2
    assert events[0]["event"] == "step"
    assert events[0]["message"] == "Checking credentials"
    assert events[0]["total"] == 6
    assert events[-1]["event"] == "error"
    assert "credentials" in events[-1]["message"]
    assert events[-1]["code"] == 2


def test_main_json_prints_no_human_output(capsys, monkeypatch):
    """Non-JSON lines would reach the app's parser as junk progress text."""
    monkeypatch.setattr(sys, "argv", ["setup_modal.py", "--json"])
    monkeypatch.setattr(setup_modal, "maybe_reexec", lambda *a, **k: None)
    monkeypatch.setattr(setup_modal, "load_credentials", lambda: {})

    setup_modal.main()
    out = capsys.readouterr().out
    for line in out.splitlines():
        if line.strip():
            assert line.startswith("{"), f"non-JSON line leaked: {line!r}"


def test_main_without_json_keeps_the_human_output(capsys, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["setup_modal.py"])
    monkeypatch.setattr(setup_modal, "maybe_reexec", lambda *a, **k: None)
    monkeypatch.setattr(setup_modal, "load_credentials", lambda: {})

    setup_modal.main()
    out = capsys.readouterr().out
    assert "Modal workspace setup" in out
    assert "{" not in out


def test_skip_prefetch_totals_three_steps(capsys, monkeypatch):
    """The bar must not promise six steps it will never reach."""
    monkeypatch.setattr(sys, "argv", ["setup_modal.py", "--json", "--skip-prefetch"])
    monkeypatch.setattr(setup_modal, "maybe_reexec", lambda *a, **k: None)
    monkeypatch.setattr(setup_modal, "load_credentials", lambda: {})

    setup_modal.main()
    events = _capture(capsys)
    assert events[0]["total"] == 3
