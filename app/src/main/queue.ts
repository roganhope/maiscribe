import { v4 as uuidv4 } from 'uuid'
import { ipcMain, BrowserWindow } from 'electron'
import type { QueueItem, QueueState } from '../shared/types'
import { runPipeline, cancelPipeline } from './pipeline'

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

function processNext(): void {
  if (processing) return
  const next = items.find(i => i.status === 'pending')
  if (!next) return

  processing = true
  next.status = 'processing'
  emitState()

  runPipeline(next.filePath, {
    onProgress: (line) => {
      next.progress = line
      emitState()
    },
    onDone: (outputPath) => {
      next.status = 'done'
      next.outputPath = outputPath
      next.completedAt = Date.now()
      processing = false
      emitState()
      processNext()
    },
    onError: (message) => {
      next.status = 'error'
      next.error = message
      next.completedAt = Date.now()
      processing = false
      emitState()
      processNext()
    },
  })
}

export function addToQueue(filePaths: string[]): void {
  for (const filePath of filePaths) {
    const already = items.some(i => i.filePath === filePath && (i.status === 'pending' || i.status === 'processing'))
    if (already) continue

    items.push({
      id: uuidv4(),
      filePath,
      fileName: filePath.split('/').pop() || filePath,
      status: 'pending',
      progress: null,
      outputPath: null,
      error: null,
      addedAt: Date.now(),
      completedAt: null,
    })
  }
  emitState()
  processNext()
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

export function registerQueueIpc(): void {
  ipcMain.on('queue:add', (_event, filePaths: string[]) => {
    addToQueue(filePaths)
  })

  ipcMain.on('queue:retry', (_event, id: string) => {
    retryItem(id)
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
