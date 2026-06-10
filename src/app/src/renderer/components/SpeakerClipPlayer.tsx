import { useState, useRef } from 'react'
import type { SpeakerClip } from '../../shared/types'

interface Props {
  clips: SpeakerClip[]
}

export function SpeakerClipPlayer({ clips }: Props) {
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function handlePlay(clip: SpeakerClip) {
    if (playing === clip.filePath) {
      audioRef.current?.pause()
      setPlaying(null)
      return
    }
    if (audioRef.current) {
      audioRef.current.pause()
    }
    const audio = new Audio(`local-audio://${encodeURIComponent(clip.filePath)}`)
    audio.onended = () => setPlaying(null)
    audio.play()
    audioRef.current = audio
    setPlaying(clip.filePath)
  }

  if (clips.length === 0) return null

  return (
    <div className="flex gap-1">
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
