from pathlib import Path
import pytest
from transcribe import resolve_output_path, validate_files


# --- resolve_output_path ---

def test_output_path_default_replaces_extension(tmp_path):
    f = tmp_path / "interview.mp3"
    assert resolve_output_path(f, None) == tmp_path / "interview.json"


def test_output_path_preserves_spaces_and_parens(tmp_path):
    f = tmp_path / "my audio (1).mp3"
    assert resolve_output_path(f, None) == tmp_path / "my audio (1).json"


def test_output_path_with_output_dir(tmp_path):
    f = tmp_path / "audio.wav"
    out_dir = tmp_path / "results"
    assert resolve_output_path(f, out_dir) == out_dir / "audio.json"


def test_output_path_with_output_dir_preserves_stem(tmp_path):
    f = tmp_path / "my audio (1).flac"
    out_dir = tmp_path / "results"
    assert resolve_output_path(f, out_dir) == out_dir / "my audio (1).json"


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
    assert len(errors) == 1
    assert "[error]" in errors[0]
    assert "missing.mp3" in errors[0]


def test_validate_files_mixed(tmp_path):
    good = tmp_path / "good.mp3"
    good.write_bytes(b"fake audio")
    bad = tmp_path / "bad.mp3"
    valid, errors = validate_files([good, bad])
    assert valid == [good]
    assert len(errors) == 1


def test_validate_files_all_invalid(tmp_path):
    f1 = tmp_path / "a.mp3"
    f2 = tmp_path / "b.mp3"
    valid, errors = validate_files([f1, f2])
    assert valid == []
    assert len(errors) == 2
