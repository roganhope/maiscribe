import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { registerConfigIpc } from './config'
import { registerEnvIpc } from './env'
import { registerQueueIpc } from './queue'
import { registerWatcherIpc, initWatcher } from './watcher'
import { registerHistoryIpc, registerAudioProtocol } from './history'
import { registerPythonEnvIpc, ensurePythonEnv, onStatusChange } from './python-env'
import { registerValidateKeysIpc } from './validate-keys'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 600,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
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
  registerConfigIpc()
  registerEnvIpc()
  registerQueueIpc()
  registerWatcherIpc()
  registerHistoryIpc()
  registerAudioProtocol()
  registerPythonEnvIpc()
  registerValidateKeysIpc()

  ipcMain.on('shell:openPath', (_event, path: string) => {
    shell.showItemInFolder(path)
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
  ensurePythonEnv().catch(() => {})

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
