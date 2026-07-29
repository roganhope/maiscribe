import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { ipcMain } from 'electron'
import { getPythonPath } from './python-env'
import { getEnvVars } from './env'
import { getConfig, getSourceRoot, markProvisioned } from './config'
import type { ProvisionStatus } from '../shared/types'

/**
 * Runs setup_modal.py so a workspace is warm before the first transcription.
 *
 * The GPU image and the ~3GB of model weights are cached per Modal workspace.
 * Without this, both are paid lazily during the user's first drag-and-drop,
 * which reads as the app hanging. Provisioning up front moves that cost to a
 * place with a progress bar in front of it.
 *
 * Modelled on python-env.ts: module-level status, one pull IPC, one push channel.
 */

const IDLE: ProvisionStatus = { state: 'idle', message: '', index: 0, total: 0 }

let currentStatus: ProvisionStatus = IDLE
let statusCallback: ((status: ProvisionStatus) => void) | null = null
let currentProcess: ChildProcess | null = null
let readyCallback: (() => void) | null = null

function setStatus(next: Partial<ProvisionStatus> & Pick<ProvisionStatus, 'state'>): void {
  currentStatus = { ...currentStatus, ...next }
  statusCallback?.(currentStatus)
}

export function getStatus(): ProvisionStatus {
  return currentStatus
}

export function onStatusChange(cb: (status: ProvisionStatus) => void): void {
  statusCallback = cb
}

/** Called when provisioning finishes, so the queue can drain what it held back. */
export function onReady(cb: () => void): void {
  readyCallback = cb
}

/**
 * Whether the queue should hold items back.
 *
 * Deliberately narrow: only an in-flight run blocks. `idle` must not block or a
 * user who skipped setup would find the queue frozen with no way forward, and
 * `error` must not block either — it offers "start anyway", which just pays the
 * cold cost during transcription the way the app does today.
 */
export function isBlocking(): boolean {
  return currentStatus.state === 'running'
}

/** True when credentials exist for a run; setup_modal.py needs all three. */
export function canProvision(): boolean {
  const env = getEnvVars()
  return Boolean(env.MODAL_TOKEN_ID && env.MODAL_TOKEN_SECRET && env.HF_TOKEN)
}

export function startProvision(): void {
  if (currentProcess) return
  if (!canProvision()) {
    // Not an error — the wizard's "set up later" path lands here, and the
    // existing missing-credential notices already cover it.
    setStatus({ state: 'idle', message: '', index: 0, total: 0 })
    return
  }

  setStatus({ state: 'running', message: 'Starting setup...', index: 0, total: 6 })

  const proc = spawn(getPythonPath(), [join(getSourceRoot(), 'setup_modal.py'), '--json'], {
    cwd: getSourceRoot(),
    env: {
      ...process.env,
      ...getEnvVars(),
      // pipeline.ts does not set this and does not need to; here the script's
      // own progress lines would otherwise sit in a buffer for minutes.
      PYTHONUNBUFFERED: '1',
    },
  })
  currentProcess = proc

  let stdoutBuffer = ''
  let stderr = ''
  let lastError = ''

  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) return
    let event: { event?: string; message?: string; index?: number; total?: number } | null = null
    try {
      event = JSON.parse(trimmed)
    } catch {
      return
    }
    if (event?.event === 'step') {
      setStatus({
        state: 'running',
        message: event.message || '',
        index: event.index ?? currentStatus.index,
        total: event.total ?? currentStatus.total,
      })
    } else if (event?.event === 'error') {
      lastError = event.message || ''
    }
  }

  proc.stdout?.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString()
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() || ''
    for (const line of lines) handleLine(line)
  })

  proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

  proc.on('close', (code) => {
    currentProcess = null
    if (stdoutBuffer) handleLine(stdoutBuffer)
    if (code === 0) {
      markProvisioned()
      setStatus({ state: 'ready', message: 'Workspace ready', index: currentStatus.total })
      readyCallback?.()
      return
    }
    setStatus({
      state: 'error',
      message: lastError || stderr.trim().split('\n').pop() || `Setup exited with code ${code}`,
    })
  })

  proc.on('error', (err) => {
    currentProcess = null
    setStatus({ state: 'error', message: err.message })
  })
}

/** Abandon the gate; the queue runs and pays the cold cost during transcription. */
export function skipProvision(): void {
  if (currentProcess) {
    currentProcess.kill()
    currentProcess = null
  }
  setStatus({ state: 'idle', message: '', index: 0, total: 0 })
  readyCallback?.()
}

/**
 * Resume a run that never finished. A workspace with an ID but no provisionedAt
 * means a previous attempt failed or was interrupted.
 */
export function provisionOnStartupIfNeeded(): void {
  const config = getConfig()
  if (!config) return
  if (!config.modal.workspaceId && !config.modal.workspaceName) return
  if (config.modal.provisionedAt) return
  if (!canProvision()) return
  startProvision()
}

export function registerProvisionIpc(): void {
  ipcMain.handle('provision:status', () => currentStatus)
  ipcMain.on('provision:start', () => startProvision())
  ipcMain.on('provision:retry', () => startProvision())
  ipcMain.on('provision:skip', () => skipProvision())
}
