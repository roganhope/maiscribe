interface SummarySection {
  type: string
  title: string
  content?: string
  items?: any[]
}

interface Segment {
  start: number
  end: number
  text: string
  speaker: string
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Plain-text rendering of a summary, mirroring what SummaryView shows —
 * including the headingless TL;DR lead paragraph.
 */
export function summaryToText(sections: SummarySection[]): string {
  const blocks: string[] = []

  for (const section of sections) {
    const lines: string[] = []
    if (section.type !== 'tldr') lines.push(section.title)

    switch (section.type) {
      case 'tldr':
        if (section.content) lines.push(section.content)
        break
      case 'key_topics':
        for (const item of section.items ?? []) {
          lines.push(`- ${item.topic} — ${item.detail}`)
        }
        break
      case 'action_items':
        for (const item of section.items ?? []) {
          const deadline = item.deadline ? ` (by ${item.deadline})` : ''
          lines.push(`- ${item.owner}: ${item.action}${deadline}`)
        }
        break
      case 'participants':
        for (const item of section.items ?? []) {
          lines.push(`- ${item.name} — ${item.context}`)
        }
        break
      default:
        if (section.content) lines.push(section.content)
        for (const item of section.items ?? []) {
          lines.push(`- ${typeof item === 'string' ? item : JSON.stringify(item)}`)
        }
    }

    if (lines.length > 0) blocks.push(lines.join('\n'))
  }

  return blocks.join('\n\n')
}

/**
 * Plain-text transcript with consecutive same-speaker segments collapsed,
 * matching the grouping TranscriptView renders.
 */
export function transcriptToText(
  segments: Segment[],
  speakerMap?: Record<string, string>,
  speakerNames?: Record<string, string | null>,
): string {
  function resolvedName(label: string): string {
    const speakerId = speakerMap?.[label]
    if (speakerId && speakerNames?.[speakerId]) return speakerNames[speakerId]!
    return label
  }

  const collapsed: Array<{ speaker: string; text: string; start: number }> = []
  for (const seg of segments) {
    const text = seg.text.trim()
    if (!text) continue
    const last = collapsed[collapsed.length - 1]
    if (last && last.speaker === seg.speaker) {
      last.text += ' ' + text
    } else {
      collapsed.push({ speaker: seg.speaker, text, start: seg.start })
    }
  }

  return collapsed
    .map((block) => `[${formatTimestamp(block.start)}] ${resolvedName(block.speaker)}: ${block.text}`)
    .join('\n\n')
}
