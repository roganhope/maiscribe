import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "scripts"))


def test_extract_clips_basic(tmp_path):
    """Clip extraction returns base64-encoded wav data for valid segments."""
    from modal_app import _extract_speaker_clips

    import struct
    sample_rate = 16000
    num_samples = sample_rate * 2  # 2 seconds
    wav_path = tmp_path / "test.wav"
    with open(wav_path, "wb") as f:
        data_size = num_samples * 2  # 16-bit samples
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(b"\x00" * data_size)

    speaker_turns = {"SPEAKER_00": [(0.0, 1.5), (1.5, 2.0)]}
    clips = _extract_speaker_clips(str(wav_path), speaker_turns, max_clips=2, max_duration=10.0)

    assert "SPEAKER_00" in clips
    assert len(clips["SPEAKER_00"]) >= 1
    clip = clips["SPEAKER_00"][0]
    assert "start" in clip
    assert "end" in clip
    assert "wav_base64" in clip
    assert clip["start"] == 0.0
    assert clip["end"] == 1.5


def test_extract_clips_skips_short_segments(tmp_path):
    """Segments shorter than 1 second are skipped."""
    from modal_app import _extract_speaker_clips
    import struct

    sample_rate = 16000
    num_samples = sample_rate * 2
    wav_path = tmp_path / "test.wav"
    with open(wav_path, "wb") as f:
        data_size = num_samples * 2
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(b"\x00" * data_size)

    speaker_turns = {"SPEAKER_00": [(0.0, 0.5), (0.5, 0.9)]}
    clips = _extract_speaker_clips(str(wav_path), speaker_turns, max_clips=3, max_duration=10.0)

    assert clips.get("SPEAKER_00", []) == []


def test_extract_clips_caps_duration(tmp_path):
    """Clips are capped at max_duration seconds."""
    from modal_app import _extract_speaker_clips
    import struct

    sample_rate = 16000
    num_samples = sample_rate * 15  # 15 seconds of audio
    wav_path = tmp_path / "test.wav"
    with open(wav_path, "wb") as f:
        data_size = num_samples * 2
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(b"\x00" * data_size)

    speaker_turns = {"SPEAKER_00": [(0.0, 14.0)]}
    clips = _extract_speaker_clips(str(wav_path), speaker_turns, max_clips=3, max_duration=10.0)

    assert len(clips["SPEAKER_00"]) == 1
    clip = clips["SPEAKER_00"][0]
    assert clip["end"] - clip["start"] <= 10.0
