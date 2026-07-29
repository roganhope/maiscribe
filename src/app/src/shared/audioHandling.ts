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
