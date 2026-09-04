/**
 * App-wide "only one thing plays at a time" registry.
 *
 * Every <audio> element in the app lives in its own component, so nothing
 * stops two of them overlapping on its own. Players claim playback here
 * before they start; claiming pauses whoever held it and lets that player
 * reset its own UI through the onStop callback.
 */

let activeEl: HTMLAudioElement | null = null
let activeOnStop: (() => void) | null = null

function stopActive(): void {
  if (!activeEl) return
  const notify = activeOnStop
  activeEl.pause()
  activeEl.currentTime = 0
  activeEl = null
  activeOnStop = null
  notify?.()
}

/** Take over playback, pausing whatever else was playing. */
export function claimPlayback(el: HTMLAudioElement, onStop?: () => void): void {
  if (activeEl && activeEl !== el) stopActive()
  activeEl = el
  activeOnStop = onStop ?? null
}

/** Stop whatever is playing, wherever it is. Used when leaving a view. */
export function stopAllPlayback(): void {
  stopActive()
}

/**
 * Give up the claim for `el` without calling its onStop — for a player that
 * is unmounting or has already reset itself. A detached <audio> keeps
 * playing in Chromium, so unmounting components must call this.
 */
export function releasePlayback(el: HTMLAudioElement): void {
  if (activeEl !== el) return
  activeEl.pause()
  activeEl = null
  activeOnStop = null
}
