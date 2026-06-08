import json
import os
from pathlib import Path

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


def format_transcript(data: dict) -> str:
    segments = data.get("segments", [])
    if not segments:
        return ""

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


def call_claude(transcript_text: str, duration: float) -> dict | None:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[warn] ANTHROPIC_API_KEY not set — skipping summary")
        return None

    client = anthropic.Anthropic(api_key=api_key)
    duration_minutes = int(duration / 60)

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
