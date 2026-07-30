import type { AudioHandling } from './types'

/**
 * Two independent switches — "keep a copy" and "delete the original" — encoded
 * as one pipeline value.
 *
 * Storing and deleting are genuinely independent choices, so the four
 * combinations all mean something. `leave` is the one that used to be
 * unreachable: transcribe the file and touch nothing. It is the default,
 * because the safe thing to do with someone's recording is nothing.
 *
 *   store  delete  →  value              effect on the source file
 *   ─────  ──────     ───────────────    ─────────────────────────
 *     ✓      ✗        store              stays, copied into maiscribe
 *     ✓      ✓        store-and-delete   moved into maiscribe
 *     ✗      ✓        delete             removed
 *     ✗      ✗        leave              untouched, transcript only
 */
export function toAudioHandling(store: boolean, deleteOriginal: boolean): AudioHandling {
  if (store) return deleteOriginal ? 'store-and-delete' : 'store'
  return deleteOriginal ? 'delete' : 'leave'
}

export function isStoring(value: AudioHandling): boolean {
  return value === 'store' || value === 'store-and-delete'
}

export function isDeleting(value: AudioHandling): boolean {
  return value === 'delete' || value === 'store-and-delete'
}

/** Whether the app will have audio to play back for this recording. */
export function keepsAudioInApp(value: AudioHandling): boolean {
  return isStoring(value)
}

/**
 * Spell out the combination in plain language.
 *
 * Two switches make four outcomes, and "both off" versus "both on" look equally
 * neutral while being opposite in consequence. One sentence removes the guess.
 */
export function describeAudioHandling(value: AudioHandling): string {
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
