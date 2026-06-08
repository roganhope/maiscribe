from summarize import format_transcript, render_markdown


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


def test_render_markdown_meeting():
    summary = {
        "recording_type": "meeting",
        "participants": ["Alice", "Bob"],
        "duration_minutes": 15,
        "sections": [
            {"type": "tldr", "title": "TL;DR", "content": "Alice and Bob discussed the project."},
            {
                "type": "key_topics",
                "title": "Key Topics",
                "items": [{"topic": "Project timeline", "detail": "Agreed on 2-week sprint"}],
            },
            {"type": "decisions", "title": "Decisions", "items": ["Use weekly standups"]},
            {
                "type": "action_items",
                "title": "Action Items",
                "items": [{"owner": "Bob", "action": "Set up repo", "deadline": "Friday"}],
            },
            {"type": "open_questions", "title": "Open Questions", "items": ["Which CI tool?"]},
            {
                "type": "participants",
                "title": "Participants",
                "items": [{"name": "Alice", "context": "Project lead"}],
            },
        ],
    }
    md = render_markdown(summary, "Test Recording")
    assert "# Summary: Test Recording" in md
    assert "**Type:** Meeting" in md
    assert "**Duration:** 15 min" in md
    assert "**Participants:** Alice, Bob" in md
    assert "## TL;DR" in md
    assert "Alice and Bob discussed the project." in md
    assert "## Key Topics" in md
    assert "**Project timeline**" in md
    assert "## Decisions" in md
    assert "- Use weekly standups" in md
    assert "## Action Items" in md
    assert "- [ ] **Bob:** Set up repo (by Friday)" in md
    assert "## Open Questions" in md
    assert "- Which CI tool?" in md
    assert "## Participants" in md
    assert "**Alice**" in md


def test_render_markdown_solo():
    summary = {
        "recording_type": "solo",
        "participants": ["SPEAKER_00"],
        "duration_minutes": 5,
        "sections": [
            {"type": "tldr", "title": "TL;DR", "content": "Voice memo about groceries."},
            {
                "type": "key_topics",
                "title": "Key Topics",
                "items": [{"topic": "Shopping list", "detail": "Need milk and eggs"}],
            },
        ],
    }
    md = render_markdown(summary, "Voice Memo")
    assert "# Summary: Voice Memo" in md
    assert "**Type:** Solo" in md
    assert "## TL;DR" in md
    assert "## Key Topics" in md
    # No action items or participants section
    assert "## Action Items" not in md
    assert "## Participants" not in md
