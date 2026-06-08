export interface AppConfig {
  version: 1
  basePath: string
  pythonPath: string
  pipeline: {
    deleteAfterProcessing: boolean
    autoWatch: boolean
    autoSummarize: boolean
  }
  obsidian: {
    enabled: boolean
    vaultPath: string | null
    outputFolder: string | null
  }
}

export interface QueueItem {
  id: string
  filePath: string
  fileName: string
  status: 'staged' | 'pending' | 'processing' | 'done' | 'error'
  progress: string | null
  progressPercent: number | null
  outputPath: string | null
  error: string | null
  addedAt: number
  startedAt: number | null
  completedAt: number | null
  estimatedDurationSec: number | null
}

export type QueueState = QueueItem[]

export interface ElectronAPI {
  queue: {
    onState: (callback: (state: QueueState) => void) => () => void
    add: (filePaths: string[]) => void
    start: () => void
    retry: (id: string) => void
    cancel: () => void
  }
  config: {
    get: () => Promise<AppConfig | null>
    set: (config: AppConfig) => Promise<void>
  }
  env: {
    get: () => Promise<Record<string, string>>
    set: (vars: Record<string, string>) => Promise<void>
  }
  watcher: {
    toggle: (enabled: boolean) => void
  }
  shell: {
    openPath: (path: string) => void
  }
  dialog: {
    selectDirectory: () => Promise<string | null>
    selectFiles: () => Promise<string[]>
  }
  file: {
    getPath: (file: File) => string
  }
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
