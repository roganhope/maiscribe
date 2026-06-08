# History Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a History tab to the Electron app that shows all past recordings in a two-panel layout (sidebar list + detail view) with AI-generated titles, audio playback, and inline title editing.

**Architecture:** The main process gets a new `history.ts` module that reads the outbox folder on demand. A custom `local-audio://` protocol serves audio files. The renderer adds tab navigation and a new History view with sidebar + detail panel components. The Python pipeline is updated to generate titles and handle audio file storage.

**Tech Stack:** Electron (main process), React + Tailwind (renderer), Python (summarize.py, transcribe.py)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `app/src/main/history.ts` | Read outbox folders, serve recording data, update titles |
| `app/src/renderer/components/HistoryView.tsx` | Two-panel layout container |
| `app/src/renderer/components/RecordingSidebar.tsx` | Left sidebar list |
| `app/src/renderer/components/RecordingSidebarItem.tsx` | Individual sidebar item |
| `app/src/renderer/components/RecordingDetail.tsx` | Right detail panel |
| `app/src/renderer/components/AudioPlayer.tsx` | HTML5 audio wrapper |
| `app/src/renderer/components/SummaryView.tsx` | Renders summary sections |
| `app/src/renderer/components/TranscriptView.tsx` | Formatted transcript |
| `app/src/renderer/hooks/useHistory.ts` | History state management |

### Modified Files

| File | Change |
|------|--------|
| `app/src/shared/types.ts` | Add history types, update `AppConfig.pipeline`, update `ElectronAPI` |
| `app/src/main/index.ts` | Register history IPC, register custom protocol |
| `app/src/main/pipeline.ts` | Pass `--audio-handling` flag instead of `--keep` |
| `app/src/preload/index.ts` | Expose history IPC methods |
| `app/src/renderer/App.tsx` | Add tab navigation |
| `app/src/renderer/components/Settings.tsx` | Replace `deleteAfterProcessing` checkbox with audio handling selector |
| `app/src/renderer/components/SetupWizard.tsx` | Replace `deleteAfter` checkbox with audio handling selector |
| `summarize.py` | Add title generation to the Claude prompt |
| `transcribe.py` | Replace `--keep` with `--audio-handling` flag |

---

### Task 1: Update Shared Types

**Files:**
- Modify: `app/src/shared/types.ts`

- [ ] **Step 1: Update AppConfig and add history types**

Replace the full contents of `app/src/shared/types.ts` with:

```typescript
export interface AppConfig {
  version: 1
  basePath: string
  pythonPath: string
  pipeline: {
    audioHandling: 'store' | 'store-and-delete' | 'delete'
    autoWatch: boolean
    autoSummarize: boolean
  }
  obsidian: {
    enabled: boolean
    vaultPath: string | null
    outputFolder: string | null
  }
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
  history: {
    list: () => Promise<RecordingListItem[]>
    get: (folderPath: string) => Promise<RecordingDetail | null>
    updateTitle: (folderPath: string, title: string) => Promise<void>
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
```

- [ ] **Step 2: Commit**

```bash
git add app/src/shared/types.ts
git commit -m "feat: update types for history tab and audio handling config"
```

---

### Task 2: Main Process — History Service

**Files:**
- Create: `app/src/main/history.ts`
- Modify: `app/src/main/index.ts`

- [ ] **Step 1: Create the history service module**

Create `app/src/main/history.ts`:

