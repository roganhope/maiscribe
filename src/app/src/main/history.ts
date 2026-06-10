import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'fs'
import { join, extname } from 'path'
import { ipcMain, protocol } from 'electron'
import { getConfig } from './config'
import { getSpeakerMap } from './speakers'
import type { RecordingListItem, RecordingDetail } from '../shared/types'

const AUDIO_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.flac', '.ogg', '.aac', '.opus', '.mp4']

function getOutboxPath(): string | null {
  const config = getConfig()
  if (!config) return null
  return join(config.basePath, 'outbox')
}

function parseDateFromFolderName(folderName: string): string {
  const parts = folderName.split('_')
  if (parts.length < 2) return ''
  const timePart = parts.pop()!
  const datePart = parts.pop()!
  if (datePart.length !== 8 || timePart.length !== 6) return ''
  const year = datePart.slice(0, 4)
  const month = datePart.slice(4, 6)
  const day = datePart.slice(6, 8)
  const hour = timePart.slice(0, 2)
  const minute = timePart.slice(2, 4)
  const second = timePart.slice(4, 6)
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

function extractTitleFromFolderName(folderName: string): string {
  const parts = folderName.split('_')
  if (parts.length < 3) return folderName
  parts.pop() // remove time
  parts.pop() // remove date
  return parts.join('_')
}

function findAudioFile(folderPath: string): string | null {
  try {
    const files = readdirSync(folderPath)
    for (const file of files) {
      if (AUDIO_EXTENSIONS.includes(extname(file).toLowerCase())) {
        return join(folderPath, file)
      }
    }
  } catch {}
  return null
}

function readJsonSafe(filePath: string): any | null {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

export function listRecordings(): RecordingListItem[] {
  const outboxPath = getOutboxPath()
  if (!outboxPath || !existsSync(outboxPath)) return []

  const entries = readdirSync(outboxPath)
  const recordings: RecordingListItem[] = []

  for (const entry of entries) {
    const folderPath = join(outboxPath, entry)
    try {
      if (!statSync(folderPath).isDirectory()) continue
    } catch {
      continue
    }

    const summary = readJsonSafe(join(folderPath, 'summary.json'))

    const title = summary?.title || extractTitleFromFolderName(entry)
    const date = parseDateFromFolderName(entry)
    const participants = summary?.participants || []
    const durationMinutes = summary?.duration_minutes || 0
    const recordingType = summary?.recording_type || 'unknown'
    const hasAudio = findAudioFile(folderPath) !== null

    recordings.push({
      id: entry,
      folderPath,
      title,
      date,
      participants,
      durationMinutes,
      recordingType,
      hasAudio,
    })
  }

  recordings.sort((a, b) => b.date.localeCompare(a.date))
  return recordings
}

export function getRecording(folderPath: string): RecordingDetail | null {
  if (!existsSync(folderPath)) return null

  const folderName = folderPath.split('/').pop()!
  const summary = readJsonSafe(join(folderPath, 'summary.json'))

  const files = readdirSync(folderPath)
  const transcriptionFile = files.find(
    f => f.endsWith('.json') && f !== 'summary.json'
  )
  const transcription = transcriptionFile
    ? readJsonSafe(join(folderPath, transcriptionFile))
    : null

  const title = summary?.title || extractTitleFromFolderName(folderName)
  const date = parseDateFromFolderName(folderName)
  const audioFilePath = findAudioFile(folderPath)

  return {
    id: folderName,
    folderPath,
    title,
    date,
    participants: summary?.participants || [],
    durationMinutes: summary?.duration_minutes || 0,
    recordingType: summary?.recording_type || 'unknown',
    audioFilePath,
    summary: {
      sections: summary?.sections || [],
    },
    transcription: transcription
      ? {
          text: transcription.text || '',
          segments: transcription.segments || [],
          language: transcription.language || 'en',
          duration: transcription.duration || 0,
          speakerMap: getSpeakerMap(folderName),
        }
      : { text: '', segments: [], language: 'en', duration: 0, speakerMap: {} },
  }
}

export function updateTitle(folderPath: string, title: string): void {
  const summaryPath = join(folderPath, 'summary.json')
  const summary = readJsonSafe(summaryPath)
  if (!summary) return
  summary.title = title
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8')
}

export function deleteRecording(folderPath: string): void {
  if (existsSync(folderPath)) {
    rmSync(folderPath, { recursive: true })
  }
}

export function registerHistoryIpc(): void {
  ipcMain.handle('history:list', () => listRecordings())
  ipcMain.handle('history:get', (_event, folderPath: string) => getRecording(folderPath))
  ipcMain.handle('history:updateTitle', (_event, folderPath: string, title: string) => {
    updateTitle(folderPath, title)
  })
  ipcMain.handle('history:delete', (_event, folderPath: string) => {
    deleteRecording(folderPath)
  })
}

export function registerAudioProtocol(): void {
  const { net } = require('electron')
  protocol.handle('local-audio', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname)
    return net.fetch('file://' + filePath, { headers: request.headers })
  })
}
