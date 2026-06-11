import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  estimateProcessingSeconds,
  getAudioDurationSec,
  PIPELINE_OVERHEAD_SEC,
  PROCESSING_SPEED_RATIO,
} from './estimate'

function writeTestWav(dir: string, seconds: number): string {
  // Minimal 16-bit mono PCM wav
  const sampleRate = 16000
  const numSamples = sampleRate * seconds
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  const path = join(dir, 'test.wav')
  writeFileSync(path, buf)
  return path
}

describe('estimateProcessingSeconds', () => {
  it('models processing as fixed overhead plus a fraction of audio length', () => {
    expect(estimateProcessingSeconds(600)).toBe(
      Math.round(PIPELINE_OVERHEAD_SEC + 600 * PROCESSING_SPEED_RATIO)
    )
  })

  it('returns at least the overhead for very short clips', () => {
    expect(estimateProcessingSeconds(2)).toBeGreaterThanOrEqual(PIPELINE_OVERHEAD_SEC)
  })

  it('returns null when the audio duration is unknown', () => {
    expect(estimateProcessingSeconds(null)).toBeNull()
  })
})

describe('getAudioDurationSec', () => {
  it('reads the real duration from file metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maiscribe-est-'))
    const wavPath = writeTestWav(dir, 3)
    const duration = await getAudioDurationSec(wavPath)
    expect(duration).not.toBeNull()
    expect(duration!).toBeGreaterThan(2.5)
    expect(duration!).toBeLessThan(3.5)
  })

  it('falls back to a size-based guess for unparseable audio files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maiscribe-est-'))
    const path = join(dir, 'broken.m4a')
    // 160_000 bytes of garbage at the assumed m4a bitrate → finite positive guess
    writeFileSync(path, Buffer.alloc(160_000))
    const duration = await getAudioDurationSec(path)
    expect(duration).not.toBeNull()
    expect(duration!).toBeGreaterThan(0)
  })

  it('returns null for a missing file', async () => {
    expect(await getAudioDurationSec('/nope/missing.m4a')).toBeNull()
  })
})
