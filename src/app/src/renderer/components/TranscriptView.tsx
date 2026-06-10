import { speakerColor } from './SpeakerSubmodule'

interface Segment {
  start: number
  end: number
  text: string
  speaker: string
}

interface Props {
  segments: Segment[]
  speakerMap?: Record<string, string>
  speakerNames?: Record<string, string | null>
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function TranscriptView({ segments, speakerMap, speakerNames }: Props) {
  if (segments.length === 0) {
    return <p className="text-sm text-gray-500">No transcript available.</p>
  }

  const speakerOrder: string[] = []
  for (const seg of segments) {
    if (!speakerOrder.includes(seg.speaker)) {
      speakerOrder.push(seg.speaker)
    }
  }

  function resolvedName(label: string): string {
    if (speakerMap && speakerNames) {
      const speakerId = speakerMap[label]
      if (speakerId && speakerNames[speakerId]) {
        return speakerNames[speakerId]!
      }
    }
    return label
  }

  const collapsed: Array<{ speaker: string; text: string; start: number }> = []
  for (const seg of segments) {
    if (collapsed.length > 0 && collapsed[collapsed.length - 1].speaker === seg.speaker) {
      collapsed[collapsed.length - 1].text += ' ' + seg.text.trim()
    } else {
      collapsed.push({ speaker: seg.speaker, text: seg.text.trim(), start: seg.start })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {collapsed.map((block, i) => (
        <div key={i}>
          <div className="flex items-baseline gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full inline-block ${speakerColor(speakerOrder.indexOf(block.speaker))}`} />
            <span className="text-xs font-medium text-accent-400">{resolvedName(block.speaker)}</span>
            <span className="text-xs text-gray-500">{formatTimestamp(block.start)}</span>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">{block.text}</p>
        </div>
      ))}
    </div>
  )
}
