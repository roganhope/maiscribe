import { describe, it, expect, beforeEach, vi } from 'vitest'
import { claimPlayback, releasePlayback, stopAllPlayback } from './audioPlayback'

function fakeAudio() {
  return { pause: vi.fn(), currentTime: 5 } as unknown as HTMLAudioElement
}

beforeEach(() => {
  stopAllPlayback()
})

describe('audioPlayback', () => {
  it('pauses and rewinds the previous player when another claims playback', () => {
    const first = fakeAudio()
    const second = fakeAudio()

    claimPlayback(first)
    claimPlayback(second)

    expect(first.pause).toHaveBeenCalledOnce()
    expect(first.currentTime).toBe(0)
    expect(second.pause).not.toHaveBeenCalled()
  })

  it('notifies the displaced player so it can reset its own UI', () => {
    const first = fakeAudio()
    const onStop = vi.fn()

    claimPlayback(first, onStop)
    claimPlayback(fakeAudio())

    expect(onStop).toHaveBeenCalledOnce()
  })

  it('does not pause a player that re-claims playback itself', () => {
    const el = fakeAudio()
    const onStop = vi.fn()

    claimPlayback(el, onStop)
    claimPlayback(el, onStop)

    expect(el.pause).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })

  it('stopAllPlayback pauses and notifies the active player', () => {
    const el = fakeAudio()
    const onStop = vi.fn()

    claimPlayback(el, onStop)
    stopAllPlayback()

    expect(el.pause).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('release pauses without notifying, so unmounting players stay quiet', () => {
    const el = fakeAudio()
    const onStop = vi.fn()

    claimPlayback(el, onStop)
    releasePlayback(el)

    expect(el.pause).toHaveBeenCalledOnce()
    expect(onStop).not.toHaveBeenCalled()
  })

  it('release from a player that no longer holds the claim is a no-op', () => {
    const first = fakeAudio()
    const second = fakeAudio()

    claimPlayback(first)
    claimPlayback(second)
    releasePlayback(first)

    expect(second.pause).not.toHaveBeenCalled()
  })
})
