// 'leave' transcribes without touching the source file at all. It is the
// default: storing a copy duplicates gigabytes, and deleting destroys the only
// copy, so doing neither is the one choice that cannot lose anything.
export type AudioHandling = 'store' | 'store-and-delete' | 'delete' | 'leave'

export interface AppConfig {
  version: 1
  basePath: string
  pipeline: {
    audioHandling: AudioHandling
    autoWatch: boolean
    autoSummarize: boolean
    minSpeakers: number
  }
  obsidian: {
    enabled: boolean
    vaultPath: string | null
    outputFolder: string | null
  }
  // Which Modal workspace the app last provisioned. The GPU image and the ~3GB
  // of model weights are cached per workspace, so switching workspaces silently
  // invalidates both — this is what makes that detectable.
  modal: ModalWorkspaceConfig
}

export interface ModalWorkspaceConfig {
  // Workspace names are user-editable, so the ID is what identity compares on.
  // It stays optional: `modal token info` does not always print one.
  workspaceId: string | null
  workspaceName: string | null
  provisionedAt: string | null
}

export interface ModalWorkspace {
  name: string
  id?: string
}

export type WorkspaceComparison =
  | { kind: 'first-setup' }
  | { kind: 'same' }
  | { kind: 'renamed'; from: string; to: string }
  | { kind: 'changed'; from: string; to: string; confident: boolean }

export interface ProvisionStatus {
  state: 'idle' | 'running' | 'ready' | 'error'
  message: string
  index: number
  total: number
}

export interface RecordingListItem {
  id: string
  folderPath: string
  title: string
  date: string
  participants: string[]
  durationMinutes: number
  recordingType: string
  hasAudio: boolean
}

export interface RecordingDetail {
  id: string
  folderPath: string
  title: string
  date: string
  participants: string[]
  durationMinutes: number
  recordingType: string
  audioFilePath: string | null
  summary: {
    sections: Array<{
      type: string
      title: string
      content?: string
      items?: any[]
    }>
  }
  transcription: {
    text: string
    segments: Array<{
      start: number
      end: number
      text: string
      speaker: string
    }>
    language: string
    duration: number
    speakerMap: Record<string, string>
  }
}

export interface QueueItemOptions {
  audioHandling: AudioHandling
  summarize: boolean
  minSpeakers: number
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
  options: QueueItemOptions
}

export type QueueState = QueueItem[]

export interface PythonEnvStatus {
  state: 'idle' | 'downloading' | 'extracting' | 'creating-venv' | 'installing' | 'ready' | 'error'
  message: string
}

export interface SpeakerAppearance {
  recordingId: string
  originalLabel: string
}

export interface Speaker {
  id: string
  name: string | null
  notes: string | null
  createdAt: string
  embedding: number[]
  appearances: SpeakerAppearance[]
}

export interface SpeakerClip {
  speakerId: string
  recordingId: string
  filePath: string
  start: number
  end: number
}

export interface ElectronAPI {
  queue: {
    onState: (callback: (state: QueueState) => void) => () => void
    getState: () => Promise<QueueState>
    clearDone: () => void
    add: (filePaths: string[]) => void
    start: () => void
    startItem: (id: string) => void
    retry: (id: string) => void
    remove: (id: string) => void
    cancel: () => void
    updateOptions: (id: string, options: Partial<QueueItemOptions>) => void
  }
  config: {
    get: () => Promise<AppConfig | null>
    set: (config: AppConfig) => Promise<void>
    defaultBasePath: () => Promise<string>
    setModalWorkspace: (workspace: ModalWorkspace) => Promise<void>
  }
  env: {
    get: () => Promise<Record<string, string>>
    set: (vars: Record<string, string>) => Promise<void>
  }
  history: {
    list: () => Promise<RecordingListItem[]>
    get: (folderPath: string) => Promise<RecordingDetail | null>
    updateTitle: (folderPath: string, title: string) => Promise<void>
    delete: (folderPath: string) => Promise<void>
  }
  watcher: {
    toggle: (enabled: boolean) => void
  }
  shell: {
    openPath: (path: string) => void
    openExternal: (url: string) => void
  }
  dialog: {
    selectDirectory: () => Promise<string | null>
    selectFiles: () => Promise<string[]>
  }
  file: {
    getPath: (file: File) => string
  }
  pythonEnv: {
    onStatus: (callback: (status: PythonEnvStatus) => void) => () => void
    getStatus: () => Promise<PythonEnvStatus>
    ensure: () => Promise<{ ok: boolean; error?: string }>
  }
  validate: {
    modal: (tokenId: string, tokenSecret: string) => Promise<{ ok: boolean; error?: string; workspace?: ModalWorkspace }>
    huggingFace: (token: string) => Promise<{ ok: boolean; error?: string }>
    claude: (apiKey: string) => Promise<{ ok: boolean; error?: string }>
    syncModalSecret: (hfToken: string, modalTokenId: string, modalTokenSecret: string) => Promise<{ ok: boolean; error?: string }>
    syncModalSecretFromEnv: () => Promise<{ ok: boolean; error?: string }>
  }
  provision: {
    onStatus: (callback: (status: ProvisionStatus) => void) => () => void
    getStatus: () => Promise<ProvisionStatus>
    start: () => void
    retry: () => void
    // Abandons the gate and lets the queue run against an unprovisioned
    // workspace — the cold cost then lands during transcription, as it does today.
    skip: () => void
  }
  speakers: {
    list: () => Promise<Speaker[]>
    get: (id: string) => Promise<Speaker | null>
    rename: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>
    unassign: (id: string) => Promise<void>
    updateNotes: (id: string, notes: string) => Promise<void>
    merge: (keepId: string, removeId: string) => Promise<void>
    delete: (id: string) => Promise<void>
    getClips: (id: string, recordingId?: string) => Promise<SpeakerClip[]>
    getQuotes: (id: string) => Promise<string[]>
  }
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
