# Summarization Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude-powered summarization step that produces structured JSON + markdown summaries of transcription output, running automatically after transcription or on-demand.

**Architecture:** New `summarize.py` module with four functions: `format_transcript` (builds speaker-labeled text), `call_claude` (Anthropic SDK call), `render_markdown` (JSON→markdown), and `summarize_file` (orchestrates the above and writes files). Integrated into `transcribe.py` via CLI flags.

**Tech Stack:** Python 3.12, `anthropic` SDK, Claude Sonnet 4 (`claude-sonnet-4-6`), pytest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `summarize.py` (create) | All summarization logic: formatting, API call, markdown rendering, file writing |
| `transcribe.py` (modify) | Add `--summarize` and `--no-summary` flags, call `summarize_file` after transcription |
| `requirements.txt` (modify) | Add `anthropic` dependency |
| `tests/test_summarize.py` (create) | Unit tests for format_transcript, render_markdown, summarize_file |

---

### Task 1: Add `anthropic` dependency

**Files:**
- Modify: `requirements.txt`

- [ ] **Step 1: Add anthropic to requirements.txt**

Add `anthropic` to the end of `requirements.txt`:

```
modal
faster-whisper
pyannote.audio
pytest
anthropic
```

- [ ] **Step 2: Install the dependency**

Run: `pip install anthropic`
Expected: Installs successfully

- [ ] **Step 3: Commit**

```bash
git add requirements.txt
git commit -m "chore: add anthropic SDK dependency"
```

---

### Task 2: Implement `format_transcript`

**Files:**
- Create: `tests/test_summarize.py`
- Create: `summarize.py`

- [ ] **Step 1: Write the failing test for format_transcript with multiple speakers**

```python
# tests/test_summarize.py
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
    assert "SPEAKER_00: Note to self" in result
    assert "SPEAKER_00: Remember to buy milk" in result


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_summarize.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'summarize'`

- [ ] **Step 3: Implement format_transcript**

```python
# summarize.py


def format_transcript(data: dict) -> str:
    segments = data.get("segments", [])
    if not segments:
        return ""

    # Collapse consecutive segments from the same speaker
    collapsed = []
    for seg in segments:
        speaker = seg.get("speaker", "UNKNOWN")
        text = seg.get("text", "").strip()
        if not text:
            continue
        if collapsed and collapsed[-1][0] == speaker:
            collapsed[-1] = (speaker, collapsed[-1][1] + " " + text)
        else:
            collapsed.append((speaker, text))

    lines = [f"{speaker}: {text}" for speaker, text in collapsed]
    return "\n".join(lines)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_summarize.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add summarize.py tests/test_summarize.py
git commit -m "feat(summarize): add format_transcript with speaker collapsing"
```

---

### Task 3: Implement `render_markdown`

**Files:**
- Modify: `tests/test_summarize.py`
- Modify: `summarize.py`

- [ ] **Step 1: Write the failing test for render_markdown**

Append to `tests/test_summarize.py`:

```python
from summarize import render_markdown


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_summarize.py::test_render_markdown_meeting -v`
Expected: FAIL with `ImportError: cannot import name 'render_markdown'`

- [ ] **Step 3: Implement render_markdown**

Add to `summarize.py`:

