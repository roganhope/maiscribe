import { useState, useRef } from 'react'
import type { SpeakerClip } from '../../shared/types'

interface Props {
  clips: SpeakerClip[]
}

export function SpeakerClipPlayer({ clips }: Props) {
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  function handlePlay(clip: SpeakerClip) {
    if (!audioRef.current) return
    if (playing === clip.filePath) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setPlaying(null)
      return
    }
    const audio = audioRef.current
    audio.onended = () => setPlaying(null)
    audio.onerror = (e) => { console.error('[clip-player] error', e); setPlaying(null) }
    audio.src = `local-audio://${encodeURIComponent(clip.filePath)}`
    audio.play().catch((err) => { console.error('[clip-player] play rejected', err); setPlaying(null) })
    setPlaying(clip.filePath)
  }

  if (clips.length === 0) return null

  return (
    <div className="flex gap-1">
      <audio ref={audioRef} className="hidden" />
      {clips.map((clip, i) => (
        <button
          key={clip.filePath}
          onClick={() => handlePlay(clip)}
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs transition-colors ${
            playing === clip.filePath
              ? 'bg-accent-400 text-gray-900'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
          title={`Play clip ${i + 1}`}
        >
          {playing === clip.filePath ? '■' : '▶'}
        </button>
      ))}
    </div>
  )
}
