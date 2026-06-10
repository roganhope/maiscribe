interface Props {
  filePath: string
}

export function AudioPlayer({ filePath }: Props) {
  const src = `local-audio://${encodeURIComponent(filePath)}`

  return (
    <audio controls className="w-full h-10" src={src}>
      Your browser does not support the audio element.
    </audio>
  )
}
