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
