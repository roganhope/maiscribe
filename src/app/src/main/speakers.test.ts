import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let userDataDir = ''
let basePath = ''

class FakeProc extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}

const spawnSpy = vi.fn(() => {
  const proc = new FakeProc()
  setImmediate(() => proc.emit('close', 0))
  return proc
})

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...(args as [])),
}))
vi.mock('./config', () => ({
  getConfig: () => ({ basePath }),
  getSourceRoot: () => '/tmp/pipeline',
}))
vi.mock('./env', () => ({ getEnvVars: () => ({}) }))
vi.mock('./python-env', () => ({ getPythonPath: () => 'python3' }))

function seedStore(speakers: Record<string, unknown>) {
  writeFileSync(join(userDataDir, 'speakers.json'), JSON.stringify({ speakers }), 'utf-8')
}

function readStoreFile(): any {
  return JSON.parse(readFileSync(join(userDataDir, 'speakers.json'), 'utf-8'))
}

function makeSpeaker(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    embedding: [1, 0, 0],
    appearances: [],
    ...overrides,
  }
}

async function loadSpeakers() {
  return await import('./speakers')
}

beforeEach(() => {
  vi.resetModules()
  spawnSpy.mockClear()
  userDataDir = mkdtempSync(join(tmpdir(), 'maiscribe-userdata-'))
  basePath = mkdtempSync(join(tmpdir(), 'maiscribe-base-'))
})

describe('renameSpeaker (pure local)', () => {
  it('sets the name without spawning any subprocess', async () => {
    seedStore({ sp_a: makeSpeaker('sp_a') })
    const { renameSpeaker } = await loadSpeakers()

    const result = await renameSpeaker('sp_a', 'Alice')

    expect(result.ok).toBe(true)
    expect(readStoreFile().speakers.sp_a.name).toBe('Alice')
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it('does not rewrite transcript JSON files', async () => {
    const recId = 'meeting_20260101_120000'
    seedStore({
      sp_a: makeSpeaker('sp_a', {
        appearances: [{ recordingId: recId, originalLabel: 'SPEAKER_00' }],
      }),
    })
    const folder = join(basePath, 'outbox', recId)
    mkdirSync(folder, { recursive: true })
    const transcript = {
      segments: [{ start: 0, end: 1, text: 'hi', speaker: 'SPEAKER_00' }],
      speaker_embeddings: { SPEAKER_00: [1, 0, 0] },
    }
    const transcriptPath = join(folder, 'meeting.json')
    writeFileSync(transcriptPath, JSON.stringify(transcript), 'utf-8')

    const { renameSpeaker } = await loadSpeakers()
    await renameSpeaker('sp_a', 'Alice')

    expect(JSON.parse(readFileSync(transcriptPath, 'utf-8'))).toEqual(transcript)
  })
})

describe('mergeSpeakers / deleteSpeaker / unassignSpeaker (pure local)', () => {
  it('merges appearances and embeddings locally without subprocesses', async () => {
    seedStore({
      sp_keep: makeSpeaker('sp_keep', {
        name: 'Alice',
        embedding: [1, 0, 0],
        appearances: [{ recordingId: 'rec1', originalLabel: 'SPEAKER_00' }],
      }),
      sp_rm: makeSpeaker('sp_rm', {
        name: 'Alise',
        embedding: [0, 1, 0],
        appearances: [{ recordingId: 'rec2', originalLabel: 'SPEAKER_01' }],
      }),
    })
    const { mergeSpeakers } = await loadSpeakers()

    await mergeSpeakers('sp_keep', 'sp_rm')

    const store = readStoreFile()
    expect(store.speakers.sp_rm).toBeUndefined()
    expect(store.speakers.sp_keep.embedding).toEqual([0.5, 0.5, 0])
    expect(store.speakers.sp_keep.appearances).toEqual([
      { recordingId: 'rec1', originalLabel: 'SPEAKER_00' },
      { recordingId: 'rec2', originalLabel: 'SPEAKER_01' },
    ])
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it('deletes and unassigns without subprocesses', async () => {
    seedStore({
      sp_a: makeSpeaker('sp_a', { name: 'Alice' }),
      sp_b: makeSpeaker('sp_b', { name: 'Bob' }),
    })
    const { deleteSpeaker, unassignSpeaker } = await loadSpeakers()

    await deleteSpeaker('sp_a')
    await unassignSpeaker('sp_b')

    const store = readStoreFile()
    expect(store.speakers.sp_a).toBeUndefined()
    expect(store.speakers.sp_b.name).toBeNull()
    expect(spawnSpy).not.toHaveBeenCalled()
  })
})

describe('getSpeakerNamesForRecording', () => {
  it('maps original segment labels to assigned names for one recording', async () => {
    seedStore({
      sp_a: makeSpeaker('sp_a', {
        name: 'Alice',
        appearances: [
          { recordingId: 'rec1', originalLabel: 'SPEAKER_00' },
          { recordingId: 'rec2', originalLabel: 'SPEAKER_03' },
        ],
      }),
      sp_b: makeSpeaker('sp_b', {
        name: null, // unnamed speakers are excluded
        appearances: [{ recordingId: 'rec1', originalLabel: 'SPEAKER_01' }],
      }),
    })
    const { getSpeakerNamesForRecording } = await loadSpeakers()

    expect(getSpeakerNamesForRecording('rec1')).toEqual({ SPEAKER_00: 'Alice' })
    expect(getSpeakerNamesForRecording('rec2')).toEqual({ SPEAKER_03: 'Alice' })
    expect(getSpeakerNamesForRecording('rec3')).toEqual({})
  })
})

describe('registerNewSpeakers (regression)', () => {
  it('matches a close embedding to an existing speaker and records the appearance', async () => {
    seedStore({
      sp_a: makeSpeaker('sp_a', { name: 'Alice', embedding: [1, 0, 0] }),
    })
    const { registerNewSpeakers } = await loadSpeakers()

    const mapping = registerNewSpeakers('rec9', {
      SPEAKER_00: [0.99, 0.01, 0], // ~Alice
      SPEAKER_01: [0, 0, 1], // new person
    })

    expect(mapping.SPEAKER_00).toBe('sp_a')
    const store = readStoreFile()
    expect(store.speakers.sp_a.appearances).toEqual([
      { recordingId: 'rec9', originalLabel: 'SPEAKER_00' },
    ])
    const newId = mapping.SPEAKER_01
    expect(newId).not.toBe('sp_a')
    expect(store.speakers[newId].appearances).toEqual([
      { recordingId: 'rec9', originalLabel: 'SPEAKER_01' },
    ])
  })
})
