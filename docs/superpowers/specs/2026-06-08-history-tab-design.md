# History Tab — Design Spec

**Date:** 2026-06-08
**Status:** Approved

---

## Overview

A History tab for the Electron audio transcription app that shows all past recordings in a Claude-like two-panel layout: a sidebar list on the left, detail view on the right. Each recording displays an AI-generated title (user-editable), date/time, participants, summary, transcription, and an audio player if the file exists.

---

## Goals

- Browse all past transcriptions without leaving the app
- Two-panel layout: sidebar list + detail view
- AI-generated titles for quick identification
- Audio playback from the outbox folder
- Inline title editing
- Graceful handling of existing recordings that predate this feature

## Non-Goals

- Search/filtering (can add later if needed)
- Database or persistent index (reads outbox directly)
- Batch backfill of titles for existing recordings
- Audio waveform visualization

---

## Navigation

Top-level tab bar with two tabs: **Process** and **History**.

- **Process** — The current Dashboard (queue, drop zone, watcher toggle) plus the Settings link
- **History** — Two-panel recording browser

The tab bar replaces the current bare header and sits at the top of the window.

---

## History Tab Layout

### Left Sidebar (~280px)

Scrollable flat list of recordings, sorted newest first. Each item shows:

- **Title** — Single line, truncated with ellipsis
- **Date/time** — e.g. "Jun 8, 2026 · 7:09 PM"
- **Participants** — Names or speaker labels, truncated if many

Clicking an item selects it (highlighted) and loads the detail panel. First item is auto-selected on tab load.

Empty state: centered message "No recordings yet." when outbox has no processed recordings.

### Right Detail Panel

Scrollable panel showing (top to bottom):

1. **Title** — Large text, inline-editable. Click to edit, blur or Enter to save back to `summary.json`.
2. **Metadata row** — Date/time, duration, recording type (solo/meeting), participants listed.
3. **Audio player** — HTML5 audio element if an audio file exists in the outbox folder. Hidden entirely if no audio file.
4. **Summary** — Structured sections from `summary.json` rendered with headings (TL;DR, Key Topics, Decisions, Action Items, Open Questions, Participants).
5. **Transcription** — Full transcript from the transcription JSON, formatted with speaker labels and timestamps per segment.

---

## Data Model Changes

### `summary.json` — New `title` field

```json
{
  "title": "Jade Investment Due Diligence Call",
  "recording_type": "meeting",
  "participants": ["Saul Natansohn", "Jared Lucas", "Steve Dorval"],
  "duration_minutes": 43,
  "sections": [...]
}
```

The pipeline generates the title during summarization. User edits overwrite this field directly.

### Config — Replace `deleteAfterProcessing` with `audioHandling`

```typescript
interface AppConfig {
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
```

- `store` — Copy audio file into the outbox folder, leave original in place
- `store-and-delete` — Move audio file into the outbox folder, remove from original location
- `delete` — Delete source after processing, no audio kept

---

## IPC Channels (New)

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `history:list` | renderer → main | Scan outbox, return array of recording metadata |
| `history:get` | renderer → main | Return full data for one recording (summary + transcription) |
| `history:updateTitle` | renderer → main | Write updated title to summary.json |

### `history:list` Response Shape

```typescript
interface RecordingListItem {
  id: string              // folder name (unique identifier)
  folderPath: string      // absolute path to outbox subfolder
  title: string           // from summary.json title field, or folder name as fallback
  date: string            // parsed from folder name timestamp
  participants: string[]  // from summary.json
  durationMinutes: number // from summary.json
  recordingType: string   // "solo" | "meeting"
  hasAudio: boolean       // whether an audio file exists in the folder
}
```

### `history:get` Response Shape

```typescript
interface RecordingDetail {
  id: string
  folderPath: string
  title: string
  date: string
  participants: string[]
  durationMinutes: number
  recordingType: string
  audioFilePath: string | null  // absolute path if audio exists
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
```

---

## Main Process: History Service

A new module `history.ts` in the main process:

- `listRecordings()` — Reads each subfolder in `<basePath>/outbox/`, loads `summary.json` from each, checks for audio files. Returns `RecordingListItem[]` sorted by date descending.
- `getRecording(folderPath)` — Reads `summary.json` and the transcription JSON from the specified folder. Returns `RecordingDetail`.
- `updateTitle(folderPath, title)` — Reads `summary.json`, updates/adds the `title` field, writes back.

### Date Parsing

The outbox folder name format is `<name>_YYYYMMDD_HHMMSS` (e.g. `Saul 1_20260522_150946`). The date is parsed from the last two underscore-separated segments of the folder name.

### Audio File Detection

Checks for files with extensions: `.m4a`, `.mp3`, `.wav`, `.flac`, `.ogg`, `.aac`, `.opus`, `.mp4` in the outbox subfolder. Returns the first match found.

### Audio Serving

Register a custom `local-audio://` protocol in the main process that serves files from the outbox. The renderer uses this protocol for the audio player `src` attribute. This avoids `file://` CORS issues.

---

## Pipeline Changes

### Title Generation

The summarization step (which already calls Claude) generates a short descriptive title for the recording. The prompt asks for a concise title (under 10 words) that captures the main topic or purpose of the recording. The title is written as a top-level field in `summary.json`.

### Audio Handling

Replace the `--keep` flag in `transcribe.py` with a new `--audio-handling` flag:

- `--audio-handling store` — Copy source audio to outbox folder
- `--audio-handling store-and-delete` — Move source audio to outbox folder
- `--audio-handling delete` — Delete source after processing (current default behavior)

The Electron app passes this flag based on the `pipeline.audioHandling` config value.

---

## Renderer Components (New/Modified)

### New Components

- `HistoryView.tsx` — The two-panel layout container
- `RecordingSidebar.tsx` — The left sidebar list
- `RecordingSidebarItem.tsx` — Individual list item
- `RecordingDetail.tsx` — The right detail panel
- `AudioPlayer.tsx` — Wrapper around HTML5 audio element
- `TranscriptView.tsx` — Formatted transcript with speaker labels and timestamps
- `SummaryView.tsx` — Renders structured summary sections

### Modified Components

- `App.tsx` — Add tab navigation, route between Process and History views
- `Settings.tsx` — Replace delete-after toggle with three-way audio handling selector
- `SetupWizard.tsx` — Update pipeline options step for audio handling

### New Hook

- `useHistory.ts` — Manages history list state, selected recording, loading states

---

## Backfill Strategy

No migration needed. Graceful degradation for existing recordings:

- **No `title` field in summary.json** → Use folder name (strip timestamp suffix) as display title
- **No audio file in outbox** → Audio player hidden
- **User edits title** → Writes `title` field into existing summary.json

---

## UI Styling

Follows existing dark mode + pink accent theme:

- Tab bar: subtle border-bottom, active tab has pink underline/text
- Sidebar: dark background, selected item has slightly lighter background with pink left border
- Detail panel: slightly lighter background than sidebar
- Audio player: native HTML5 controls (or minimal custom styling to match dark theme)
- Inline title edit: transparent input that looks like text until focused, subtle border on focus

---

## Testing Plan

- Verify History tab loads and displays existing outbox recordings
- Verify sidebar selection loads correct detail
- Verify title editing saves to summary.json and persists across app restart
- Verify audio player appears only when audio file exists
- Verify audio playback works via custom protocol
- Verify new pipeline runs generate title in summary.json
- Verify audio handling options (store, store-and-delete, delete) work correctly
- Verify empty state when outbox is empty
- Verify graceful handling of malformed/incomplete outbox entries
