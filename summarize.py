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
