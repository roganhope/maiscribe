import type { AudioHandling } from '../../shared/types'
import { toAudioHandling, isStoring, isDeleting } from '../../shared/audioHandling'
import { Toggle } from './Toggle'

interface Props {
  value: AudioHandling
  onChange: (value: AudioHandling) => void
  /** Tighter type scale for the per-item options panel in the queue. */
  compact?: boolean
}

/**
 * The two audio switches, shared by Settings, the wizard and the queue.
 *
 * One component rather than three copies: the mapping between the switches and
 * the stored value is easy to get subtly wrong, and getting it wrong deletes
 * someone's recording.
 */
export function AudioHandlingToggles({ value, onChange, compact }: Props) {
  const storing = isStoring(value)
  const deleting = isDeleting(value)
  const text = compact ? 'text-xs' : 'text-sm'

  return (
    <div className="flex flex-col gap-3">
      <Toggle
        label="Store a copy in maiscribe"
        hint="Keeps the audio alongside its transcript so you can play it back in the app. Off means the transcript is saved on its own."
        checked={storing}
        onChange={(next) => onChange(toAudioHandling(next, deleting))}
        labelClassName={text}
      />
      <Toggle
        label="Delete the original file"
        hint="Removes the audio from where you dropped it in, after the transcript is written. Off leaves your file exactly where it was."
        checked={deleting}
        onChange={(next) => onChange(toAudioHandling(storing, next))}
        labelClassName={text}
        danger
      />
      <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-gray-500`}>
        {describe(value)}
      </p>
    </div>
  )
}

/**
 * Spell out the combination in plain language.
 *
 * Two switches make four outcomes, and "both off" versus "both on" are opposite
 * in consequence while looking equally neutral. One sentence removes the guess.
 */
export function describe(value: AudioHandling): string {
  switch (value) {
    case 'store':
      return 'Your file stays where it is, and a copy is kept in maiscribe.'
    case 'store-and-delete':
      return 'Your file is moved into maiscribe — it will no longer be in its original location.'
    case 'delete':
      return 'Your file is deleted after transcription. Only the transcript is kept.'
    case 'leave':
      return 'Your file is left untouched. maiscribe keeps only the transcript.'
  }
}
