import type { AudioHandling } from '../../shared/types'
import { toAudioHandling, isStoring, isDeleting, describeAudioHandling } from '../../shared/audioHandling'
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
        {describeAudioHandling(value)}
      </p>
    </div>
  )
}
