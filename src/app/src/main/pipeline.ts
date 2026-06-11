import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { getConfig, getSourceRoot } from './config'
import { getEnvVars } from './env'
import { getPythonPath } from './python-env'
import type { QueueItemOptions } from '../shared/types'

export interface PipelineCallbacks {
  onProgress: (line: string) => void
  onDone: (outputPath: string) => void
  onError: (message: string) => void
}

let currentProcess: ChildProcess | null = null

export function runPipeline(filePath: string, callbacks: PipelineCallbacks, itemOptions?: QueueItemOptions): void {
  const config = getConfig()
  const pythonPath = getPythonPath()
  const sourceRoot = getSourceRoot()
  const transcriptPath = join(sourceRoot, 'transcribe.py')
  const envVars = getEnvVars()

  const args = [transcriptPath, filePath]
  if (config?.basePath) {
    const outbox = join(config.basePath, 'outbox')
    mkdirSync(outbox, { recursive: true })
    args.push('--outbox', outbox)
  }
  const audioHandling = itemOptions?.audioHandling || config?.pipeline.audioHandling || 'delete'
  args.push('--audio-handling', audioHandling)
  const minSpeakers = itemOptions?.minSpeakers ?? config?.pipeline.minSpeakers ?? 2
  args.push('--min-speakers', String(minSpeakers))
  // Summarization runs as a separate step after local speaker matching,
  // so names make it into the summary — see runSummarize.
  args.push('--no-summary', '--json')

  const proc = spawn(pythonPath, args, {
    cwd: sourceRoot,
    env: { ...process.env, ...envVars },
  })
  currentProcess = proc

  let stderr = ''
  let stdoutBuffer = ''

  const handleLine = (line: string): void => {
    let event: { event?: string; message?: string; file?: string; output?: string } | null = null
    if (line.startsWith('{')) {
      try {
        event = JSON.parse(line)
      } catch {
        event = null
      }
    }
    switch (event?.event) {
      case 'done':
        callbacks.onDone(event.output || '')
        break
      case 'error':
        callbacks.onError(event.file ? `${event.file}: ${event.message}` : event.message || 'Unknown error')
        break
      case 'step':
        callbacks.onProgress(event.message || '')
        break
      default:
        callbacks.onProgress(line)
    }
  }

  proc.stdout?.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString()
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() || ''
    for (const line of lines) {
      if (line.trim()) {
        handleLine(line)
      }
    }
  })

  proc.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString()
  })

  // 30 minute timeout, cleared when this process exits
  const timeout = setTimeout(() => {
    proc.kill()
    callbacks.onError('Pipeline timed out after 30 minutes')
    if (currentProcess === proc) {
      currentProcess = null
    }
  }, 30 * 60 * 1000)

  proc.on('close', (code) => {
    clearTimeout(timeout)
    if (code !== 0 && code !== null) {
      callbacks.onError(stderr.trim() || `Process exited with code ${code}`)
    }
    if (currentProcess === proc) {
      currentProcess = null
    }
  })
}

export function cancelPipeline(): void {
  if (currentProcess) {
    currentProcess.kill()
    currentProcess = null
  }
}

export function runSummarize(
  jsonPath: string,
  speakerNames: Record<string, string>
): Promise<{ ok: boolean; error?: string }> {
  const envVars = getEnvVars()
  if (!envVars.CLAUDE_API_KEY && !envVars.ANTHROPIC_API_KEY) {
    return Promise.resolve({ ok: false, error: 'no Claude API key configured' })
  }

  return new Promise((resolve) => {
    const sourceRoot = getSourceRoot()
    const args = [
      join(sourceRoot, 'transcribe.py'),
      '--summarize', jsonPath,
      '--speaker-names', JSON.stringify(speakerNames),
    ]
    const proc = spawn(getPythonPath(), args, {
      cwd: sourceRoot,
      env: { ...process.env, ...envVars },
    })

    let stderr = ''
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({ ok: false, error: stderr.trim() || `summarize exited with code ${code}` })
      }
    })
  })
}