```typescript
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { join, extname } from 'path'
import { ipcMain, protocol, net } from 'electron'
import { getConfig } from './config'
import type { RecordingListItem, RecordingDetail } from '../shared/types'

const AUDIO_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.flac', '.ogg', '.aac', '.opus', '.mp4']

function getOutboxPath(): string | null {
  const config = getConfig()
  if (!config) return null
  return join(config.basePath, 'outbox')
}

function parseDateFromFolderName(folderName: string): string {
  const parts = folderName.split('_')
  if (parts.length < 2) return ''
  const timePart = parts.pop()!
  const datePart = parts.pop()!
  if (datePart.length !== 8 || timePart.length !== 6) return ''
  const year = datePart.slice(0, 4)
  const month = datePart.slice(4, 6)
  const day = datePart.slice(6, 8)
  const hour = timePart.slice(0, 2)
  const minute = timePart.slice(2, 4)
  const second = timePart.slice(4, 6)
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

function extractTitleFromFolderName(folderName: string): string {
  const parts = folderName.split('_')
  if (parts.length < 3) return folderName
  parts.pop() // remove time
  parts.pop() // remove date
  return parts.join('_')
}

function findAudioFile(folderPath: string): string | null {
  try {
    const files = readdirSync(folderPath)
    for (const file of files) {
      if (AUDIO_EXTENSIONS.includes(extname(file).toLowerCase())) {
        return join(folderPath, file)
      }
    }
  } catch {}
  return null
}

function readJsonSafe(filePath: string): any | null {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

export function listRecordings(): RecordingListItem[] {
  const outboxPath = getOutboxPath()
  if (!outboxPath || !existsSync(outboxPath)) return []

  const entries = readdirSync(outboxPath)
  const recordings: RecordingListItem[] = []

  for (const entry of entries) {
    const folderPath = join(outboxPath, entry)
    try {
      if (!statSync(folderPath).isDirectory()) continue
    } catch {
      continue
    }

    const summary = readJsonSafe(join(folderPath, 'summary.json'))

    const title = summary?.title || extractTitleFromFolderName(entry)
    const date = parseDateFromFolderName(entry)
    const participants = summary?.participants || []
    const durationMinutes = summary?.duration_minutes || 0
    const recordingType = summary?.recording_type || 'unknown'
    const hasAudio = findAudioFile(folderPath) !== null

    recordings.push({
      id: entry,
      folderPath,
      title,
      date,
      participants,
      durationMinutes,
      recordingType,
      hasAudio,
    })
  }

  recordings.sort((a, b) => b.date.localeCompare(a.date))
  return recordings
}

export function getRecording(folderPath: string): RecordingDetail | null {
  if (!existsSync(folderPath)) return null

  const folderName = folderPath.split('/').pop()!
  const summary = readJsonSafe(join(folderPath, 'summary.json'))
  if (!summary) return null

  const files = readdirSync(folderPath)
  const transcriptionFile = files.find(
    f => f.endsWith('.json') && f !== 'summary.json'
  )
  const transcription = transcriptionFile
    ? readJsonSafe(join(folderPath, transcriptionFile))
    : null

  const title = summary.title || extractTitleFromFolderName(folderName)
  const date = parseDateFromFolderName(folderName)
  const audioFilePath = findAudioFile(folderPath)

  return {
    id: folderName,
    folderPath,
    title,
    date,
    participants: summary.participants || [],
    durationMinutes: summary.duration_minutes || 0,
    recordingType: summary.recording_type || 'unknown',
    audioFilePath,
    summary: {
      sections: summary.sections || [],
    },
    transcription: transcription
      ? {
          text: transcription.text || '',
          segments: transcription.segments || [],
          language: transcription.language || 'en',
          duration: transcription.duration || 0,
        }
      : { text: '', segments: [], language: 'en', duration: 0 },
  }
}

export function updateTitle(folderPath: string, title: string): void {
  const summaryPath = join(folderPath, 'summary.json')
  const summary = readJsonSafe(summaryPath)
  if (!summary) return
  summary.title = title
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8')
}

export function registerHistoryIpc(): void {
  ipcMain.handle('history:list', () => listRecordings())
  ipcMain.handle('history:get', (_event, folderPath: string) => getRecording(folderPath))
  ipcMain.handle('history:updateTitle', (_event, folderPath: string, title: string) => {
    updateTitle(folderPath, title)
  })
}

export function registerAudioProtocol(): void {
  protocol.handle('local-audio', (request) => {
    const filePath = decodeURIComponent(request.url.replace('local-audio://', ''))
    return net.fetch(`file://${filePath}`)
  })
}
```

- [ ] **Step 2: Register history IPC and protocol in main index**

In `app/src/main/index.ts`, add the import at the top:

```typescript
import { registerHistoryIpc, registerAudioProtocol } from './history'
```

Inside the `app.whenReady().then(...)` callback, add these two calls before `createWindow()`:

```typescript
  registerHistoryIpc()
  registerAudioProtocol()
```

- [ ] **Step 3: Commit**

```bash
git add app/src/main/history.ts app/src/main/index.ts
git commit -m "feat: add history service with IPC and audio protocol"
```

---

### Task 3: Preload — Expose History API

**Files:**
- Modify: `app/src/preload/index.ts`

- [ ] **Step 1: Add history methods to the preload API**

In `app/src/preload/index.ts`, add the `history` block inside the `api` object, after the `env` block:

```typescript
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    get: (folderPath) => ipcRenderer.invoke('history:get', folderPath),
    updateTitle: (folderPath, title) => ipcRenderer.invoke('history:updateTitle', folderPath, title),
  },