```python
def render_markdown(summary: dict, recording_name: str) -> str:
    rec_type = summary.get("recording_type", "unknown").capitalize()
    duration = summary.get("duration_minutes", 0)
    participants = summary.get("participants", [])

    lines = [f"# Summary: {recording_name}"]
    lines.append("")

    meta_parts = [f"**Type:** {rec_type}", f"**Duration:** {duration} min"]
    if participants:
        meta_parts.append(f"**Participants:** {', '.join(participants)}")
    lines.append(" | ".join(meta_parts))
    lines.append("")

    for section in summary.get("sections", []):
        section_type = section["type"]
        title = section["title"]
        lines.append(f"## {title}")
        lines.append("")

        if section_type == "tldr":
            lines.append(section["content"])
            lines.append("")

        elif section_type == "key_topics":
            for item in section.get("items", []):
                lines.append(f"- **{item['topic']}** — {item['detail']}")
            lines.append("")

        elif section_type == "decisions":
            for item in section.get("items", []):
                lines.append(f"- {item}")
            lines.append("")

        elif section_type == "action_items":
            for item in section.get("items", []):
                deadline = f" (by {item['deadline']})" if item.get("deadline") else ""
                lines.append(f"- [ ] **{item['owner']}:** {item['action']}{deadline}")
            lines.append("")

        elif section_type == "open_questions":
            for item in section.get("items", []):
                lines.append(f"- {item}")
            lines.append("")

        elif section_type == "participants":
            for item in section.get("items", []):
                lines.append(f"- **{item['name']}** — {item['context']}")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_summarize.py -v`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add summarize.py tests/test_summarize.py
git commit -m "feat(summarize): add render_markdown for JSON-to-markdown conversion"
```

---

### Task 4: Implement `call_claude`

**Files:**
- Modify: `tests/test_summarize.py`
- Modify: `summarize.py`

- [ ] **Step 1: Write the failing test for call_claude (mocked API)**

Append to `tests/test_summarize.py`:

```python
import json
from unittest.mock import patch, MagicMock
from summarize import call_claude


def test_call_claude_returns_parsed_json():
    mock_response = {
        "recording_type": "meeting",
        "participants": ["Alice", "Bob"],
        "duration_minutes": 10,
        "sections": [
            {"type": "tldr", "title": "TL;DR", "content": "A short meeting."}
        ],
    }
    mock_message = MagicMock()
    mock_message.content = [MagicMock(text=json.dumps(mock_response))]

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_message

    with patch("summarize.anthropic.Anthropic", return_value=mock_client):
        result = call_claude("Alice: Hello\nBob: Hi", 120.0)

    assert result["recording_type"] == "meeting"
    assert result["participants"] == ["Alice", "Bob"]
    assert len(result["sections"]) == 1


def test_call_claude_returns_none_on_missing_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = call_claude("Alice: Hello", 60.0)
    assert result is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_summarize.py::test_call_claude_returns_parsed_json -v`
Expected: FAIL with `ImportError: cannot import name 'call_claude'`

- [ ] **Step 3: Implement call_claude**

Add to `summarize.py`:

```python
import json
import os

import anthropic

SUMMARY_MODEL = "claude-sonnet-4-6"

SYSTEM_PROMPT = """You are a meeting/recording summarizer. You will receive a speaker-labeled transcript.

Analyze the transcript and return a JSON object with this structure:
{
  "recording_type": "meeting" or "solo",
  "participants": ["list of speaker names/labels"],
  "duration_minutes": <integer>,
  "sections": [...]
}

Rules for sections:
- Include ONLY sections that are relevant to the content
- For solo recordings (single speaker), omit "participants" and "action_items" sections
- Each section has a "type", "title", and either "content" (string) or "items" (array)

Available section types:
1. {"type": "tldr", "title": "TL;DR", "content": "One paragraph executive summary."}
2. {"type": "key_topics", "title": "Key Topics", "items": [{"topic": "...", "detail": "..."}]}
3. {"type": "decisions", "title": "Decisions", "items": ["decision string", ...]}
4. {"type": "action_items", "title": "Action Items", "items": [{"owner": "...", "action": "...", "deadline": "..." or null}]}
5. {"type": "open_questions", "title": "Open Questions", "items": ["question string", ...]}
6. {"type": "participants", "title": "Participants", "items": [{"name": "...", "context": "role or what they discussed"}]}

Return ONLY valid JSON. No markdown fences, no explanation."""


