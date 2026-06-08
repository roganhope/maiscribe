# Summarization Pipeline Design

## Overview

A post-transcription summarization step that sends speaker-labeled transcripts to Claude (Anthropic API) and produces structured meeting/recording summaries. Adapts output format based on whether the recording is a multi-person conversation or a solo recording.

## Architecture

```
transcribe.py (existing CLI entrypoint)
    └── after successful transcription → calls summarize.summarize_file(json_path)

summarize.py (new module)
    ├── summarize_file(json_path: Path) → writes summary.md + summary.json
    ├── format_transcript(data: dict) → str (speaker-labeled text for prompt)
    ├── call_claude(transcript_text: str, duration: float) → dict
    └── render_markdown(summary: dict) → str

Environment:
    ANTHROPIC_API_KEY — read from os.environ (user sets in .env or shell)
```

## CLI Integration

Automatic (default):
```
python transcribe.py audio.m4a
# transcribes → summarizes → both outputs land in outbox/
```

Skip summarization:
```
python transcribe.py audio.m4a --no-summary
```

On-demand summarization of existing transcript:
```
python transcribe.py --summarize outbox/Saul\ 1_20260522_150946/Saul\ 1.json
```

## Prompt Strategy

Single system prompt instructs Claude to:

1. Detect recording type (multi-person meeting vs. solo)
2. Identify participants from speaker labels
3. Produce applicable sections — omit any that don't apply to the content
4. Return structured JSON (not markdown — we render markdown locally)

Available section types:
- `tldr` — one-paragraph executive summary
- `key_topics` — main discussion points
- `decisions` — anything explicitly agreed upon
- `action_items` — who owes what, deadlines if mentioned
- `open_questions` — unresolved questions raised
- `participants` — who was there and their role/context

For solo recordings (voice memos, brainstorming, lectures), Claude should omit multi-person sections (participants, action items assigned to others) and focus on topics, insights, and any self-assigned TODOs.

## Output Format

### File layout in outbox folder

```
outbox/Saul 1_20260522_150946/
    Saul 1.json          (transcription — existing)
    Saul 1.m4a           (source audio — existing)
    summary.json         (structured summary — new)
    summary.md           (human-readable — new)
```

### summary.json schema

```json
{
  "recording_type": "meeting | solo",
  "participants": ["Steve", "Hope", "SPEAKER_01"],
  "duration_minutes": 22,
  "summary_model": "claude-sonnet-4-6",
  "sections": [
    {
      "type": "tldr",
      "title": "TL;DR",
      "content": "Single paragraph summary."
    },
    {
      "type": "key_topics",
      "title": "Key Topics",
      "items": [
        {"topic": "AI security in fintech", "detail": "Discussion of OWASP..."}
      ]
    },
    {
      "type": "decisions",
      "title": "Decisions",
      "items": ["Will schedule follow-up with co-founder"]
    },
    {
      "type": "action_items",
      "title": "Action Items",
      "items": [
        {"owner": "Steve", "action": "Schedule call with co-founder and Jade", "deadline": null}
      ]
    },
    {
      "type": "open_questions",
      "title": "Open Questions",
      "items": ["Which harness to use — LangGraph vs custom?"]
    },
    {
      "type": "participants",
      "title": "Participants",
      "items": [
        {"name": "Steve", "context": "Co-founder of fintech startup"}
      ]
    }
  ]
}
```

### summary.md format

Generated locally from summary.json:

```markdown
# Summary: Saul 1

**Type:** Meeting | **Duration:** 22 min | **Participants:** Steve, Hope, SPEAKER_01

## TL;DR

Single paragraph summary.

## Key Topics

- **AI security in fintech** — Discussion of OWASP...

## Decisions

- Will schedule follow-up with co-founder

## Action Items

- [ ] **Steve:** Schedule call with co-founder and Jade

## Open Questions

- Which harness to use — LangGraph vs custom?
```

## Model Choice

- **claude-sonnet-4-6** — fast, cheap, sufficient for summarization
- Estimated cost: $0.01–0.05 per summary (30-min meeting ≈ 8k input tokens, ~1k output)

## API Key Handling

- Reads `ANTHROPIC_API_KEY` from `os.environ`
- User stores it in `.env` (already gitignored) or exports in shell
- If key is missing and `--no-summary` is not set, prints a warning and skips summarization (doesn't fail the transcription)

## Error Handling

- API failures (rate limit, network) → print warning, skip summary, don't fail the pipeline
- If transcript exceeds ~180k tokens (Sonnet's 200k context minus room for system prompt + output) → truncate from the middle, keeping first and last 30% for context continuity
- Missing API key → warn once and skip

## Dependencies

- `anthropic` Python SDK (add to requirements.txt)

## Future Considerations (not in scope)

- Obsidian vault integration (drop folder → auto-transcribe → summary appears as note)
- Web UI for drag-and-drop audio upload
- Batch re-summarization of all existing transcripts
- Custom prompt templates per recording type