```

- [ ] **Step 2: Commit**

```bash
git add app/src/preload/index.ts
git commit -m "feat: expose history IPC in preload"
```

---

### Task 4: History Hook

**Files:**
- Create: `app/src/renderer/hooks/useHistory.ts`

- [ ] **Step 1: Create the useHistory hook**

Create `app/src/renderer/hooks/useHistory.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import type { RecordingListItem, RecordingDetail } from '../../shared/types'

export function useHistory() {
  const [recordings, setRecordings] = useState<RecordingListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RecordingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const list = await window.api.history.list()
    setRecordings(list)
    setLoading(false)
    if (list.length > 0 && !selectedId) {
      setSelectedId(list[0].id)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    const recording = recordings.find(r => r.id === selectedId)
    if (!recording) return
    setDetailLoading(true)
    window.api.history.get(recording.folderPath).then((d) => {
      setDetail(d)
      setDetailLoading(false)
    })
  }, [selectedId, recordings])

  const selectRecording = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const updateTitle = useCallback(async (folderPath: string, title: string) => {
    await window.api.history.updateTitle(folderPath, title)
    setRecordings(prev =>
      prev.map(r => r.folderPath === folderPath ? { ...r, title } : r)
    )
    setDetail(prev => prev && prev.folderPath === folderPath ? { ...prev, title } : prev)
  }, [])

  return {
    recordings,
    selectedId,
    detail,
    loading,
    detailLoading,
    selectRecording,
    updateTitle,
    refresh,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/renderer/hooks/useHistory.ts
git commit -m "feat: add useHistory hook for history state management"
```

---

### Task 5: Summary and Transcript View Components

**Files:**
- Create: `app/src/renderer/components/SummaryView.tsx`
- Create: `app/src/renderer/components/TranscriptView.tsx`
- Create: `app/src/renderer/components/AudioPlayer.tsx`

- [ ] **Step 1: Create SummaryView**

Create `app/src/renderer/components/SummaryView.tsx`:

```tsx
interface SummarySection {
  type: string
  title: string
  content?: string
  items?: any[]
}

interface Props {
  sections: SummarySection[]
}

export function SummaryView({ sections }: Props) {
  return (
    <div className="flex flex-col gap-6">
      {sections.map((section, i) => (
        <div key={i}>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {section.title}
          </h3>
          {section.type === 'tldr' && (
            <p className="text-gray-200 text-sm leading-relaxed">{section.content}</p>
          )}
          {section.type === 'key_topics' && (
            <ul className="flex flex-col gap-2">
              {section.items?.map((item, j) => (
                <li key={j} className="text-sm text-gray-300">
                  <span className="font-medium text-gray-200">{item.topic}</span>
                  {' — '}
                  {item.detail}
                </li>
              ))}
            </ul>
          )}
          {section.type === 'decisions' && (
            <ul className="flex flex-col gap-1">
              {section.items?.map((item, j) => (
                <li key={j} className="text-sm text-gray-300">• {item}</li>
              ))}
            </ul>
          )}
          {section.type === 'action_items' && (
            <ul className="flex flex-col gap-1">
              {section.items?.map((item, j) => (
                <li key={j} className="text-sm text-gray-300">
                  <span className="font-medium text-gray-200">{item.owner}:</span>{' '}
                  {item.action}
                  {item.deadline && (
                    <span className="text-gray-500"> (by {item.deadline})</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {section.type === 'open_questions' && (
            <ul className="flex flex-col gap-1">
              {section.items?.map((item, j) => (
                <li key={j} className="text-sm text-gray-300">• {item}</li>
              ))}
            </ul>
          )}
          {section.type === 'participants' && (
            <ul className="flex flex-col gap-1">
              {section.items?.map((item, j) => (
                <li key={j} className="text-sm text-gray-300">
                  <span className="font-medium text-gray-200">{item.name}</span>
                  {' — '}
                  {item.context}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create TranscriptView**

Create `app/src/renderer/components/TranscriptView.tsx`:

```tsx
interface Segment {
  start: number
  end: number
  text: string
  speaker: string
}

interface Props {
  segments: Segment[]
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function TranscriptView({ segments }: Props) {
  if (segments.length === 0) {
    return <p className="text-sm text-gray-500">No transcript available.</p>
  }

  const collapsed: Array<{ speaker: string; text: string; start: number }> = []
  for (const seg of segments) {
    if (collapsed.length > 0 && collapsed[collapsed.length - 1].speaker === seg.speaker) {
      collapsed[collapsed.length - 1].text += ' ' + seg.text.trim()
    } else {
      collapsed.push({ speaker: seg.speaker, text: seg.text.trim(), start: seg.start })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {collapsed.map((block, i) => (
        <div key={i}>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-xs font-medium text-accent-400">{block.speaker}</span>
            <span className="text-xs text-gray-500">{formatTimestamp(block.start)}</span>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">{block.text}</p>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Create AudioPlayer**

Create `app/src/renderer/components/AudioPlayer.tsx`:

```tsx
interface Props {
  filePath: string
}

export function AudioPlayer({ filePath }: Props) {
  const src = `local-audio://${encodeURIComponent(filePath)}`

  return (
    <audio controls className="w-full h-10" src={src}>
      Your browser does not support the audio element.
    </audio>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/components/SummaryView.tsx app/src/renderer/components/TranscriptView.tsx app/src/renderer/components/AudioPlayer.tsx
git commit -m "feat: add SummaryView, TranscriptView, and AudioPlayer components"
```

---

### Task 6: Recording Sidebar Components

**Files:**
- Create: `app/src/renderer/components/RecordingSidebarItem.tsx`
- Create: `app/src/renderer/components/RecordingSidebar.tsx`

- [ ] **Step 1: Create RecordingSidebarItem**

Create `app/src/renderer/components/RecordingSidebarItem.tsx`:

```tsx
import type { RecordingListItem } from '../../shared/types'

interface Props {
  recording: RecordingListItem
  selected: boolean
  onClick: () => void
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function RecordingSidebarItem({ recording, selected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-l-2 transition-colors ${
        selected
          ? 'border-accent-400 bg-gray-700/50'
          : 'border-transparent hover:bg-gray-800/50'
      }`}
    >
      <p className="text-sm text-gray-200 truncate font-medium">{recording.title}</p>
      <p className="text-xs text-gray-500 mt-0.5">{formatDate(recording.date)}</p>
      {recording.participants.length > 0 && (
        <p className="text-xs text-gray-500 mt-0.5 truncate">
          {recording.participants.join(', ')}
        </p>
      )}
    </button>
  )
}
```

- [ ] **Step 2: Create RecordingSidebar**

Create `app/src/renderer/components/RecordingSidebar.tsx`:

```tsx
import type { RecordingListItem } from '../../shared/types'
import { RecordingSidebarItem } from './RecordingSidebarItem'

interface Props {
  recordings: RecordingListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function RecordingSidebar({ recordings, selectedId, onSelect }: Props) {
  if (recordings.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm p-4">
        No recordings yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-y-auto h-full">
      {recordings.map(recording => (
        <RecordingSidebarItem
          key={recording.id}
          recording={recording}
          selected={recording.id === selectedId}
          onClick={() => onSelect(recording.id)}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/renderer/components/RecordingSidebarItem.tsx app/src/renderer/components/RecordingSidebar.tsx
git commit -m "feat: add RecordingSidebar and RecordingSidebarItem components"
```

---

### Task 7: Recording Detail Component

**Files:**
- Create: `app/src/renderer/components/RecordingDetail.tsx`

- [ ] **Step 1: Create RecordingDetail**

Create `app/src/renderer/components/RecordingDetail.tsx`:

```tsx
import { useState, useEffect } from 'react'
import type { RecordingDetail as RecordingDetailType } from '../../shared/types'
import { AudioPlayer } from './AudioPlayer'
import { SummaryView } from './SummaryView'
import { TranscriptView } from './TranscriptView'

interface Props {
  recording: RecordingDetailType
  onUpdateTitle: (folderPath: string, title: string) => void
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function RecordingDetail({ recording, onUpdateTitle }: Props) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(recording.title)

  useEffect(() => {
    setTitleDraft(recording.title)
    setEditingTitle(false)
  }, [recording.id])

  function handleTitleSubmit() {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== recording.title) {
      onUpdateTitle(recording.folderPath, trimmed)
    } else {
      setTitleDraft(recording.title)
    }
    setEditingTitle(false)
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleTitleSubmit()
    if (e.key === 'Escape') {
      setTitleDraft(recording.title)
      setEditingTitle(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto h-full">
      {editingTitle ? (
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={handleTitleSubmit}
          onKeyDown={handleTitleKeyDown}
          autoFocus
          className="text-xl font-bold bg-transparent border border-gray-600 rounded px-2 py-1 text-gray-100 focus:border-accent-400 outline-none"
        />
      ) : (
        <h1
          onClick={() => setEditingTitle(true)}
          className="text-xl font-bold text-gray-100 cursor-pointer hover:text-accent-400 transition-colors"
        >
          {recording.title}
        </h1>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-gray-400">
        <span>{formatDate(recording.date)}</span>
        {recording.durationMinutes > 0 && <span>{recording.durationMinutes} min</span>}
        <span className="capitalize">{recording.recordingType}</span>
        {recording.participants.length > 0 && (
          <span>{recording.participants.join(', ')}</span>
        )}
      </div>

      {recording.audioFilePath && (
        <AudioPlayer filePath={recording.audioFilePath} />
      )}

      {recording.summary.sections.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Summary</h2>
          <SummaryView sections={recording.summary.sections} />
        </section>
      )}

      {recording.transcription.segments.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Transcript</h2>
          <TranscriptView segments={recording.transcription.segments} />
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/renderer/components/RecordingDetail.tsx
git commit -m "feat: add RecordingDetail component with inline title editing"
```

---

### Task 8: History View Container

**Files:**
- Create: `app/src/renderer/components/HistoryView.tsx`

- [ ] **Step 1: Create HistoryView**

Create `app/src/renderer/components/HistoryView.tsx`:

```tsx
import { useHistory } from '../hooks/useHistory'
import { RecordingSidebar } from './RecordingSidebar'
import { RecordingDetail } from './RecordingDetail'

export function HistoryView() {
  const {
    recordings,
    selectedId,
    detail,
    loading,
    detailLoading,
    selectRecording,
    updateTitle,
  } = useHistory()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className="w-72 border-r border-gray-700 flex-shrink-0">
        <RecordingSidebar
          recordings={recordings}
          selectedId={selectedId}
          onSelect={selectRecording}
        />
      </div>
      <div className="flex-1 min-w-0">
        {detailLoading && (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading...
          </div>
        )}
        {!detailLoading && detail && (
          <RecordingDetail recording={detail} onUpdateTitle={updateTitle} />
        )}
        {!detailLoading && !detail && recordings.length > 0 && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Select a recording
          </div>
        )}
        {!detailLoading && recordings.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No recordings yet.
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/renderer/components/HistoryView.tsx
git commit -m "feat: add HistoryView two-panel container"
```

---

### Task 9: Tab Navigation in App.tsx

**Files:**
- Modify: `app/src/renderer/App.tsx`

- [ ] **Step 1: Rewrite App.tsx with tab navigation**

Replace the full contents of `app/src/renderer/App.tsx`:

```tsx
import { useState } from 'react'
import { useConfig } from './hooks/useConfig'
import { Dashboard } from './components/Dashboard'
import { SetupWizard } from './components/SetupWizard'
import { Settings } from './components/Settings'
import { HistoryView } from './components/HistoryView'

type Tab = 'process' | 'history'
type View = 'main' | 'settings'

export default function App() {
  const { config, saveConfig, loading } = useConfig()
  const [tab, setTab] = useState<Tab>('process')
  const [view, setView] = useState<View>('main')
  const [wizardDone, setWizardDone] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500">
        Loading...
      </div>
    )
  }

  if (!config && !wizardDone) {
    return (
      <SetupWizard
        onComplete={(newConfig) => {
          saveConfig(newConfig)
          setWizardDone(true)
        }}
      />
    )
  }

  if (view === 'settings') {
    return <Settings onBack={() => setView('main')} />
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center border-b border-gray-700 px-6 pt-2 drag-region">
        <nav className="flex gap-6 no-drag">
          <button
            onClick={() => setTab('process')}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'process'
                ? 'border-accent-400 text-accent-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Process
          </button>
          <button
            onClick={() => setTab('history')}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'history'
                ? 'border-accent-400 text-accent-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            History
          </button>
        </nav>
        <div className="flex-1" />
        <button
          onClick={() => setView('settings')}
          className="text-xs text-gray-500 hover:text-gray-300 no-drag pb-2"
        >
          Settings
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'process' && <Dashboard />}
        {tab === 'history' && <HistoryView />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add drag-region CSS to globals.css**

Append to `app/src/renderer/styles/globals.css`:

```css
.drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/renderer/App.tsx app/src/renderer/styles/globals.css
git commit -m "feat: add tab navigation between Process and History views"
```

---

### Task 10: Update Pipeline — Audio Handling Flag

**Files:**
- Modify: `app/src/main/pipeline.ts`
- Modify: `transcribe.py`

- [ ] **Step 1: Update pipeline.ts to pass --audio-handling**

In `app/src/main/pipeline.ts`, replace the section that handles `deleteAfterProcessing`:

Find this block:
```typescript
  if (config?.pipeline.deleteAfterProcessing === false) {
    args.push('--keep')
  }
```

Replace with:
```typescript
  const audioHandling = config?.pipeline.audioHandling || 'delete'
  args.push('--audio-handling', audioHandling)
```

- [ ] **Step 2: Update transcribe.py to use --audio-handling**

In `transcribe.py`, replace the `--keep` argument definition:

Find:
```python
    parser.add_argument(
        "--keep", action="store_true",
        help="Keep the original audio file after processing (don't delete)",
    )
```

Replace with:
```python
    parser.add_argument(
        "--audio-handling", choices=["store", "store-and-delete", "delete"],
        default="delete",
        help="What to do with the audio file after processing: store (copy to outbox), store-and-delete (move to outbox), delete (remove)",
    )
```

Then in the processing loop, find:
```python
                    shutil.copy2(file_path, out_folder / file_path.name)
                    if not args.keep:
                        file_path.unlink()
```

Replace with:
```python
                    if args.audio_handling == 'store':
                        shutil.copy2(file_path, out_folder / file_path.name)
                    elif args.audio_handling == 'store-and-delete':
                        shutil.move(str(file_path), str(out_folder / file_path.name))
                    else:
                        file_path.unlink()
```

- [ ] **Step 3: Commit**

```bash
git add app/src/main/pipeline.ts transcribe.py
git commit -m "feat: replace --keep with --audio-handling flag (store/store-and-delete/delete)"
```

---

### Task 11: Update Settings and SetupWizard

**Files:**
- Modify: `app/src/renderer/components/Settings.tsx`
- Modify: `app/src/renderer/components/SetupWizard.tsx`

- [ ] **Step 1: Update Settings.tsx pipeline section**

In `app/src/renderer/components/Settings.tsx`, replace the Pipeline section (the `<section>` containing `deleteAfterProcessing`):

Find the block starting with:
```tsx
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Pipeline</h2>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={draft.pipeline.deleteAfterProcessing}
```

Replace the entire Pipeline `<section>` with:
```tsx
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Pipeline</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-sm text-gray-400">Audio file handling</label>
            <select
              value={draft.pipeline.audioHandling}
              onChange={(e) => setDraft({ ...draft, pipeline: { ...draft.pipeline, audioHandling: e.target.value as any } })}
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm mt-1 text-gray-200"
            >
              <option value="store">Store in outbox (keep original)</option>
              <option value="store-and-delete">Store in outbox (delete original)</option>
              <option value="delete">Delete after processing</option>
            </select>
          </div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={draft.pipeline.autoWatch}
              onChange={(e) => setDraft({ ...draft, pipeline: { ...draft.pipeline, autoWatch: e.target.checked } })}
              className="accent-accent-500"
            />
            <span className="text-sm">Auto-watch inbox folder</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={draft.pipeline.autoSummarize}
              onChange={(e) => setDraft({ ...draft, pipeline: { ...draft.pipeline, autoSummarize: e.target.checked } })}
              className="accent-accent-500"
            />
            <span className="text-sm">Auto-summarize</span>
          </label>
        </div>
      </section>
```

- [ ] **Step 2: Update SetupWizard.tsx**

In `app/src/renderer/components/SetupWizard.tsx`:

Replace the state variable:
```typescript
  const [deleteAfter, setDeleteAfter] = useState(true)
```
with:
```typescript
  const [audioHandling, setAudioHandling] = useState<'store' | 'store-and-delete' | 'delete'>('store')
```

In the `finish()` function, replace:
```typescript
      pipeline: {
        deleteAfterProcessing: deleteAfter,
        autoWatch,
        autoSummarize,
      },
```
with:
```typescript
      pipeline: {
        audioHandling,
        autoWatch,
        autoSummarize,
      },
```

In the options step UI, replace the `deleteAfter` checkbox:
```tsx
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={deleteAfter}
                  onChange={(e) => setDeleteAfter(e.target.checked)}
                  className="accent-accent-500"
                />
                <span className="text-sm">Delete source file after processing</span>
              </label>
```
with:
```tsx
              <div>
                <label className="text-sm text-gray-400">Audio file handling</label>
                <select
                  value={audioHandling}
                  onChange={(e) => setAudioHandling(e.target.value as any)}
                  className="w-full bg-gray-700 rounded px-3 py-2 text-sm mt-1 text-gray-200"
                >
                  <option value="store">Store in outbox (keep original)</option>
                  <option value="store-and-delete">Store in outbox (delete original)</option>
                  <option value="delete">Delete after processing</option>
                </select>
              </div>
```

- [ ] **Step 3: Commit**

```bash
git add app/src/renderer/components/Settings.tsx app/src/renderer/components/SetupWizard.tsx
git commit -m "feat: update Settings and SetupWizard for audio handling selector"
```

---

### Task 12: Title Generation in summarize.py

**Files:**
- Modify: `summarize.py`

- [ ] **Step 1: Add title to the summarization prompt and output**

In `summarize.py`, update the `SYSTEM_PROMPT` string. At the beginning of the JSON structure description, add a `title` field:

Find:
```python
Analyze the transcript and return a JSON object with this structure:
{
  "recording_type": "meeting" or "solo",
  "participants": ["list of speaker names/labels"],
  "duration_minutes": <integer>,
  "sections": [...]
}
```

Replace with:
```python
Analyze the transcript and return a JSON object with this structure:
{
  "title": "Short descriptive title (under 10 words)",
  "recording_type": "meeting" or "solo",
  "participants": ["list of speaker names/labels"],
  "duration_minutes": <integer>,
  "sections": [...]
}

Rules for title:
- Under 10 words, capturing the main topic or purpose
- For meetings: reference the topic or key decision
- For solo recordings: reference what the speaker is doing/discussing
```

- [ ] **Step 2: Commit**

```bash
git add summarize.py
git commit -m "feat: add title generation to summarization prompt"
```

---

### Task 13: Handle Existing Config Migration

**Files:**
- Modify: `app/src/main/config.ts`

- [ ] **Step 1: Add config migration for old format**

In `app/src/main/config.ts`, update the `getConfig()` function to handle the old `deleteAfterProcessing` field:

Replace the existing `getConfig` function:
```typescript
export function getConfig(): AppConfig | null {
  const path = configPath()
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf-8')
  return JSON.parse(raw) as AppConfig
}
```

With:
```typescript
export function getConfig(): AppConfig | null {
  const path = configPath()
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf-8')
  const config = JSON.parse(raw)
  if ('deleteAfterProcessing' in (config.pipeline || {})) {
    config.pipeline.audioHandling = config.pipeline.deleteAfterProcessing ? 'delete' : 'store'
    delete config.pipeline.deleteAfterProcessing
    writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
  }
  return config as AppConfig
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/main/config.ts
git commit -m "feat: migrate old deleteAfterProcessing config to audioHandling"
```

---

### Task 14: Build and Manual Test

- [ ] **Step 1: Build the app**

```bash
cd app && npm run build
```

Verify no TypeScript errors.

- [ ] **Step 2: Run in dev mode**

```bash
cd app && npm run dev
```

- [ ] **Step 3: Manual verification checklist**

Verify each of these in the running app:

1. Tab bar shows "Process" and "History" tabs
2. Process tab shows existing Dashboard (queue, drop zone, watcher)
3. History tab shows sidebar with existing outbox recordings
4. Clicking a recording shows detail on the right
5. Title is displayed and clickable to edit
6. Editing title and pressing Enter persists (check summary.json)
7. Audio player appears for recordings that have audio files
8. Audio playback works
9. Summary sections render correctly
10. Transcript renders with speaker labels and timestamps
11. Settings page shows audio handling dropdown instead of checkbox
12. Empty state works if outbox is empty

- [ ] **Step 4: Commit any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
