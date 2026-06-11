import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

class FakeProc extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}

const spawned: FakeProc[] = []

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const proc = new FakeProc()
    spawned.push(proc)
    return proc
  }),
}))
vi.mock('fs', () => ({ mkdirSync: vi.fn() }))
vi.mock('./config', () => ({
  getConfig: () => null,
  getSourceRoot: () => '/tmp/pipeline',
}))
let envVars: Record<string, string> = {}
vi.mock('./env', () => ({ getEnvVars: () => envVars }))
vi.mock('./python-env', () => ({ getPythonPath: () => '/usr/bin/python3' }))

function makeCallbacks() {
  return { onProgress: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
}

async function loadPipeline() {
  return await import('./pipeline')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  spawned.length = 0
  envVars = {}
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('pipeline timeout', () => {
  it('kills a run that exceeds 30 minutes and reports the timeout', async () => {
    const { runPipeline } = await loadPipeline()
    const cb = makeCallbacks()
    runPipeline('/audio/a.m4a', cb)
    const proc = spawned[0]

    vi.advanceTimersByTime(30 * 60 * 1000)

    expect(proc.kill).toHaveBeenCalled()
    expect(cb.onError).toHaveBeenCalledWith('Pipeline timed out after 30 minutes')
  })

  it("does not let an earlier run's timeout kill a later run", async () => {
    const { runPipeline } = await loadPipeline()

    // First run finishes quickly
    const cb1 = makeCallbacks()
    runPipeline('/audio/a.m4a', cb1)
    const proc1 = spawned[0]
    vi.advanceTimersByTime(5 * 60 * 1000)
    proc1.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ event: 'done', file: 'a.m4a', output: '/out/a_123' }) + '\n')
    )
    proc1.emit('close', 0)

    // Second run is still in flight when the first run's 30-min mark passes
    const cb2 = makeCallbacks()
    runPipeline('/audio/b.m4a', cb2)
    const proc2 = spawned[1]
    vi.advanceTimersByTime(25 * 60 * 1000 + 1000)

    expect(proc2.kill).not.toHaveBeenCalled()
    expect(cb1.onError).not.toHaveBeenCalled()
    expect(cb2.onError).not.toHaveBeenCalled()
  })
})

describe('pipeline JSON-lines protocol', () => {
  function emitLine(proc: FakeProc, obj: unknown) {
    proc.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'))
  }

  it('passes --json to transcribe.py', async () => {
    const { runPipeline } = await loadPipeline()
    const { spawn } = await import('child_process')
    runPipeline('/audio/a.m4a', makeCallbacks())
    const args = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(args).toContain('--json')
  })

  it('recovers the exact output path even when it contains " (" and "→"', async () => {
    const { runPipeline } = await loadPipeline()
    const cb = makeCallbacks()
    runPipeline('/audio/take (2).m4a', cb)
    emitLine(spawned[0], {
      event: 'done',
      file: 'take (2).m4a',
      output: '/out/take (2) → final_20260610',
      unknown_speakers: [],
    })
    expect(cb.onDone).toHaveBeenCalledWith('/out/take (2) → final_20260610')
  })

  it('routes step events to onProgress with the bare message', async () => {
    const { runPipeline } = await loadPipeline()
    const cb = makeCallbacks()
    runPipeline('/audio/a.m4a', cb)
    emitLine(spawned[0], { event: 'step', message: 'Transcribing on remote GPU' })
    expect(cb.onProgress).toHaveBeenCalledWith('Transcribing on remote GPU')
    expect(cb.onError).not.toHaveBeenCalled()
    expect(cb.onDone).not.toHaveBeenCalled()
  })

  it('routes error events to onError, prefixing the file when present', async () => {
    const { runPipeline } = await loadPipeline()
    const cb = makeCallbacks()
    runPipeline('/audio/a.m4a', cb)
    emitLine(spawned[0], { event: 'error', file: 'a.m4a', message: 'GPU exploded' })
    expect(cb.onError).toHaveBeenCalledWith('a.m4a: GPU exploded')
    emitLine(spawned[0], { event: 'error', message: 'Modal authentication failed' })
    expect(cb.onError).toHaveBeenCalledWith('Modal authentication failed')
  })

  it('treats non-JSON output lines as progress, never as errors or completion', async () => {
    const { runPipeline } = await loadPipeline()
    const cb = makeCallbacks()
    runPipeline('/audio/a.m4a', cb)
    spawned[0].stdout.emit(
      'data',
      Buffer.from('[warn] summarization failed: rate limited\nsome stray print\n')
    )
    expect(cb.onProgress).toHaveBeenCalledWith('[warn] summarization failed: rate limited')
    expect(cb.onProgress).toHaveBeenCalledWith('some stray print')
    expect(cb.onError).not.toHaveBeenCalled()
    expect(cb.onDone).not.toHaveBeenCalled()
  })

  it('always passes --no-summary even when an API key is set (queue owns summarization)', async () => {
    envVars = { ANTHROPIC_API_KEY: 'sk-test' }
    const { runPipeline } = await loadPipeline()
    const { spawn } = await import('child_process')
    runPipeline('/audio/a.m4a', makeCallbacks())
    const args = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(args).toContain('--no-summary')
  })

  it('handles a JSON event split across two data chunks', async () => {
    const { runPipeline } = await loadPipeline()
    const cb = makeCallbacks()
    runPipeline('/audio/a.m4a', cb)
    const line = JSON.stringify({ event: 'done', file: 'a.m4a', output: '/out/a_1' }) + '\n'
    spawned[0].stdout.emit('data', Buffer.from(line.slice(0, 20)))
    spawned[0].stdout.emit('data', Buffer.from(line.slice(20)))
    expect(cb.onDone).toHaveBeenCalledWith('/out/a_1')
  })
})

describe('runSummarize', () => {
  it('spawns transcribe.py --summarize with the speaker-names map', async () => {
    envVars = { ANTHROPIC_API_KEY: 'sk-test' }
    const { runSummarize } = await loadPipeline()
    const { spawn } = await import('child_process')

    const promise = runSummarize('/out/a_1/a.json', { SPEAKER_00: 'Alice' })
    const args = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(args).toContain('--summarize')
    expect(args).toContain('/out/a_1/a.json')
    expect(args).toContain('--speaker-names')
    expect(args).toContain('{"SPEAKER_00":"Alice"}')

    spawned[0].emit('close', 0)
    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('reports failure on non-zero exit', async () => {
    envVars = { ANTHROPIC_API_KEY: 'sk-test' }
    const { runSummarize } = await loadPipeline()
    const promise = runSummarize('/out/a_1/a.json', {})
    spawned[0].stderr.emit('data', Buffer.from('rate limited'))
    spawned[0].emit('close', 1)
    await expect(promise).resolves.toEqual({ ok: false, error: 'rate limited' })
  })

  it('skips without spawning when no Claude API key is configured', async () => {
    const { runSummarize } = await loadPipeline()
    const result = await runSummarize('/out/a_1/a.json', {})
    expect(result.ok).toBe(false)
    expect(spawned.length).toBe(0)
  })
})
