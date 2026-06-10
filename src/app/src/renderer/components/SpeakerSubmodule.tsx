import { useState, useEffect } from 'react'
import type { Speaker, SpeakerClip } from '../../shared/types'
import { SpeakerClipPlayer } from './SpeakerClipPlayer'

interface Props {
  speakerMap: Record<string, string>
  onSpeakerRenamed: () => void
}

const SPEAKER_COLORS = [
  'bg-blue-400', 'bg-green-400', 'bg-yellow-400', 'bg-purple-400',
  'bg-pink-400', 'bg-orange-400', 'bg-teal-400', 'bg-red-400',
]

export function speakerColor(index: number): string {
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length]
}

export function SpeakerSubmodule({ speakerMap, onSpeakerRenamed }: Props) {
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [clips, setClips] = useState<Record<string, SpeakerClip[]>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [syncing, setSyncing] = useState<string | null>(null)

  const speakerIds = Object.values(speakerMap)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    async function load() {
      const loaded: Speaker[] = []
      const loadedClips: Record<string, SpeakerClip[]> = {}
      for (const id of [...new Set(speakerIds)]) {
        const speaker = await window.api.speakers.get(id)
        if (speaker) {
          loaded.push(speaker)
          const c = await window.api.speakers.getClips(id)
          loadedClips[id] = c
        }
      }
      setSpeakers(loaded)
      setClips(loadedClips)
    }
    if (speakerIds.length > 0) load()
  }, [speakerMap])

  async function handleRename(id: string) {
    const trimmed = nameInput.trim()
    if (!trimmed) {
      setEditingId(null)
      return
    }
    setSyncing(id)
    const result = await window.api.speakers.rename(id, trimmed)
    setSpeakers(prev => prev.map(s => s.id === id ? { ...s, name: trimmed } : s))
    setSyncing(null)
    setEditingId(null)
    onSpeakerRenamed()
  }

  async function handleUnassign(id: string) {
    setSyncing(id)
    await window.api.speakers.unassign(id)
    setSpeakers(prev => prev.map(s => s.id === id ? { ...s, name: null, enrolledOnModal: false } : s))
    setSyncing(null)
    onSpeakerRenamed()
  }

  const hasUnnamed = speakers.some(s => !s.name)

  useEffect(() => {
    setExpanded(hasUnnamed)
  }, [hasUnnamed])

  if (speakers.length === 0) return null

  return (
    <section>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-300"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        Speakers
        {hasUnnamed && (
          <span className="text-xs font-normal normal-case text-yellow-400 ml-2">
            {speakers.filter(s => !s.name).length} unnamed
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2">
          {speakers.map((speaker, idx) => (
            <div key={speaker.id} className="flex items-center gap-3 py-1">
              <span className={`w-2.5 h-2.5 rounded-full ${speakerColor(idx)}`} />

              {editingId === speaker.id ? (
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={() => handleRename(speaker.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(speaker.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  autoFocus
                  placeholder="Enter name..."
                  className="text-sm bg-transparent border border-gray-600 rounded px-2 py-0.5 text-gray-100 focus:border-accent-400 outline-none w-40"
                />
              ) : (
                <button
                  onClick={() => {
                    setEditingId(speaker.id)
                    setNameInput(speaker.name || '')
                  }}
                  className={`text-sm ${speaker.name ? 'text-gray-200' : 'text-gray-500 italic'} hover:text-accent-400`}
                >
                  {speaker.name || 'Unknown Speaker'}
                </button>
              )}

              <SpeakerClipPlayer clips={clips[speaker.id] || []} />

              {syncing === speaker.id && (
                <span className="text-xs text-gray-500">syncing...</span>
              )}

              {speaker.name && editingId !== speaker.id && (
                <button
                  onClick={() => handleUnassign(speaker.id)}
                  className="text-xs text-gray-500 hover:text-red-400 ml-auto"
                >
                  unassign
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
