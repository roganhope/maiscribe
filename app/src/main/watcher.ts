import { watch, FSWatcher } from 'chokidar'
import { join } from 'path'
import { ipcMain } from 'electron'
import { getConfig, getProjectRoot } from './config'
import { addToQueue } from './queue'

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.aac', '.opus', '.mp4'])

let watcher: FSWatcher | null = null

function inboxPath(): string {
  const config = getConfig()
  const base = config?.basePath || getProjectRoot()
  return join(base, 'inbox')
}

function isAudioFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return AUDIO_EXTENSIONS.has(ext)
}

export function startWatcher(): void {
  if (watcher) return

  const path = inboxPath()
  watcher = watch(path, {
    ignoreInitial: false,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
  })

  watcher.on('add', (filePath) => {
    if (isAudioFile(filePath)) {
      addToQueue([filePath])
    }
  })
}

export function stopWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
  }
}

export function registerWatcherIpc(): void {
  ipcMain.on('watcher:toggle', (_event, enabled: boolean) => {
    if (enabled) {
      startWatcher()
    } else {
      stopWatcher()
    }
  })
}

export function initWatcher(): void {
  const config = getConfig()
  if (config?.pipeline.autoWatch) {
    startWatcher()
  }
}
