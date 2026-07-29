import { describe, it, expect } from 'vitest'
import type { AudioHandling } from './types'
import { toAudioHandling, isStoring, isDeleting, keepsAudioInApp } from './audioHandling'
import { describe as describeHandling } from '../renderer/components/AudioHandlingToggles'

describe('toAudioHandling', () => {
  it('maps all four combinations', () => {
    expect(toAudioHandling(true, false)).toBe('store')
    expect(toAudioHandling(true, true)).toBe('store-and-delete')
    expect(toAudioHandling(false, true)).toBe('delete')
    expect(toAudioHandling(false, false)).toBe('leave')
  })

  it('never deletes when the delete switch is off', () => {
    // The regression this replaces: turning off "store a copy" produced
    // 'delete', so opting out of keeping a copy destroyed the original.
    expect(toAudioHandling(false, false)).not.toBe('delete')
    expect(toAudioHandling(false, false)).not.toBe('store-and-delete')
    expect(toAudioHandling(true, false)).not.toBe('delete')
    expect(toAudioHandling(true, false)).not.toBe('store-and-delete')
  })

  it('never stores when the store switch is off', () => {
    expect(isStoring(toAudioHandling(false, true))).toBe(false)
    expect(isStoring(toAudioHandling(false, false))).toBe(false)
  })
})

describe('round trip', () => {
  const cases: AudioHandling[] = ['store', 'store-and-delete', 'delete', 'leave']

  it('reading the switches back out reproduces the value', () => {
    // Guards the toggles: each switch reads state and writes the pair back, so
    // a lossy round trip would silently change the other switch.
    for (const value of cases) {
      expect(toAudioHandling(isStoring(value), isDeleting(value))).toBe(value)
    }
  })

  it('flipping one switch leaves the other alone', () => {
    for (const value of cases) {
      const flippedStore = toAudioHandling(!isStoring(value), isDeleting(value))
      expect(isDeleting(flippedStore)).toBe(isDeleting(value))

      const flippedDelete = toAudioHandling(isStoring(value), !isDeleting(value))
      expect(isStoring(flippedDelete)).toBe(isStoring(value))
    }
  })
})

describe('keepsAudioInApp', () => {
  it('is true only when a copy is kept', () => {
    // history.ts finds audio inside the recording folder, so no copy means no
    // playback — true for 'delete' and 'leave' alike.
    expect(keepsAudioInApp('store')).toBe(true)
    expect(keepsAudioInApp('store-and-delete')).toBe(true)
    expect(keepsAudioInApp('delete')).toBe(false)
    expect(keepsAudioInApp('leave')).toBe(false)
  })
})

describe('describe', () => {
  const cases: AudioHandling[] = ['store', 'store-and-delete', 'delete', 'leave']

  it('covers every value', () => {
    for (const value of cases) {
      expect(describeHandling(value)).toBeTruthy()
    }
  })

  it('only promises deletion when something is actually deleted', () => {
    for (const value of cases) {
      const mentionsDeletion = /delet|moved/.test(describeHandling(value))
      expect(mentionsDeletion).toBe(isDeleting(value))
    }
  })

  it('says the file is untouched only when it is', () => {
    expect(describeHandling('leave')).toMatch(/untouched/)
    expect(describeHandling('delete')).not.toMatch(/untouched/)
  })
})
