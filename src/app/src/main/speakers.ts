import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { app, ipcMain } from 'electron'
import { randomBytes } from 'crypto'
import { getConfig } from './config'
import type { Speaker, SpeakerClip } from '../shared/types'

interface SpeakerStore {
  speakers: Record<string, Speaker>
}

function storePath(): string {
  return join(app.getPath('userData'), 'speakers.json')
}

function readStore(): SpeakerStore {
  const path = storePath()
  if (!existsSync(path)) return { speakers: {} }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function writeStore(store: SpeakerStore): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf-8')
}

function generateId(): string {
  return 'sp_' + randomBytes(6).toString('hex')
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

const SIMILARITY_THRESHOLD = 0.85

function findBestMatch(store: SpeakerStore, embedding: number[]): Speaker | null {
  let bestSpeaker: Speaker | null = null
  let bestScore = 0
  for (const speaker of Object.values(store.speakers)) {
    const score = cosineSimilarity(embedding, speaker.embedding)
    if (score > bestScore) {
      bestScore = score
      bestSpeaker = speaker
    }
  }
  return bestScore >= SIMILARITY_THRESHOLD ? bestSpeaker : null
}

export function matchSpeakerEmbedding(embedding: number[]): Speaker | null {
  return findBestMatch(readStore(), embedding)
}

export function registerNewSpeakers(
  recordingId: string,
  embeddings: Record<string, number[]>
): Record<string, string> {
  const store = readStore()
  const labelToSpeakerId: Record<string, string> = {}

  for (const [label, embedding] of Object.entries(embeddings)) {
    // Match against the same store object we write back, so appearance
    // pushes on the matched speaker are not lost.
    const match = findBestMatch(store, embedding)
    if (match) {
      const alreadyAppeared = match.appearances.some(a => a.recordingId === recordingId)
      if (!alreadyAppeared) {
        match.appearances.push({ recordingId, originalLabel: label })
      }
      labelToSpeakerId[label] = match.id
    } else {
      const id = generateId()
      const newSpeaker: Speaker = {
        id,
        name: null,
        notes: null,
        createdAt: new Date().toISOString(),
        embedding,
        appearances: [{ recordingId, originalLabel: label }],
      }
      store.speakers[id] = newSpeaker
      labelToSpeakerId[label] = id
    }
  }

  writeStore(store)
  return labelToSpeakerId
}

export async function renameSpeaker(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const store = readStore()
  const speaker = store.speakers[id]
  if (!speaker) return { ok: false, error: 'speaker not found' }

  speaker.name = name
  writeStore(store)
  return { ok: true }
}

export async function unassignSpeaker(id: string): Promise<void> {
  const store = readStore()
  const speaker = store.speakers[id]
  if (!speaker) return

  speaker.name = null
  writeStore(store)
}

export function updateSpeakerNotes(id: string, notes: string): void {
  const store = readStore()
  const speaker = store.speakers[id]
  if (!speaker) return
  speaker.notes = notes
  writeStore(store)
}

export async function mergeSpeakers(keepId: string, removeId: string): Promise<void> {
  const store = readStore()
  const keep = store.speakers[keepId]
  const remove = store.speakers[removeId]
  if (!keep || !remove) return

  keep.embedding = keep.embedding.map((v, i) => (v + remove.embedding[i]) / 2)

  for (const app of remove.appearances) {
    const exists = keep.appearances.some(
      a => a.recordingId === app.recordingId && a.originalLabel === app.originalLabel
    )
    if (!exists) keep.appearances.push(app)
  }

  delete store.speakers[removeId]
  writeStore(store)
}

export async function deleteSpeaker(id: string): Promise<void> {
  const store = readStore()
  if (!store.speakers[id]) return
  delete store.speakers[id]
  writeStore(store)
}

export function getSpeakerNamesForRecording(recordingId: string): Record<string, string> {
  const store = readStore()
  const names: Record<string, string> = {}
  for (const speaker of Object.values(store.speakers)) {
    if (!speaker.name) continue
    for (const appearance of speaker.appearances) {
      if (appearance.recordingId === recordingId) {
        names[appearance.originalLabel] = speaker.name
      }
    }
  }
  return names
}

function resolveRecordingFolder(outboxPath: string, recordingId: string): string | null {
  const exact = join(outboxPath, recordingId)
  if (existsSync(exact)) return exact
  const stem = recordingId.replace(/_\d{8}_\d{6}$/, '')
  try {
    const match = readdirSync(outboxPath)
      .filter(f => f.startsWith(stem + '_') && existsSync(join(outboxPath, f, 'speakers')))
      .sort()
      .pop()
    if (match) return join(outboxPath, match)
  } catch {}
  return null
}

export function getSpeakerQuotes(id: string): string[] {
  const store = readStore()
  const speaker = store.speakers[id]
  if (!speaker) return []

  const config = getConfig()
  if (!config) return []
  const outboxPath = join(config.basePath, 'outbox')

  const quotes: string[] = []
  for (const appearance of speaker.appearances) {
    const folderPath = resolveRecordingFolder(outboxPath, appearance.recordingId)
    if (!folderPath) continue
    try {
      const files = readdirSync(folderPath).filter(
        f => f.endsWith('.json') && f !== 'summary.json'
      )
      for (const file of files) {
        const data = JSON.parse(readFileSync(join(folderPath, file), 'utf-8'))
        if (!data.segments) continue
        for (const seg of data.segments) {
          if (seg.speaker === appearance.originalLabel || seg.speaker === speaker.name) {
            const text = (seg.text || '').trim()
            if (text.length > 20 && !quotes.includes(text)) {
              quotes.push(text)
              if (quotes.length >= 3) return quotes
            }
          }
        }
      }
    } catch {}
  }
  return quotes
}

export function getSpeakerClips(id: string): SpeakerClip[] {
  const store = readStore()
  const speaker = store.speakers[id]
  if (!speaker) return []

  const config = getConfig()
  if (!config) return []
  const outboxPath = join(config.basePath, 'outbox')

  const clips: SpeakerClip[] = []
  for (const appearance of speaker.appearances) {
    const folder = resolveRecordingFolder(outboxPath, appearance.recordingId)
    if (!folder) continue
    const clipsDir = join(folder, 'speakers')
    if (!existsSync(clipsDir)) continue
    try {
      const files = readdirSync(clipsDir).filter(
        f => f.startsWith(appearance.originalLabel + '_clip') && f.endsWith('.wav')
      )
      for (const file of files) {
        clips.push({
          speakerId: id,
          recordingId: appearance.recordingId,
          filePath: join(clipsDir, file),
          start: 0,
          end: 0,
        })
      }
    } catch {}
  }
  return clips
}

export function getSpeakerMap(recordingId: string, segmentLabels?: string[]): Record<string, string> {
  const store = readStore()
  const map: Record<string, string> = {}
  const labelSet = segmentLabels ? new Set(segmentLabels) : null

  for (const speaker of Object.values(store.speakers)) {
    for (const appearance of speaker.appearances) {
      if (appearance.recordingId === recordingId) {
        map[appearance.originalLabel] = speaker.id
        if (speaker.name) {
          map[speaker.name] = speaker.id
        }
      }
    }
    if (speaker.name && labelSet?.has(speaker.name)) {
      map[speaker.name] = speaker.id
    }
  }
  return map
}

export function listSpeakers(): Speaker[] {
  const store = readStore()
  return Object.values(store.speakers)
}

export function getSpeaker(id: string): Speaker | null {
  const store = readStore()
  return store.speakers[id] || null
}

export function registerSpeakersIpc(): void {
  ipcMain.handle('speakers:list', () => listSpeakers())
  ipcMain.handle('speakers:get', (_event, id: string) => getSpeaker(id))
  ipcMain.handle('speakers:rename', (_event, id: string, name: string) => renameSpeaker(id, name))
  ipcMain.handle('speakers:unassign', (_event, id: string) => unassignSpeaker(id))
  ipcMain.handle('speakers:updateNotes', (_event, id: string, notes: string) => {
    updateSpeakerNotes(id, notes)
  })
  ipcMain.handle('speakers:merge', (_event, keepId: string, removeId: string) => mergeSpeakers(keepId, removeId))
  ipcMain.handle('speakers:delete', (_event, id: string) => deleteSpeaker(id))
  ipcMain.handle('speakers:getClips', (_event, id: string) => getSpeakerClips(id))
  ipcMain.handle('speakers:getQuotes', (_event, id: string) => getSpeakerQuotes(id))
}
