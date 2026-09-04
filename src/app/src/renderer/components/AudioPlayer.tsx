import { useEffect, useRef } from 'react'
import { claimPlayback, releasePlayback } from '../utils/audioPlayback'

interface Props {
  filePath: string
}

export function AudioPlayer({ filePath }: Props) {
  const src = 'local-audio://host' + filePath.split('/').map(s => encodeURIComponent(s)).join('/')
  const audioRef = useRef<HTMLAudioElement>(null)

  // A detached <audio> keeps playing, so stop on unmount (tab switch).
  useEffect(() => {
    const audio = audioRef.current
    return () => { if (audio) releasePlayback(audio) }
  }, [])

  return (
    <audio
      ref={audioRef}
      controls
      className="w-full h-10"
      src={src}
      onPlay={() => { if (audioRef.current) claimPlayback(audioRef.current) }}
    >
      Your browser does not support the audio element.
    </audio>
  )
}
