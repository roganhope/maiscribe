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
  const hasClaude = !!(envVars.CLAUDE_API_KEY || envVars.ANTHROPIC_API_KEY)
  const summarize = hasClaude && (itemOptions?.summarize ?? (config?.pipeline.autoSummarize !== false))
  if (!summarize) {
    args.push('--no-summary')
  }

  currentProcess = spawn(pythonPath, args, {
    cwd: sourceRoot,
    env: { ...process.env, ...envVars },
  })

  let stderr = ''

  currentProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      if (line.startsWith('[done]')) {
        const match = line.match(/→\s*(.+?)(\s*\(|$)/)
        const outputPath = match ? match[1].trim() : ''
        callbacks.onDone(outputPath)
      } else if (line.startsWith('[error]')) {
        callbacks.onError(line.replace('[error] ', ''))
      } else if (line.startsWith('[step] ')) {
        callbacks.onProgress(line.replace('[step] ', ''))
      } else {
        callbacks.onProgress(line)
      }
    }
  })

  currentProcess.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString()
  })

  currentProcess.on('close', (code) => {
    if (code !== 0 && code !== null) {
      callbacks.onError(stderr.trim() || `Process exited with code ${code}`)
    }
    currentProcess = null
  })

  // 30 minute timeout
  setTimeout(() => {
    if (currentProcess) {
      currentProcess.kill()
      callbacks.onError('Pipeline timed out after 30 minutes')
      currentProcess = null
    }
  }, 30 * 60 * 1000)
}

export function cancelPipeline(): void {
  if (currentProcess) {
    currentProcess.kill()
    currentProcess = null
  }
}
