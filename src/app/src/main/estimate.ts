import { statSync } from 'fs'
import { parseFile } from 'music-metadata'

// Fixed cost of a pipeline run regardless of audio length: Modal connect,
// container start, and model load.
export const PIPELINE_OVERHEAD_SEC = 60
// Transcription + diarization time as a fraction of audio duration (T4 GPU).
export const PROCESSING_SPEED_RATIO = 0.5

// Size-based fallback when metadata can't be parsed (bytes per second).
const BITRATE_ESTIMATES: Record<string, number> = {
  '.m4a': 16000,
  '.mp3': 16000,
  '.aac': 16000,
  '.ogg': 16000,
  '.opus': 12000,
  '.wav': 176400,
  '.flac': 88200,
  '.mp4': 20000,
}

function durationFromFileSize(filePath: string): number | null {
  try {
    const stat = statSync(filePath)
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
    const bytesPerSec = BITRATE_ESTIMATES[ext]
    if (!bytesPerSec) return null
    return stat.size / bytesPerSec
  } catch {
    return null
  }
}

export async function getAudioDurationSec(filePath: string): Promise<number | null> {
  try {
    const metadata = await parseFile(filePath, { duration: true })
    const duration = metadata.format.duration
    if (duration && Number.isFinite(duration) && duration > 0) {
      return duration
    }
  } catch {}
  return durationFromFileSize(filePath)
}

export function estimateProcessingSeconds(audioDurationSec: number | null): number | null {
  if (audioDurationSec === null) return null
  return Math.round(PIPELINE_OVERHEAD_SEC + audioDurationSec * PROCESSING_SPEED_RATIO)
}
