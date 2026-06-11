import { describe, it, expect, vi, beforeEach } from 'vitest'

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, fn)
    }),
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, fn)
    }),
  },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('./config', () => ({
  getConfig: () => ({ pipeline: { audioHandling: 'delete', autoSummarize: false, minSpeakers: 2 } }),
}))
vi.mock('./pipeline', () => ({
  runPipeline: vi.fn(),
  runSummarize: vi.fn(),
  cancelPipeline: vi.fn(),
}))
vi.mock('./python-env', () => ({
  ensurePythonEnv: vi.fn(async () => {}),
  isEnvReady: () => true,
}))
vi.mock('./speakers', () => ({
  registerNewSpeakers: vi.fn(),
  getSpeakerNamesForRecording: vi.fn(() => ({})),
}))
vi.mock('./estimate', () => ({
  getAudioDurationSec: vi.fn(async () => 60),
  estimateProcessingSeconds: (d: number) => d,
}))

type QueueModule = typeof import('./queue')

let queue: QueueModule

beforeEach(async () => {
  ipcHandlers.clear()
  vi.resetModules()
  queue = await import('./queue')
})

describe('addToQueue', () => {
  it('does not add a duplicate for a file that is already staged', () => {
    queue.addToQueue(['/inbox/a.m4a'])
    queue.addToQueue(['/inbox/a.m4a'])
    expect(queue.getQueueState()).toHaveLength(1)
  })
})

describe('clearDone', () => {
  it('removes done items and keeps staged and error items', () => {
    queue.addToQueue(['/inbox/done.m4a', '/inbox/staged.m4a', '/inbox/failed.m4a'])
    const items = queue.getQueueState()
    items[0].status = 'done'
    items[2].status = 'error'

    queue.clearDone()

    const remaining = queue.getQueueState()
    expect(remaining.map(i => i.fileName)).toEqual(['staged.m4a', 'failed.m4a'])
  })
})

describe('registerQueueIpc', () => {
  it('exposes queue:getState returning the current items', () => {
    queue.registerQueueIpc()
    queue.addToQueue(['/inbox/a.m4a'])

    const handler = ipcHandlers.get('queue:getState')
    expect(handler).toBeDefined()
    const state = handler!() as unknown[]
    expect(state).toHaveLength(1)
  })

  it('exposes queue:clearDone that removes done items', () => {
    queue.registerQueueIpc()
    queue.addToQueue(['/inbox/a.m4a'])
    queue.getQueueState()[0].status = 'done'

    const handler = ipcHandlers.get('queue:clearDone')
    expect(handler).toBeDefined()
    handler!()
    expect(queue.getQueueState()).toHaveLength(0)
  })
})
