# Electron Pipeline App — Design Spec

**Date:** 2026-06-08
**Status:** Approved

---

## Overview

A desktop Electron app that wraps the existing Python audio transcription pipeline in a GUI. Users drop audio files into the app (or a watched folder), and the app orchestrates transcription + summarization via the existing `transcribe.py` CLI. Features a first-run setup wizard, persistent settings, processing queue with status display, and folder watching.

---

## Goals

- Desktop GUI for the existing pipeline — no terminal knowledge required after initial setup
- Folder watch + drag-and-drop for hands-free processing
- Visual queue showing file status (pending/processing/done/error)
- First-run wizard to configure folders, API keys, and pipeline options
- Installable via `bun install` in the `app/` subfolder
- Stubbed Obsidian integration for the next build phase

## Non-Goals

- Rewriting the Python pipeline in TypeScript
- Packaging as a distributable .app/.dmg (future)
- Obsidian integration implementation (stubbed only)
- Multi-user or cloud deployment

---

## Architecture

```
app/ (Electron)
    main process
        ├── watcher (chokidar) → watches inbox/
        ├── queue manager → sequential processing
        └── pipeline runner → spawns python transcribe.py
    renderer (React + Tailwind)
        ├── Dashboard (queue list, drop zone, status)
        ├── SetupWizard (first-run modal)
        └── Settings (persistent config page)

    ↕ IPC channels ↕

existing Python pipeline (unchanged)
    transcribe.py → modal_app.py (GPU) → summarize.py (Claude)
```

The Electron app shells out to the Python pipeline as a child process, streaming stdout for real-time status updates.

---

## File Structure

```
audio-transcription/
├── app/                              # Electron app
│   ├── package.json                  # bun install target
│   ├── main/                         # Electron main process
│   │   ├── index.ts                  # App lifecycle, window creation
│   │   ├── watcher.ts                # Chokidar folder watcher
│   │   ├── queue.ts                  # Processing queue manager
│   │   ├── pipeline.ts               # Spawns python transcribe.py
│   │   └── config.ts                 # Read/write config JSON
│   ├── renderer/                     # React frontend
│   │   ├── index.html
│   │   ├── main.tsx                  # React entry
│   │   ├── App.tsx                   # Router between views
│   │   ├── components/
│   │   │   ├── Dashboard.tsx         # File list, status, drag-drop zone
│   │   │   ├── SetupWizard.tsx       # First-run modal
│   │   │   ├── Settings.tsx          # Persistent settings page
│   │   │   ├── QueueItem.tsx         # Single file status row
│   │   │   └── DropZone.tsx          # Drag-and-drop area
│   │   └── styles/
│   │       └── globals.css           # Tailwind imports
│   ├── shared/
│   │   └── types.ts                  # Shared types (config, queue item, etc.)
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── vite.config.ts                # Vite for renderer bundling
├── modal_app.py                      # (existing, unchanged)
├── transcribe.py                     # (existing, unchanged)
├── summarize.py                      # (existing, unchanged)
└── ...
```

---

## Config & Data Model

### Config file

Location: `<basePath>/config.json`

```typescript
interface AppConfig {
  version: 1;
  basePath: string;              // where inbox/outbox live
  pythonPath: string;            // path to python binary
  pipeline: {
    deleteAfterProcessing: boolean;
    autoWatch: boolean;
    autoSummarize: boolean;
  };
  obsidian: {
    enabled: boolean;
    vaultPath: string | null;
    outputFolder: string | null;
  };
}
```

API keys live in `.env` at the project root (never in config.json). The wizard and settings page write to `.env` directly.

### Queue item

```typescript
interface QueueItem {
  id: string;
  filePath: string;
  fileName: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress: string | null;
  outputPath: string | null;
  error: string | null;
  addedAt: number;
  completedAt: number | null;
}
```

---

## Main Process

### Watcher (`watcher.ts`)

- Chokidar watches `<basePath>/inbox/` for new audio files
- Filters: `.mp3`, `.m4a`, `.wav`, `.flac`, `.ogg`, `.aac`, `.opus`, `.mp4`
- New file detected → adds to queue
- Togglable via IPC (respects `autoWatch` config)
- Ignores non-audio files (e.g., `errors.txt`)

### Queue (`queue.ts`)

- In-memory array of `QueueItem`s
- Sequential processing (one at a time)
- State transitions: pending → processing → done | error
- Emits full state to renderer on every change
- Supports retry (re-queues failed item)

### Pipeline (`pipeline.ts`)

