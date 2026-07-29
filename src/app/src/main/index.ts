import { app, BrowserWindow, shell, ipcMain, dialog, protocol } from 'electron'
import { join } from 'path'

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-audio', privileges: { stream: true, bypassCSP: true } },
])

app.setName('maiscribe')

import { registerConfigIpc, migrateFromRepoRoot, ensureDataDirs } from './config'
import { registerEnvIpc } from './env'
import { registerQueueIpc } from './queue'
import { registerWatcherIpc, initWatcher } from './watcher'
import { registerHistoryIpc, registerAudioProtocol } from './history'
import { registerPythonEnvIpc, ensurePythonEnv, onStatusChange } from './python-env'
import { registerValidateKeysIpc } from './validate-keys'
import { registerSpeakersIpc } from './speakers'
import {
  registerProvisionIpc,
  onStatusChange as onProvisionStatusChange,
  provisionOnStartupIfNeeded,
} from './provision'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 600,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.setIcon(join(__dirname, '../../resources/icon.png'))
  }
  migrateFromRepoRoot()
  ensureDataDirs()
  registerConfigIpc()
  registerEnvIpc()
  registerQueueIpc()
  registerWatcherIpc()
  registerHistoryIpc()
  registerAudioProtocol()
  registerPythonEnvIpc()
  registerValidateKeysIpc()
  registerSpeakersIpc()
  registerProvisionIpc()

  ipcMain.on('shell:openPath', (_event, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.on('shell:openExternal', (_event, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:selectFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'aac', 'opus', 'mp4'] }],
    })
    return result.canceled ? [] : result.filePaths
  })

  createWindow()
  initWatcher()

  onStatusChange((status) => {
    mainWindow?.webContents.send('python-env:status', status)
  })
  onProvisionStatusChange((status) => {
    mainWindow?.webContents.send('provision:status', status)
  })
  // Needs the venv Python that setup_modal.py runs under, so it waits on the
  // env rather than racing it.
  ensurePythonEnv()
    .then(() => provisionOnStartupIfNeeded())
    .catch(() => {})

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
