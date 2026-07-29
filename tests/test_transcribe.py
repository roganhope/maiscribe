import json
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "scripts"))

import transcribe
from transcribe import validate_files, write_error_log


# --- write_error_log ---

def test_write_error_log_writes_to_outbox(tmp_path, monkeypatch):
    """Errors must land in the user-facing outbox, not the app-bundle source dir."""
    outbox = tmp_path / "outbox"
    monkeypatch.setattr(transcribe, "OUTBOX_DIR", outbox)

    write_error_log(Path("meeting.m4a"), "boom", "Traceback:\n  line 1")

    errors_file = outbox / "errors.txt"
    assert errors_file.exists()
    content = errors_file.read_text(encoding="utf-8")
    assert "meeting.m4a" in content
    assert "boom" in content
    assert "line 1" in content


def test_write_error_log_creates_outbox_if_missing(tmp_path, monkeypatch):
    outbox = tmp_path / "does" / "not" / "exist"
    monkeypatch.setattr(transcribe, "OUTBOX_DIR", outbox)

    write_error_log(Path("a.mp3"), "network down")

    assert (outbox / "errors.txt").exists()


# --- emit ---

def test_emit_step_human_readable_by_default(capsys):
    transcribe.emit("step", message="Transcribing on remote GPU")
    assert capsys.readouterr().out == "[step] Transcribing on remote GPU\n"


def test_emit_done_human_readable(capsys):
    transcribe.emit(
        "done", file="a.m4a", output="/out/a_123",
        unknown_speakers=["SPEAKER_00"],
    )
    out = capsys.readouterr().out
    assert out == "[done] a.m4a → /out/a_123 (unknown speakers: SPEAKER_00)\n"


def test_emit_error_human_readable(capsys):
    transcribe.emit("error", file="a.m4a", message="boom")
    assert capsys.readouterr().out == "[error] a.m4a: boom\n"
    transcribe.emit("error", message="global failure")
    assert capsys.readouterr().out == "[error] global failure\n"


def test_emit_json_mode_round_trips_awkward_paths(capsys, monkeypatch):
    """Paths containing ' (' or '→' must survive — the old regex protocol broke on them."""
    monkeypatch.setattr(transcribe, "JSON_OUTPUT", True)
    transcribe.emit(
        "done", file="take (2).m4a", output="/out/take (2)_20260610",
        unknown_speakers=[],
    )
    obj = json.loads(capsys.readouterr().out)
    assert obj == {
        "event": "done",
        "file": "take (2).m4a",
        "output": "/out/take (2)_20260610",
        "unknown_speakers": [],
    }


def test_emit_json_mode_step_and_error(capsys, monkeypatch):
    monkeypatch.setattr(transcribe, "JSON_OUTPUT", True)
    transcribe.emit("step", message="Summarizing")
    assert json.loads(capsys.readouterr().out) == {"event": "step", "message": "Summarizing"}
    transcribe.emit("error", file="a.m4a", message="boom")
    assert json.loads(capsys.readouterr().out) == {"event": "error", "file": "a.m4a", "message": "boom"}


# --- validate_files ---

def test_validate_files_valid_file(tmp_path):
    f = tmp_path / "audio.mp3"
    f.write_bytes(b"fake audio")
    valid, errors = validate_files([f])
    assert valid == [f]
    assert errors == []


def test_validate_files_missing_file(tmp_path):
    f = tmp_path / "missing.mp3"
    valid, errors = validate_files([f])
    assert valid == []
    assert errors == ["missing.mp3: file not found"]


def test_validate_files_mixed(tmp_path):
    good = tmp_path / "good.mp3"
    good.write_bytes(b"fake audio")
    bad = tmp_path / "bad.mp3"
    valid, errors = validate_files([good, bad])
    assert valid == [good]
    assert errors == ["bad.mp3: file not found"]


def test_validate_files_all_invalid(tmp_path):
    f1 = tmp_path / "a.mp3"
    f2 = tmp_path / "b.mp3"
    valid, errors = validate_files([f1, f2])
    assert valid == []
    assert errors == ["a.mp3: file not found", "b.mp3: file not found"]


# --- audio handling ---------------------------------------------------------
# What happens to the user's file after transcription. Getting these wrong
# destroys a recording, so each branch is pinned.

from transcribe import handle_audio_file as _handle_audio


def _setup(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    out = tmp_path / "out"
    out.mkdir()
    audio = source / "meeting.m4a"
    audio.write_bytes(b"audio")
    return audio, out


def test_store_copies_and_keeps_the_original(tmp_path):
    audio, out = _setup(tmp_path)
    _handle_audio('store', audio, out)
    assert audio.exists()
    assert (out / "meeting.m4a").exists()


def test_store_and_delete_moves_the_original(tmp_path):
    audio, out = _setup(tmp_path)
    _handle_audio('store-and-delete', audio, out)
    assert not audio.exists()
    assert (out / "meeting.m4a").exists()


def test_delete_removes_the_original_and_keeps_no_copy(tmp_path):
    audio, out = _setup(tmp_path)
    _handle_audio('delete', audio, out)
    assert not audio.exists()
    assert not (out / "meeting.m4a").exists()


def test_leave_touches_nothing(tmp_path):
    audio, out = _setup(tmp_path)
    _handle_audio('leave', audio, out)
    assert audio.exists(), "the source file must survive"
    assert not (out / "meeting.m4a").exists(), "no copy should be made"


def test_an_unknown_value_does_not_delete(tmp_path):
    """The old `else: unlink()` meant any typo upstream destroyed the file."""
    audio, out = _setup(tmp_path)
    _handle_audio('typo', audio, out)
    assert audio.exists()


def test_leave_is_the_argparse_default():
    """A bare CLI run must not delete the file it was pointed at."""
    src = (Path(__file__).parent.parent / "src" / "scripts" / "transcribe.py").read_text()
    block = src.split('"--audio-handling"')[1].split("help=")[0]
    assert 'default="leave"' in block
    assert '"leave"' in block
