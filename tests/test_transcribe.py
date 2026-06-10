import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "pipeline"))

from transcribe import validate_files


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
    assert "[error]" in errors[0]
    assert "bad.mp3" in errors[0]


def test_validate_files_all_invalid(tmp_path):
    f1 = tmp_path / "a.mp3"
    f2 = tmp_path / "b.mp3"
    valid, errors = validate_files([f1, f2])
    assert valid == []
    assert len(errors) == 2
    assert "[error]" in errors[0]
    assert "a.mp3" in errors[0]
    assert "[error]" in errors[1]
    assert "b.mp3" in errors[1]
