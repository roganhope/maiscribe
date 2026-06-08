from summarize import format_transcript


def test_format_transcript_multiple_speakers():
    data = {
        "duration": 120.0,
        "segments": [
            {"start": 0.0, "end": 5.0, "text": "Hello everyone", "speaker": "Alice"},
            {"start": 5.0, "end": 10.0, "text": "Hi Alice", "speaker": "Bob"},
            {"start": 10.0, "end": 15.0, "text": "Let's get started", "speaker": "Alice"},
        ],
    }
    result = format_transcript(data)
    assert "Alice: Hello everyone" in result
    assert "Bob: Hi Alice" in result
    assert "Alice: Let's get started" in result


def test_format_transcript_solo_speaker():
    data = {
        "duration": 60.0,
        "segments": [
            {"start": 0.0, "end": 10.0, "text": "Note to self", "speaker": "SPEAKER_00"},
            {"start": 10.0, "end": 20.0, "text": "Remember to buy milk", "speaker": "SPEAKER_00"},
        ],
    }
    result = format_transcript(data)
    assert "SPEAKER_00: Note to self Remember to buy milk" in result
    assert result.count("SPEAKER_00:") == 1


def test_format_transcript_collapses_consecutive_same_speaker():
    data = {
        "duration": 30.0,
        "segments": [
            {"start": 0.0, "end": 5.0, "text": "First part", "speaker": "Alice"},
            {"start": 5.0, "end": 10.0, "text": "second part", "speaker": "Alice"},
            {"start": 10.0, "end": 15.0, "text": "My turn", "speaker": "Bob"},
        ],
    }
    result = format_transcript(data)
    # Consecutive segments from same speaker should be merged
    assert "Alice: First part second part" in result
    assert "Bob: My turn" in result
    # Should NOT have two separate "Alice:" lines for consecutive segments
    assert result.count("Alice:") == 1
