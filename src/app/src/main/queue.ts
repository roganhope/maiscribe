import { v4 as uuidv4 } from 'uuid'
import { statSync } from 'fs'
import { ipcMain, BrowserWindow } from 'electron'
import type { QueueItem, QueueItemOptions, QueueState } from '../shared/types'
import { getConfig } from './config'
import { runPipeline, runSummarize, cancelPipeline } from './pipeline'
import { ensurePythonEnv, isEnvReady } from './python-env'
import { registerNewSpeakers, getSpeakerNamesForRecording } from './speakers'

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

const PROCESSING_SPEED_RATIO = 0.5

function estimateAudioDuration(filePath: string): number | null {
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

let items: QueueItem[] = []
let processing = false

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows[0] || null
}

function emitState(): void {
  const win = getMainWindow()
  if (win) {
    win.webContents.send('queue:state', items)
  }
}

let progressInterval: ReturnType<typeof setInterval> | null = null

function updateProgress(item: QueueItem): void {
  if (!item.startedAt) return
  const elapsed = (Date.now() - item.startedAt) / 1000
  if (item.estimatedDurationSec) {
    item.progressPercent = Math.min(95, Math.round((elapsed / item.estimatedDurationSec) * 100))
  } else {
    item.progressPercent = null
  }
  emitState()
}

function processNext(): void {
  if (processing) return
  const next = items.find(i => i.status === 'pending')
  if (!next) return

  processing = true
  next.status = 'processing'
  next.startedAt = Date.now()
  next.progressPercent = 0
  emitState()

  progressInterval = setInterval(() => updateProgress(next), 1000)

  runPipeline(next.filePath, {
    onProgress: (line) => {
      next.progress = line
      emitState()
    },
    onDone: async (outputPath) => {
      if (progressInterval) { clearInterval(progressInterval); progressInterval = null }
      next.outputPath = outputPath

      // Match new speaker embeddings against the local store, then summarize
      // with the resolved names so summaries reference real people.
      let transcriptPath: string | null = null
      const recordingId = outputPath ? outputPath.split('/').pop() || '' : ''
      if (outputPath) {
        try {
          const { readFileSync, readdirSync } = require('fs')
          const { join } = require('path')
          const files = readdirSync(outputPath)
          const jsonFile = files.find((f: string) => f.endsWith('.json') && f !== 'summary.json')
          if (jsonFile) {
            transcriptPath = join(outputPath, jsonFile)
            const data = JSON.parse(readFileSync(transcriptPath, 'utf-8'))
            if (data.speaker_embeddings) {
              registerNewSpeakers(recordingId, data.speaker_embeddings)
            }
          }
        } catch {}
      }

      if (transcriptPath && next.options.summarize) {
        next.progress = 'Summarizing'
        emitState()
        await runSummarize(transcriptPath, getSpeakerNamesForRecording(recordingId))
      }

      next.status = 'done'
      next.progressPercent = 100
      next.completedAt = Date.now()
      processing = false
      emitState()
      processNext()
    },
    onError: (message) => {
      if (progressInterval) { clearInterval(progressInterval); progressInterval = null }
      next.status = 'error'
      next.progressPercent = null
      next.error = message
      next.completedAt = Date.now()
      processing = false
      emitState()
      processNext()
    },
  }, next.options)
}

export function addToQueue(filePaths: string[]): void {
  for (const filePath of filePaths) {
    const already = items.some(i => i.filePath === filePath && (i.status === 'pending' || i.status === 'processing'))
    if (already) continue

    const audioDuration = estimateAudioDuration(filePath)
    const config = getConfig()
    items.push({
      id: uuidv4(),
      filePath,
      fileName: filePath.split('/').pop() || filePath,
      status: 'staged',
      progress: null,
      progressPercent: null,
      outputPath: null,
      error: null,
      addedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      estimatedDurationSec: audioDuration ? Math.round(audioDuration * PROCESSING_SPEED_RATIO) : null,
      options: {
        audioHandling: config?.pipeline.audioHandling || 'delete',
        summarize: config?.pipeline.autoSummarize !== false,
        minSpeakers: config?.pipeline.minSpeakers ?? 2,
      },
    })
  }
  emitState()
}

export async function startQueue(): Promise<void> {
  if (!isEnvReady()) {
    try {
      await ensurePythonEnv()
    } catch {
      return
    }
  }
  for (const item of items) {
    if (item.status === 'staged') {
      item.status = 'pending'
    }
  }
  emitState()
  processNext()
}

export async function startItem(id: string): Promise<void> {
  if (!isEnvReady()) {
    try {
      await ensurePythonEnv()
    } catch {
      return
    }
  }
  const item = items.find(i => i.id === id)
  if (item && item.status === 'staged') {
    item.status = 'pending'
    emitState()
    processNext()
  }
}

export function retryItem(id: string): void {
  const item = items.find(i => i.id === id)
  if (item && item.status === 'error') {
    item.status = 'pending'
    item.error = null
    item.progress = null
    item.completedAt = null
    emitState()
    processNext()
  }
}

export function getQueueState(): QueueState {
  return items
}

export function removeItem(id: string): void {
  items = items.filter(i => i.id !== id)
  emitState()
}

export function updateItemOptions(id: string, options: Partial<QueueItemOptions>): void {
  const item = items.find(i => i.id === id)
  if (item && item.status === 'staged') {
    item.options = { ...item.options, ...options }
    emitState()
  }
}

export function registerQueueIpc(): void {
  ipcMain.on('queue:add', (_event, filePaths: string[]) => {
    addToQueue(filePaths)
  })

  ipcMain.on('queue:start', () => {
    startQueue()
  })

  ipcMain.on('queue:startItem', (_event, id: string) => {
    startItem(id)
  })

  ipcMain.on('queue:retry', (_event, id: string) => {
    retryItem(id)
  })

  ipcMain.on('queue:updateOptions', (_event, id: string, options: Partial<QueueItemOptions>) => {
    updateItemOptions(id, options)
  })

  ipcMain.on('queue:remove', (_event, id: string) => {
    removeItem(id)
  })

  ipcMain.on('pipeline:cancel', () => {
    cancelPipeline()
    const current = items.find(i => i.status === 'processing')
    if (current) {
      current.status = 'error'
      current.error = 'Cancelled by user'
      current.completedAt = Date.now()
      processing = false
      emitState()
      processNext()
    }
  })
}