def call_claude(transcript_text: str, duration: float) -> dict | None:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[warn] ANTHROPIC_API_KEY not set — skipping summary")
        return None

    client = anthropic.Anthropic(api_key=api_key)
    duration_minutes = int(duration / 60)

    # Truncate if transcript is too long (~180k tokens ≈ ~720k chars)
    max_chars = 720_000
    if len(transcript_text) > max_chars:
        keep = max_chars // 2
        transcript_text = (
            transcript_text[:keep]
            + "\n\n[... middle truncated for length ...]\n\n"
            + transcript_text[-keep:]
        )

    user_message = f"Transcript ({duration_minutes} minutes):\n\n{transcript_text}"

    try:
        message = client.messages.create(
            model=SUMMARY_MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
        response_text = message.content[0].text
        return json.loads(response_text)
    except (anthropic.APIError, json.JSONDecodeError) as e:
        print(f"[warn] summarization failed: {e}")
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_summarize.py -v`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add summarize.py tests/test_summarize.py
git commit -m "feat(summarize): add call_claude with Anthropic SDK integration"
```

---

### Task 5: Implement `summarize_file`

**Files:**
- Modify: `tests/test_summarize.py`
- Modify: `summarize.py`

- [ ] **Step 1: Write the failing test for summarize_file**

Append to `tests/test_summarize.py`:

```python
from pathlib import Path
from summarize import summarize_file


def test_summarize_file_writes_both_outputs(tmp_path, monkeypatch):
    # Set up a fake transcript JSON
    transcript = {
        "text": "Hello everyone. Let's discuss the project.",
        "duration": 300.0,
        "segments": [
            {"start": 0.0, "end": 5.0, "text": "Hello everyone", "speaker": "Alice"},
            {"start": 5.0, "end": 10.0, "text": "Let's discuss the project", "speaker": "Bob"},
        ],
    }
    json_path = tmp_path / "recording.json"
    json_path.write_text(json.dumps(transcript), encoding="utf-8")

    mock_summary = {
        "recording_type": "meeting",
        "participants": ["Alice", "Bob"],
        "duration_minutes": 5,
        "summary_model": "claude-sonnet-4-6",
        "sections": [
            {"type": "tldr", "title": "TL;DR", "content": "Quick project chat."}
        ],
    }

    with patch("summarize.call_claude", return_value=mock_summary):
        result = summarize_file(json_path)

    assert result is True
    assert (tmp_path / "summary.json").exists()
    assert (tmp_path / "summary.md").exists()

    saved_json = json.loads((tmp_path / "summary.json").read_text(encoding="utf-8"))
    assert saved_json["recording_type"] == "meeting"

    md_content = (tmp_path / "summary.md").read_text(encoding="utf-8")
    assert "# Summary: recording" in md_content


def test_summarize_file_returns_false_on_api_failure(tmp_path):
    transcript = {
        "text": "Hello",
        "duration": 60.0,
        "segments": [{"start": 0.0, "end": 5.0, "text": "Hello", "speaker": "Alice"}],
    }
    json_path = tmp_path / "recording.json"
    json_path.write_text(json.dumps(transcript), encoding="utf-8")

    with patch("summarize.call_claude", return_value=None):
        result = summarize_file(json_path)

    assert result is False
    assert not (tmp_path / "summary.json").exists()
    assert not (tmp_path / "summary.md").exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_summarize.py::test_summarize_file_writes_both_outputs -v`
Expected: FAIL with `ImportError: cannot import name 'summarize_file'`

- [ ] **Step 3: Implement summarize_file**

Add to `summarize.py`:

```python
from pathlib import Path


def summarize_file(json_path: Path) -> bool:
    data = json.loads(json_path.read_text(encoding="utf-8"))

    transcript_text = format_transcript(data)
    if not transcript_text:
        print(f"[warn] no segments in {json_path.name} — skipping summary")
        return False

    duration = data.get("duration", 0.0)
    summary = call_claude(transcript_text, duration)
    if summary is None:
        return False

    summary.setdefault("summary_model", SUMMARY_MODEL)

    out_dir = json_path.parent
    summary_json_path = out_dir / "summary.json"
    summary_md_path = out_dir / "summary.md"

    recording_name = json_path.stem
    summary_json_path.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    summary_md_path.write_text(
        render_markdown(summary, recording_name), encoding="utf-8"
    )

    print(f"[summary] {summary_md_path}")
    return True
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_summarize.py -v`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add summarize.py tests/test_summarize.py
git commit -m "feat(summarize): add summarize_file to orchestrate and write outputs"
```

---

### Task 6: Integrate into `transcribe.py`

**Files:**
- Modify: `transcribe.py:146-227` (the `main()` function and argparse setup)
- Modify: `tests/test_summarize.py`

- [ ] **Step 1: Write failing test for --summarize flag**

Append to `tests/test_summarize.py`:

```python
import subprocess
import sys


def test_cli_summarize_flag(tmp_path):
    transcript = {
        "text": "Hello",
        "duration": 60.0,
        "segments": [{"start": 0.0, "end": 5.0, "text": "Hello", "speaker": "Alice"}],
    }
    json_path = tmp_path / "test.json"
    json_path.write_text(json.dumps(transcript), encoding="utf-8")

    # Just test that the flag is accepted and calls summarize_file
    # (actual API call is skipped because no ANTHROPIC_API_KEY is set)
    result = subprocess.run(
        [sys.executable, "transcribe.py", "--summarize", str(json_path)],
        capture_output=True,
        text=True,
        env={**os.environ, "ANTHROPIC_API_KEY": ""},
    )
    # Should warn about missing key, not crash
    assert result.returncode == 0
    assert "skipping summary" in result.stdout.lower() or "skipping summary" in result.stderr.lower()
```

Add `import os` to the top of `tests/test_summarize.py` if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_summarize.py::test_cli_summarize_flag -v`
Expected: FAIL (unrecognized argument `--summarize`)

- [ ] **Step 3: Add --summarize and --no-summary flags to transcribe.py argparse**

In `transcribe.py`, modify the `main()` function's argparse section. Add after the `--list-speakers` argument:

```python
    parser.add_argument(
        "--summarize", type=Path, metavar="JSON",
        help="Summarize an existing transcription JSON file",
    )
    parser.add_argument(
        "--no-summary", action="store_true",
        help="Skip automatic summarization after transcription",
    )
```

- [ ] **Step 4: Add --summarize handler in main()**

In `transcribe.py`, add after the `args.enroll` block (before the folder/files logic):

```python
    if args.summarize is not None:
        if not args.summarize.exists():
            print(f"[error] file not found: {args.summarize}")
            sys.exit(1)
        from summarize import summarize_file
        success = summarize_file(args.summarize)
        sys.exit(0 if success else 1)
```

- [ ] **Step 5: Add auto-summarize after successful transcription**

In `transcribe.py`, inside the `for file_path, result in zip(...)` loop, after the `print(f"[done] ...")` line, add:

```python
                    if not args.no_summary:
                        from summarize import summarize_file
                        summarize_file(json_path)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_summarize.py::test_cli_summarize_flag -v`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `pytest -v`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add transcribe.py tests/test_summarize.py
git commit -m "feat: integrate summarization into transcribe.py CLI"
```

---

### Task 7: Manual smoke test

**Files:** None (verification only)

- [ ] **Step 1: Set API key in .env**

Add to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...your-key...
```

- [ ] **Step 2: Test on-demand summarization with existing transcript**

Run: `python transcribe.py --summarize outbox/Saul\ 1_20260522_150946/Saul\ 1.json`

Expected: Creates `summary.json` and `summary.md` in that outbox folder, prints `[summary] ...path...`

- [ ] **Step 3: Verify summary.md looks reasonable**

Open `outbox/Saul 1_20260522_150946/summary.md` and check:
- Has a TL;DR
- Detected it as a meeting
- Listed participants
- Identified key topics
- Any action items or decisions are sensible

- [ ] **Step 4: Verify summary.json is valid**

Run: `python -c "import json; print(json.dumps(json.load(open('outbox/Saul 1_20260522_150946/summary.json')), indent=2)[:500])"`

Expected: Well-formed JSON matching the spec schema

- [ ] **Step 5: Commit any prompt tweaks**

If the system prompt needed adjustment based on output quality:
```bash
git add summarize.py
git commit -m "fix(summarize): tune system prompt for better output"
```
