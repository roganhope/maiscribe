import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ElectronAPI } from '../shared/types'

const api: ElectronAPI = {
  queue: {
    onState: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state as any)
      ipcRenderer.on('queue:state', handler)
      return () => { ipcRenderer.removeListener('queue:state', handler) }
    },
    add: (filePaths) => ipcRenderer.send('queue:add', filePaths),
    start: () => ipcRenderer.send('queue:start'),
    retry: (id) => ipcRenderer.send('queue:retry', id),
    cancel: () => ipcRenderer.send('pipeline:cancel'),
    updateOptions: (id, options) => ipcRenderer.send('queue:updateOptions', id, options),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (config) => ipcRenderer.invoke('config:set', config),
  },
  env: {
    get: () => ipcRenderer.invoke('env:get'),
    set: (vars) => ipcRenderer.invoke('env:set', vars),
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    get: (folderPath) => ipcRenderer.invoke('history:get', folderPath),
    updateTitle: (folderPath, title) => ipcRenderer.invoke('history:updateTitle', folderPath, title),
  },
  watcher: {
    toggle: (enabled) => ipcRenderer.send('watcher:toggle', enabled),
  },
  shell: {
    openPath: (path) => ipcRenderer.send('shell:openPath', path),
    openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
    selectFiles: () => ipcRenderer.invoke('dialog:selectFiles'),
  },
  file: {
    getPath: (file: File) => webUtils.getPathForFile(file),
  },
  pythonEnv: {
    onStatus: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status as any)
      ipcRenderer.on('python-env:status', handler)
      return () => { ipcRenderer.removeListener('python-env:status', handler) }
    },
    getStatus: () => ipcRenderer.invoke('python-env:status'),
    ensure: () => ipcRenderer.invoke('python-env:ensure'),
  },
  validate: {
    modal: (tokenId, tokenSecret) => ipcRenderer.invoke('validate:modal', tokenId, tokenSecret),
    huggingFace: (token) => ipcRenderer.invoke('validate:huggingface', token),
    claude: (apiKey) => ipcRenderer.invoke('validate:claude', apiKey),
  },
}

contextBridge.exposeInMainWorld('api', api)