- Spawns: `python transcribe.py <absolute-path-to-file>`
- Working directory: project root (where transcribe.py lives)
- Environment: system env + `.env` vars injected
- Streams stdout line-by-line
- Parses prefixes: `[done]`, `[error]`, `[summary]`
- Timeout: 30 minutes (kills process, marks error)
- On success + `deleteAfterProcessing`: removes source file if it was copied into inbox from outside

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `queue:state` | main → renderer | Full queue state on change |
| `queue:add` | renderer → main | Add file(s) manually |
| `queue:retry` | renderer → main | Retry a failed item |
| `config:get` | renderer → main | Request current config |
| `config:set` | renderer → main | Update config |
| `watcher:toggle` | renderer → main | Enable/disable folder watch |
| `pipeline:cancel` | renderer → main | Cancel current processing |

---

## Renderer UI

### Visual Style

- Dark mode default (matches macOS)
- Tailwind utility classes
- Pink accent color (`pink-400`/`pink-500`) for highlights, active states, primary buttons, drop zone hover border, wizard progress
- Status colors: gray (pending), blue/pink (processing), green (done), red (error)
- Minimal utility aesthetic

### Dashboard (`Dashboard.tsx`)

- **Drop zone** — large dashed-border area at top, accepts drag-and-drop audio files + "Browse Files" button
- **Queue list** — all items with status badge, progress text, output link (opens Finder), retry button
- **Watcher indicator** — small toggle showing if folder watch is active
- **"Process Now" button** — processes audio files currently in inbox

### Setup Wizard (`SetupWizard.tsx`)

Full-screen modal overlay on first launch (no config.json found).

**Steps:**
1. **Base folder** — pick where inbox/outbox live (defaults to project root)
2. **API keys** — Claude API key (required), Modal token ID + secret (required)
3. **Pipeline options** — delete-after toggle, auto-watch toggle, auto-summarize toggle
4. **Done** — summary of choices, writes config.json + .env

Each step validates before advancing. Final step shows confirmation.

### Settings (`Settings.tsx`)

- Grouped sections: Folders, API Keys, Pipeline, Obsidian
- API key fields: password inputs, masked if set, "Change" to edit
- Save button writes config + .env
- Obsidian section: disabled/grayed with "Coming soon" note

---

## Pipeline Integration

### Python Discovery

- Tries `python3` then `python` on PATH
- User can override in settings
- Validates with `python --version`

### Stdout Parsing

| Prefix | Action |
|--------|--------|
| `[done]` | Mark item complete, extract output path |
| `[error]` | Mark item failed, capture message |
| `[summary]` | Update progress text |
| Other lines | Show as progress text |

### Delete-After-Processing

- The existing `transcribe.py` already unlinks inbox files on success
- The toggle in the app controls behavior for files dragged in from outside inbox: whether to copy (keep original) or move (original removed after success)

### Error Handling

| Scenario | Behavior |
|---|---|
| Python not found | Wizard/settings shows error, blocks processing |
| Missing API keys | Warning banner on dashboard, blocks processing |
| Pipeline timeout (30min) | Kill process, mark error, suggest retry |
| Modal auth failure | Capture stderr, show in error detail |
| File disappeared | Remove from queue with note |
| Process crash | Detect exit code, mark error with stderr |

---

## Installation

```bash
git clone <repo>
cd audio-transcription/app
bun install
bun run dev
```

**Prerequisites:**
- bun (for JS dependencies and dev server)
- Python 3.11+ with project requirements installed (`pip install -r requirements.txt`)
- Modal account + tokens
- Anthropic API key

**package.json scripts:**
- `dev` — launches Electron in dev mode (electron-vite dev)
- `build` — production build (electron-vite build)
- `preview` — preview production build

**Key dependencies:**
- `electron`, `electron-vite` — app shell + build
- `react`, `react-dom` — renderer
- `tailwindcss`, `postcss`, `autoprefixer` — styling
- `chokidar` — folder watching
- `uuid` — queue item IDs

---

## Obsidian Integration (Stubbed)

Config fields exist (`obsidian.enabled`, `vaultPath`, `outputFolder`) but are not wired up. Settings page shows them as disabled with "Coming soon." Wizard skips this step.

**Future behavior (next build):**
- On success, copies `summary.md` to `<vaultPath>/<outputFolder>/<recording-name>.md`
- Adds YAML frontmatter (tags, date, type) for Obsidian metadata
- Links back to full transcript JSON

---

## Testing Plan

- Test pipeline end-to-end with `inbox/Photography.m4a`
- Verify folder watch detects new files
- Verify drag-and-drop adds to queue
- Verify setup wizard writes config.json + .env correctly
- Verify settings page updates config
- Verify delete-after-processing behavior
- Verify error states display correctly (remove API key, drop invalid file)
