# Speaker Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a speaker registry that persists recognized voices, lets users assign names via the transcript page or a dedicated Speakers tab, and syncs enrollments to Modal for automatic future recognition.

**Architecture:** Local JSON store in Electron's userData manages speakers. Modal extracts audio clips during transcription. The Electron main process matches new transcripts against the local store via cosine similarity. Enrollment pushes to Modal's voice-repo. UI surfaces speakers on both the per-recording detail page and a global Speakers tab.

**Tech Stack:** Python (Modal, ffmpeg, numpy), TypeScript (Electron main/renderer, React, Tailwind CSS)

---

## File Structure

### New Files
| Path | Responsibility |
|------|---------------|
| `src/app/src/main/speakers.ts` | Speaker store CRUD, local cosine matching, IPC handlers, Modal enrollment spawning |
| `src/app/src/renderer/hooks/useSpeakers.ts` | React hook for speaker state (list, rename, merge, etc.) |
| `src/app/src/renderer/components/SpeakersTab.tsx` | Full Speakers tab with "Needs Attention" and "All Speakers" sections |
| `src/app/src/renderer/components/SpeakerSubmodule.tsx` | Collapsible speaker section on the transcript detail page |
| `src/app/src/renderer/components/SpeakerClipPlayer.tsx` | Small audio player for speaker clips |
| `tests/test_speaker_clips.py` | Tests for clip extraction logic in modal_app.py |

### Modified Files
| Path | Changes |
|------|---------|
| `src/pipeline/modal_app.py` | Add clip extraction to `transcribe_audio`, add `unenroll_speaker` function |
| `src/pipeline/transcribe.py` | Add `--enroll-single` flag, save clip files from base64 in result |
| `src/app/src/shared/types.ts` | Add `Speaker`, `SpeakerAppearance`, `SpeakerClip` types, extend `ElectronAPI` |
| `src/app/src/preload/index.ts` | Expose `speakers` IPC namespace |
| `src/app/src/main/index.ts` | Register `registerSpeakersIpc` |
| `src/app/src/main/queue.ts` | Hook post-transcription speaker matching |
| `src/app/src/main/history.ts` | Compute `speakerMap` when reading recording detail |
| `src/app/src/renderer/App.tsx` | Replace speakers placeholder with `SpeakersTab` |
| `src/app/src/renderer/components/RecordingDetail.tsx` | Add `SpeakerSubmodule` section |
| `src/app/src/renderer/components/TranscriptView.tsx` | Use resolved speaker names + color dots |

---

## Task 1: Types and Shared Interfaces

**Files:**
- Modify: `src/app/src/shared/types.ts`

- [ ] **Step 1: Add speaker types to shared/types.ts**

Add after the existing `PythonEnvStatus` interface:

```typescript
export interface SpeakerAppearance {
  recordingId: string
  originalLabel: string
}

export interface Speaker {
  id: string
  name: string | null
  notes: string | null
  createdAt: string
  enrolledOnModal: boolean
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
```

- [ ] **Step 2: Extend ElectronAPI with speakers namespace**

Add to the `ElectronAPI` interface:

```typescript
speakers: {
  list: () => Promise<Speaker[]>
  get: (id: string) => Promise<Speaker | null>
  rename: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>
  unassign: (id: string) => Promise<void>
  updateNotes: (id: string, notes: string) => Promise<void>
  merge: (keepId: string, removeId: string) => Promise<void>
  delete: (id: string) => Promise<void>
  getClips: (id: string) => Promise<SpeakerClip[]>
}
```

- [ ] **Step 3: Add speakerMap to RecordingDetail type**

In the `RecordingDetail` interface, add to the `transcription` object:

```typescript
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
  speakerMap: Record<string, string> // originalLabel -> speakerId
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/src/shared/types.ts
git commit -m "feat(types): add Speaker, SpeakerClip, and speakers IPC types"
```

---

## Task 2: Modal — Clip Extraction

**Files:**
- Modify: `src/pipeline/modal_app.py`
- Test: `tests/test_speaker_clips.py`

- [ ] **Step 1: Write failing test for clip extraction helper**

Create `tests/test_speaker_clips.py`:

```python
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "pipeline"))


def test_extract_clips_basic(tmp_path):
    """Clip extraction returns base64-encoded wav data for valid segments."""
    from modal_app import _extract_speaker_clips

    # Create a minimal wav file (1 second of silence, 16kHz mono)
    import struct
    sample_rate = 16000
    num_samples = sample_rate * 2  # 2 seconds
    wav_path = tmp_path / "test.wav"
    with open(wav_path, "wb") as f:
        # WAV header
        data_size = num_samples * 2  # 16-bit samples
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(b"\x00" * data_size)

    speaker_turns = {"SPEAKER_00": [(0.0, 1.5), (1.5, 2.0)]}
    clips = _extract_speaker_clips(str(wav_path), speaker_turns, max_clips=2, max_duration=10.0)

    assert "SPEAKER_00" in clips
    assert len(clips["SPEAKER_00"]) >= 1
    clip = clips["SPEAKER_00"][0]
    assert "start" in clip
    assert "end" in clip
    assert "wav_base64" in clip
    assert clip["start"] == 0.0
    assert clip["end"] == 1.5


def test_extract_clips_skips_short_segments(tmp_path):
    """Segments shorter than 1 second are skipped."""
    from modal_app import _extract_speaker_clips
    import struct

    sample_rate = 16000
    num_samples = sample_rate * 2
    wav_path = tmp_path / "test.wav"
    with open(wav_path, "wb") as f:
        data_size = num_samples * 2
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(b"\x00" * data_size)

    # Only short segments (< 1s)
    speaker_turns = {"SPEAKER_00": [(0.0, 0.5), (0.5, 0.9)]}
    clips = _extract_speaker_clips(str(wav_path), speaker_turns, max_clips=3, max_duration=10.0)

    assert clips.get("SPEAKER_00", []) == []


def test_extract_clips_caps_duration(tmp_path):
    """Clips are capped at max_duration seconds."""
    from modal_app import _extract_speaker_clips
    import struct
    import base64
    import wave
    import io

    sample_rate = 16000
    num_samples = sample_rate * 15  # 15 seconds of audio
    wav_path = tmp_path / "test.wav"
    with open(wav_path, "wb") as f:
        data_size = num_samples * 2
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(b"\x00" * data_size)

    # One long segment that exceeds max_duration
    speaker_turns = {"SPEAKER_00": [(0.0, 14.0)]}
    clips = _extract_speaker_clips(str(wav_path), speaker_turns, max_clips=3, max_duration=10.0)

    assert len(clips["SPEAKER_00"]) == 1
    clip = clips["SPEAKER_00"][0]
    # The clip should be capped: end - start <= 10
    assert clip["end"] - clip["start"] <= 10.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/hope/Documents/code/maiscribe && python -m pytest tests/test_speaker_clips.py -v`
Expected: FAIL with `ImportError: cannot import name '_extract_speaker_clips'`

- [ ] **Step 3: Implement `_extract_speaker_clips` in modal_app.py**

Add this function after `_match_speaker`:

```python
def _extract_speaker_clips(
    wav_path: str,
    speaker_turns: dict[str, list[tuple[float, float]]],
    max_clips: int = 3,
    max_duration: float = 10.0,
    min_duration: float = 1.0,
) -> dict[str, list[dict]]:
    import base64
    import subprocess
    import tempfile
    import os

    clips: dict[str, list[dict]] = {}
    for speaker, turns in speaker_turns.items():
        sorted_turns = sorted(turns, key=lambda t: t[1] - t[0], reverse=True)
        speaker_clips = []
        for start, end in sorted_turns:
            duration = end - start
            if duration < min_duration:
                continue
            if duration > max_duration:
                end = start + max_duration
            try:
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    tmp_clip_path = tmp.name
                subprocess.run(
                    [
                        "ffmpeg", "-y", "-i", wav_path,
                        "-ss", str(start), "-to", str(end),
                        "-ar", "16000", "-ac", "1",
                        tmp_clip_path,
                    ],
                    check=True,
                    capture_output=True,
                )
                with open(tmp_clip_path, "rb") as f:
                    wav_bytes = f.read()
                speaker_clips.append({
                    "start": start,
                    "end": min(end, start + max_duration),
                    "wav_base64": base64.b64encode(wav_bytes).decode("ascii"),
                })
                os.unlink(tmp_clip_path)
            except Exception:
                if os.path.exists(tmp_clip_path):
                    os.unlink(tmp_clip_path)
                continue
            if len(speaker_clips) >= max_clips:
                break
        clips[speaker] = speaker_clips
    return clips
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/hope/Documents/code/maiscribe && python -m pytest tests/test_speaker_clips.py -v`
Expected: All 3 tests PASS (requires ffmpeg installed locally)

- [ ] **Step 5: Integrate clip extraction into `transcribe_audio`**

In the `transcribe_audio` function, add after the speaker matching block (after line ~216 where `labeled_segments` is built), before the `return` statement:

```python
        # Extract audio clips per speaker for UI playback
        speaker_clips = _extract_speaker_clips(wav_path, speaker_turns)
```

Then add `"speaker_clips": speaker_clips` to the return dict's `"result"` alongside `"speaker_embeddings"`:

```python
        return {
            "ok": True,
            "result": {
                "text": " ".join(s["text"] for s in segments),
                "segments": labeled_segments,
                "language": "en",
                "duration": info.duration,
                "speaker_embeddings": {
                    speaker_labels[spk]: emb.tolist()
                    for spk, emb in speaker_embeddings.items()
                },
                "speaker_clips": speaker_clips,
            },
        }
```

- [ ] **Step 6: Add `unenroll_speaker` Modal function**

Add after the `list_speakers` function:

```python
@app.function(
    image=image,
    volumes={"/voice-repo": voice_repo_volume},
    timeout=60,
)
def unenroll_speaker(name: str) -> dict:
    repo = _load_voice_repo()
    if name in repo:
        del repo[name]
        _save_voice_repo(repo)
        return {"ok": True, "removed": name}
    return {"ok": False, "error": "not found"}
```

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/modal_app.py tests/test_speaker_clips.py
git commit -m "feat(pipeline): extract speaker audio clips during transcription, add unenroll"
```

---

## Task 3: CLI — Save Clips and Enroll-Single

**Files:**
- Modify: `src/pipeline/transcribe.py`

- [ ] **Step 1: Add `--enroll-single` argument to the parser**

In `main()`, add after the `--list-speakers` argument:

```python
    parser.add_argument(
        "--enroll-single", nargs=2, metavar=("NAME", "EMBEDDING_JSON"),
        help="Enroll a single speaker by name and JSON-encoded embedding (non-interactive)",
    )
    parser.add_argument(
        "--unenroll", type=str, metavar="NAME",
        help="Remove a speaker from the Modal voice repo",
    )
```

- [ ] **Step 2: Add handler for `--enroll-single`**

Add after the `args.enroll` block in `main()`:

```python
    if args.enroll_single is not None:
        name, embedding_json = args.enroll_single
        import json as _json
        embedding = _json.loads(embedding_json)
        from modal_app import app, enroll_speaker
        with app.run():
            result = enroll_speaker.remote(name, embedding)
            if result["ok"]:
                print(f"[enrolled] {name}")
            else:
                print(f"[error] failed to enroll {name}")
                sys.exit(1)
        return

    if args.unenroll is not None:
        from modal_app import app, unenroll_speaker
        with app.run():
            result = unenroll_speaker.remote(args.unenroll)
            if result["ok"]:
                print(f"[unenrolled] {args.unenroll}")
            else:
                print(f"[error] {result.get('error', 'unknown')}")
                sys.exit(1)
        return
```

- [ ] **Step 3: Add clip saving after transcription**

In the `main()` transcription loop, after writing the JSON result and before the audio handling block, add:

```python
                    # Save speaker clips
                    clips_data = result["result"].get("speaker_clips", {})
                    if clips_data:
                        import base64
                        clips_dir = out_folder / "speakers"
                        clips_dir.mkdir(exist_ok=True)
                        for speaker_label, clips in clips_data.items():
                            for idx, clip in enumerate(clips, 1):
                                clip_path = clips_dir / f"{speaker_label}_clip{idx}.wav"
                                clip_path.write_bytes(base64.b64decode(clip["wav_base64"]))
```

- [ ] **Step 4: Remove `speaker_clips` from the saved JSON**

The base64 clip data is large and shouldn't persist in the JSON file. After writing clips, strip it from the result before saving:

Change the JSON write block to:

```python
                    # Strip base64 clip data before saving (clips saved as separate files)
                    result_to_save = {**result["result"]}
                    result_to_save.pop("speaker_clips", None)
                    json_path = out_folder / f"{file_path.stem}.json"
                    json_path.write_text(
                        json.dumps(result_to_save, indent=2, ensure_ascii=False),
                        encoding="utf-8",
                    )
```

Note: this replaces the existing `json_path` write block.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/transcribe.py
git commit -m "feat(cli): add --enroll-single, --unenroll flags, save speaker clips to outbox"
```

---

## Task 4: Electron Main — Speaker Store

**Files:**
- Create: `src/app/src/main/speakers.ts`

- [ ] **Step 1: Create the speaker store module**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { app, ipcMain } from 'electron'
import { randomBytes } from 'crypto'
import { spawn } from 'child_process'
import { getConfig, getSourceRoot } from './config'
import { getEnvVars } from './env'
import { getPythonPath } from './python-env'
import type { Speaker, SpeakerAppearance, SpeakerClip } from '../shared/types'

interface SpeakerStore {
  speakers: Record<string, Speaker>
}

function storePath(): string {
  return join(app.getPath('userData'), 'speakers.json')
}

function readStore(): SpeakerStore {
  const path = storePath()
  if (!existsSync(path)) return { speakers: {} }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function writeStore(store: SpeakerStore): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf-8')
}

function generateId(): string {
  return 'sp_' + randomBytes(6).toString('hex')
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

const SIMILARITY_THRESHOLD = 0.85

export function matchSpeakerEmbedding(embedding: number[]): Speaker | null {
  const store = readStore()
  let bestSpeaker: Speaker | null = null
  let bestScore = 0
  for (const speaker of Object.values(store.speakers)) {
    const score = cosineSimilarity(embedding, speaker.embedding)
    if (score > bestScore) {
      bestScore = score
      bestSpeaker = speaker
    }
  }
  return bestScore >= SIMILARITY_THRESHOLD ? bestSpeaker : null
}

export function registerNewSpeakers(
  recordingId: string,
  embeddings: Record<string, number[]>
): Record<string, string> {
  const store = readStore()
  const labelToSpeakerId: Record<string, string> = {}

  for (const [label, embedding] of Object.entries(embeddings)) {
    const match = matchSpeakerEmbedding(embedding)
    if (match) {
      const alreadyAppeared = match.appearances.some(a => a.recordingId === recordingId)
      if (!alreadyAppeared) {
        match.appearances.push({ recordingId, originalLabel: label })
      }
      labelToSpeakerId[label] = match.id
    } else {
      const id = generateId()
      const newSpeaker: Speaker = {
        id,
        name: null,
        notes: null,
        createdAt: new Date().toISOString(),
        enrolledOnModal: false,
        embedding,
        appearances: [{ recordingId, originalLabel: label }],
      }
      store.speakers[id] = newSpeaker
      labelToSpeakerId[label] = id
    }
  }

  writeStore(store)
  return labelToSpeakerId
}

function runModalCommand(args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const pythonPath = getPythonPath()
    const sourceRoot = getSourceRoot()
    const transcriptPath = join(sourceRoot, 'transcribe.py')
    const envVars = getEnvVars()

    const proc = spawn(pythonPath, [transcriptPath, ...args], {
      cwd: sourceRoot,
      env: { ...process.env, ...envVars },
    })

    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({ ok: false, error: stderr.trim() || stdout.trim() || `exit code ${code}` })
      }
    })
  })
}

export async function renameSpeaker(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const store = readStore()
  const speaker = store.speakers[id]
  if (!speaker) return { ok: false, error: 'speaker not found' }

  const oldName = speaker.name
  speaker.name = name
  writeStore(store)

  // Unenroll old name if it was enrolled
  if (oldName && speaker.enrolledOnModal) {
    await runModalCommand(['--unenroll', oldName])
  }

  // Enroll new name
  const embeddingJson = JSON.stringify(speaker.embedding)
  const result = await runModalCommand(['--enroll-single', name, embeddingJson])
  if (result.ok) {
    speaker.enrolledOnModal = true
    writeStore(store)
  }
  return result
}

export async function unassignSpeaker(id: string): Promise<void> {
  const store = readStore()
  const speaker = store.speakers[id]
  if (!speaker) return

  if (speaker.name && speaker.enrolledOnModal) {
    await runModalCommand(['--unenroll', speaker.name])
  }

  speaker.name = null
  speaker.enrolledOnModal = false
  writeStore(store)
}

export function updateSpeakerNotes(id: string, notes: string): void {
  const store = readStore()
  const speaker = store.speakers[id]
  if (!speaker) return
  speaker.notes = notes
  writeStore(store)
}

export async function mergeSpeakers(keepId: string, removeId: string): Promise<void> {
  const store = readStore()
  const keep = store.speakers[keepId]
  const remove = store.speakers[removeId]
  if (!keep || !remove) return

  // Average embeddings
  keep.embedding = keep.embedding.map((v, i) => (v + remove.embedding[i]) / 2)

  // Merge appearances
  for (const app of remove.appearances) {
    const exists = keep.appearances.some(
      a => a.recordingId === app.recordingId && a.originalLabel === app.originalLabel
    )
    if (!exists) keep.appearances.push(app)
  }

  // Unenroll removed speaker
  if (remove.name && remove.enrolledOnModal) {
    await runModalCommand(['--unenroll', remove.name])
  }

  delete store.speakers[removeId]
  writeStore(store)
}

export async function deleteSpeaker(id: string): Promise<void> {
  const store = readStore()
  const speaker = store.speakers[id]
  if (!speaker) return

  if (speaker.name && speaker.enrolledOnModal) {
    await runModalCommand(['--unenroll', speaker.name])
  }

  delete store.speakers[id]
  writeStore(store)
}

export function getSpeakerClips(id: string): SpeakerClip[] {
  const store = readStore()
  const speaker = store.speakers[id]
  if (!speaker) return []

  const config = getConfig()
  if (!config) return []
  const outboxPath = join(config.basePath, 'outbox')

  const clips: SpeakerClip[] = []
  for (const appearance of speaker.appearances) {
    const clipsDir = join(outboxPath, appearance.recordingId, 'speakers')
    if (!existsSync(clipsDir)) continue
    try {
      const files = readdirSync(clipsDir).filter(
        f => f.startsWith(appearance.originalLabel + '_clip') && f.endsWith('.wav')
      )
      for (const file of files) {
        clips.push({
          speakerId: id,
          recordingId: appearance.recordingId,
          filePath: join(clipsDir, file),
          start: 0,
          end: 0,
        })
      }
    } catch {}
  }
  return clips
}

export function getSpeakerMap(recordingId: string): Record<string, string> {
  const store = readStore()
  const map: Record<string, string> = {}
  for (const speaker of Object.values(store.speakers)) {
    for (const appearance of speaker.appearances) {
      if (appearance.recordingId === recordingId) {
        map[appearance.originalLabel] = speaker.id
      }
    }
  }
  return map
}

export function listSpeakers(): Speaker[] {
  const store = readStore()
  return Object.values(store.speakers)
}

export function getSpeaker(id: string): Speaker | null {
  const store = readStore()
  return store.speakers[id] || null
}

export function registerSpeakersIpc(): void {
  ipcMain.handle('speakers:list', () => listSpeakers())
  ipcMain.handle('speakers:get', (_event, id: string) => getSpeaker(id))
  ipcMain.handle('speakers:rename', (_event, id: string, name: string) => renameSpeaker(id, name))
  ipcMain.handle('speakers:unassign', (_event, id: string) => unassignSpeaker(id))
  ipcMain.handle('speakers:updateNotes', (_event, id: string, notes: string) => {
    updateSpeakerNotes(id, notes)
  })
  ipcMain.handle('speakers:merge', (_event, keepId: string, removeId: string) => mergeSpeakers(keepId, removeId))
  ipcMain.handle('speakers:delete', (_event, id: string) => deleteSpeaker(id))
  ipcMain.handle('speakers:getClips', (_event, id: string) => getSpeakerClips(id))
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/src/main/speakers.ts
git commit -m "feat(main): add speaker store with CRUD, matching, and Modal sync"
```

---

## Task 5: Wire Speaker Store into App Lifecycle

**Files:**
- Modify: `src/app/src/main/index.ts`
- Modify: `src/app/src/main/queue.ts`
- Modify: `src/app/src/main/history.ts`
- Modify: `src/app/src/preload/index.ts`

- [ ] **Step 1: Register speakers IPC in index.ts**

Add import at top:

```typescript
import { registerSpeakersIpc } from './speakers'
```

Add after `registerValidateKeysIpc()`:

```typescript
  registerSpeakersIpc()
```

- [ ] **Step 2: Hook post-transcription speaker registration in queue.ts**

Add import at top:

```typescript
import { registerNewSpeakers } from './speakers'
```

In the `onDone` callback inside `processNext()`, after `next.outputPath = outputPath`, add:

```typescript
      // Register speakers from completed transcription
      if (outputPath) {
        try {
          const { readFileSync, readdirSync } = require('fs')
          const { join } = require('path')
          const files = readdirSync(outputPath)
          const jsonFile = files.find((f: string) => f.endsWith('.json') && f !== 'summary.json')
          if (jsonFile) {
            const data = JSON.parse(readFileSync(join(outputPath, jsonFile), 'utf-8'))
            if (data.speaker_embeddings) {
              const recordingId = outputPath.split('/').pop() || ''
              registerNewSpeakers(recordingId, data.speaker_embeddings)
            }
          }
        } catch {}
      }
```

- [ ] **Step 3: Add speakerMap to history.ts getRecording**

Add import at top:

```typescript
import { getSpeakerMap } from './speakers'
```

In the `getRecording` function, change the `transcription` return value to include speakerMap:

```typescript
    transcription: transcription
      ? {
          text: transcription.text || '',
          segments: transcription.segments || [],
          language: transcription.language || 'en',
          duration: transcription.duration || 0,
          speakerMap: getSpeakerMap(folderName),
        }
      : { text: '', segments: [], language: 'en', duration: 0, speakerMap: {} },
```

- [ ] **Step 4: Expose speakers IPC in preload**

Add to the `api` object in `src/app/src/preload/index.ts`:

```typescript
  speakers: {
    list: () => ipcRenderer.invoke('speakers:list'),
    get: (id) => ipcRenderer.invoke('speakers:get', id),
    rename: (id, name) => ipcRenderer.invoke('speakers:rename', id, name),
    unassign: (id) => ipcRenderer.invoke('speakers:unassign', id),
    updateNotes: (id, notes) => ipcRenderer.invoke('speakers:updateNotes', id, notes),
    merge: (keepId, removeId) => ipcRenderer.invoke('speakers:merge', keepId, removeId),
    delete: (id) => ipcRenderer.invoke('speakers:delete', id),
    getClips: (id) => ipcRenderer.invoke('speakers:getClips', id),
  },
```

- [ ] **Step 5: Commit**

```bash
git add src/app/src/main/index.ts src/app/src/main/queue.ts src/app/src/main/history.ts src/app/src/preload/index.ts
git commit -m "feat(main): wire speaker store into app lifecycle, preload, and history"
```

---

## Task 6: React Hook — useSpeakers

**Files:**
- Create: `src/app/src/renderer/hooks/useSpeakers.ts`

- [ ] **Step 1: Create the useSpeakers hook**

```typescript
import { useState, useEffect, useCallback } from 'react'
import type { Speaker, SpeakerClip } from '../../shared/types'

export function useSpeakers() {
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const list = await window.api.speakers.list()
    setSpeakers(list)
    setLoading(false)
    return list
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const rename = useCallback(async (id: string, name: string) => {
    const result = await window.api.speakers.rename(id, name)
    if (result.ok) {
      setSpeakers(prev => prev.map(s => s.id === id ? { ...s, name } : s))
    }
    return result
  }, [])

  const unassign = useCallback(async (id: string) => {
    await window.api.speakers.unassign(id)
    setSpeakers(prev => prev.map(s => s.id === id ? { ...s, name: null, enrolledOnModal: false } : s))
  }, [])

  const updateNotes = useCallback(async (id: string, notes: string) => {
    await window.api.speakers.updateNotes(id, notes)
    setSpeakers(prev => prev.map(s => s.id === id ? { ...s, notes } : s))
  }, [])

  const merge = useCallback(async (keepId: string, removeId: string) => {
    await window.api.speakers.merge(keepId, removeId)
    await refresh()
  }, [refresh])

  const deleteSpeaker = useCallback(async (id: string) => {
    await window.api.speakers.delete(id)
    setSpeakers(prev => prev.filter(s => s.id !== id))
  }, [])

  const getClips = useCallback(async (id: string): Promise<SpeakerClip[]> => {
    return window.api.speakers.getClips(id)
  }, [])

  return {
    speakers,
    loading,
    refresh,
    rename,
    unassign,
    updateNotes,
    merge,
    deleteSpeaker,
    getClips,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/src/renderer/hooks/useSpeakers.ts
git commit -m "feat(renderer): add useSpeakers hook"
```

---

## Task 7: Speaker Clip Player Component

**Files:**
- Create: `src/app/src/renderer/components/SpeakerClipPlayer.tsx`

- [ ] **Step 1: Create the clip player component**

```tsx
import { useState, useRef } from 'react'
import type { SpeakerClip } from '../../shared/types'

interface Props {
  clips: SpeakerClip[]
}

export function SpeakerClipPlayer({ clips }: Props) {
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function handlePlay(clip: SpeakerClip) {
    if (playing === clip.filePath) {
      audioRef.current?.pause()
      setPlaying(null)
      return
    }
    if (audioRef.current) {
      audioRef.current.pause()
    }
    const audio = new Audio(`local-audio://${encodeURIComponent(clip.filePath)}`)
    audio.onended = () => setPlaying(null)
    audio.play()
    audioRef.current = audio
    setPlaying(clip.filePath)
  }

  if (clips.length === 0) return null

  return (
    <div className="flex gap-1">
      {clips.map((clip, i) => (
        <button
          key={clip.filePath}
          onClick={() => handlePlay(clip)}
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs transition-colors ${
            playing === clip.filePath
              ? 'bg-accent-400 text-gray-900'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
          title={`Play clip ${i + 1}`}
        >
          {playing === clip.filePath ? '■' : '▶'}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/src/renderer/components/SpeakerClipPlayer.tsx
git commit -m "feat(renderer): add SpeakerClipPlayer component"
```

---

## Task 8: Speaker Submodule on Transcript Page

**Files:**
- Create: `src/app/src/renderer/components/SpeakerSubmodule.tsx`
- Modify: `src/app/src/renderer/components/RecordingDetail.tsx`

- [ ] **Step 1: Create the SpeakerSubmodule component**

```tsx
import { useState, useEffect } from 'react'
import type { Speaker, SpeakerClip } from '../../shared/types'
import { SpeakerClipPlayer } from './SpeakerClipPlayer'

interface Props {
  speakerMap: Record<string, string>  // originalLabel -> speakerId
  onSpeakerRenamed: () => void
}

const SPEAKER_COLORS = [
  'bg-blue-400', 'bg-green-400', 'bg-yellow-400', 'bg-purple-400',
  'bg-pink-400', 'bg-orange-400', 'bg-teal-400', 'bg-red-400',
]

export function speakerColor(index: number): string {
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length]
}

export function SpeakerSubmodule({ speakerMap, onSpeakerRenamed }: Props) {
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [clips, setClips] = useState<Record<string, SpeakerClip[]>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [syncing, setSyncing] = useState<string | null>(null)

  const speakerIds = Object.values(speakerMap)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    async function load() {
      const loaded: Speaker[] = []
      const loadedClips: Record<string, SpeakerClip[]> = {}
      for (const id of [...new Set(speakerIds)]) {
        const speaker = await window.api.speakers.get(id)
        if (speaker) {
          loaded.push(speaker)
          const c = await window.api.speakers.getClips(id)
          loadedClips[id] = c
        }
      }
      setSpeakers(loaded)
      setClips(loadedClips)
    }
    if (speakerIds.length > 0) load()
  }, [speakerMap])

  async function handleRename(id: string) {
    const trimmed = nameInput.trim()
    if (!trimmed) {
      setEditingId(null)
      return
    }
    setSyncing(id)
    const result = await window.api.speakers.rename(id, trimmed)
    setSpeakers(prev => prev.map(s => s.id === id ? { ...s, name: trimmed } : s))
    setSyncing(null)
    setEditingId(null)
    onSpeakerRenamed()
  }

  async function handleUnassign(id: string) {
    setSyncing(id)
    await window.api.speakers.unassign(id)
    setSpeakers(prev => prev.map(s => s.id === id ? { ...s, name: null, enrolledOnModal: false } : s))
    setSyncing(null)
    onSpeakerRenamed()
  }

  const hasUnnamed = speakers.some(s => !s.name)

  useEffect(() => {
    setExpanded(hasUnnamed)
  }, [hasUnnamed])

  if (speakers.length === 0) return null

  return (
    <section>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-300"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        Speakers
        {hasUnnamed && (
          <span className="text-xs font-normal normal-case text-yellow-400 ml-2">
            {speakers.filter(s => !s.name).length} unnamed
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2">
          {speakers.map((speaker, idx) => (
            <div key={speaker.id} className="flex items-center gap-3 py-1">
              <span className={`w-2.5 h-2.5 rounded-full ${speakerColor(idx)}`} />

              {editingId === speaker.id ? (
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={() => handleRename(speaker.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(speaker.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  autoFocus
                  placeholder="Enter name..."
                  className="text-sm bg-transparent border border-gray-600 rounded px-2 py-0.5 text-gray-100 focus:border-accent-400 outline-none w-40"
                />
              ) : (
                <button
                  onClick={() => {
                    setEditingId(speaker.id)
                    setNameInput(speaker.name || '')
                  }}
                  className={`text-sm ${speaker.name ? 'text-gray-200' : 'text-gray-500 italic'} hover:text-accent-400`}
                >
                  {speaker.name || 'Unknown Speaker'}
                </button>
              )}

              <SpeakerClipPlayer clips={clips[speaker.id] || []} />

              {syncing === speaker.id && (
                <span className="text-xs text-gray-500">syncing...</span>
              )}

              {speaker.name && editingId !== speaker.id && (
                <button
                  onClick={() => handleUnassign(speaker.id)}
                  className="text-xs text-gray-500 hover:text-red-400 ml-auto"
                >
                  unassign
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Add SpeakerSubmodule to RecordingDetail**

In `src/app/src/renderer/components/RecordingDetail.tsx`:

Add import:

```typescript
import { SpeakerSubmodule } from './SpeakerSubmodule'
```

Add after the `AudioPlayer` section (after the `{recording.audioFilePath && ...}` block) and before the summary section:

```tsx
      {Object.keys(recording.transcription.speakerMap).length > 0 && (
        <SpeakerSubmodule
          speakerMap={recording.transcription.speakerMap}
          onSpeakerRenamed={() => {
            // Refresh detail to pick up new labels
            window.api.history.get(recording.folderPath).then(() => {})
          }}
        />
      )}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/src/renderer/components/SpeakerSubmodule.tsx src/app/src/renderer/components/RecordingDetail.tsx
git commit -m "feat(renderer): add speaker submodule to recording detail page"
```

---

## Task 9: Update TranscriptView with Speaker Colors

**Files:**
- Modify: `src/app/src/renderer/components/TranscriptView.tsx`

- [ ] **Step 1: Add color dots and resolved names to TranscriptView**

Replace the full file:

```tsx
import { speakerColor } from './SpeakerSubmodule'

interface Segment {
  start: number
  end: number
  text: string
  speaker: string
}

interface Props {
  segments: Segment[]
  speakerMap?: Record<string, string>
  speakerNames?: Record<string, string | null>
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function TranscriptView({ segments, speakerMap, speakerNames }: Props) {
  if (segments.length === 0) {
    return <p className="text-sm text-gray-500">No transcript available.</p>
  }

  // Build ordered list of unique speakers for consistent color assignment
  const speakerOrder: string[] = []
  for (const seg of segments) {
    if (!speakerOrder.includes(seg.speaker)) {
      speakerOrder.push(seg.speaker)
    }
  }

  function resolvedName(label: string): string {
    if (speakerMap && speakerNames) {
      const speakerId = speakerMap[label]
      if (speakerId && speakerNames[speakerId]) {
        return speakerNames[speakerId]!
      }
    }
    return label
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
            <span className={`w-2 h-2 rounded-full inline-block ${speakerColor(speakerOrder.indexOf(block.speaker))}`} />
            <span className="text-xs font-medium text-accent-400">{resolvedName(block.speaker)}</span>
            <span className="text-xs text-gray-500">{formatTimestamp(block.start)}</span>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">{block.text}</p>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Update RecordingDetail to pass speakerMap and names to TranscriptView**

In `RecordingDetail.tsx`, add state for speaker names and load them:

Add after existing imports:

```typescript
import type { Speaker } from '../../shared/types'
```

Add inside the component, after the existing `useEffect`:

```typescript
  const [speakerNames, setSpeakerNames] = useState<Record<string, string | null>>({})

  useEffect(() => {
    async function loadNames() {
      const names: Record<string, string | null> = {}
      for (const speakerId of Object.values(recording.transcription.speakerMap)) {
        const speaker = await window.api.speakers.get(speakerId)
        if (speaker) names[speakerId] = speaker.name
      }
      setSpeakerNames(names)
    }
    loadNames()
  }, [recording.id, recording.transcription.speakerMap])
```

Update the `TranscriptView` usage:

```tsx
            <TranscriptView
              segments={recording.transcription.segments}
              speakerMap={recording.transcription.speakerMap}
              speakerNames={speakerNames}
            />
```

- [ ] **Step 3: Commit**

```bash
git add src/app/src/renderer/components/TranscriptView.tsx src/app/src/renderer/components/RecordingDetail.tsx
git commit -m "feat(renderer): add speaker colors and resolved names to transcript view"
```

---

## Task 10: Speakers Tab

**Files:**
- Create: `src/app/src/renderer/components/SpeakersTab.tsx`
- Modify: `src/app/src/renderer/App.tsx`

- [ ] **Step 1: Create the SpeakersTab component**

```tsx
import { useState } from 'react'
import { useSpeakers } from '../hooks/useSpeakers'
import { SpeakerClipPlayer } from './SpeakerClipPlayer'
import type { Speaker, SpeakerClip } from '../../shared/types'

export function SpeakersTab() {
  const { speakers, loading, rename, unassign, updateNotes, merge, deleteSpeaker, getClips, refresh } = useSpeakers()
  const [clips, setClips] = useState<Record<string, SpeakerClip[]>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [notesInput, setNotesInput] = useState('')
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const unnamed = speakers.filter(s => !s.name)
  const named = speakers.filter(s => s.name)

  async function loadClips(id: string) {
    if (!clips[id]) {
      const c = await getClips(id)
      setClips(prev => ({ ...prev, [id]: c }))
    }
  }

  async function handleAssign(id: string) {
    const trimmed = nameInput.trim()
    if (!trimmed) { setEditingId(null); return }
    await rename(id, trimmed)
    setEditingId(null)
  }

  async function handleSaveNotes(id: string) {
    await updateNotes(id, notesInput)
    setEditingNotes(null)
  }

  async function handleMerge(keepId: string, removeId: string) {
    await merge(keepId, removeId)
    setMergeTarget(null)
  }

  async function handleDelete(id: string) {
    await deleteSpeaker(id)
    setConfirmDelete(null)
    setExpandedId(null)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>
  }

  if (speakers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        No speakers yet. Process some recordings to get started.
      </div>
    )
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      {unnamed.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-yellow-400 uppercase tracking-wide mb-4">
            Needs Attention ({unnamed.length})
          </h2>
          <div className="grid gap-4">
            {unnamed.map(speaker => (
              <div key={speaker.id} className="bg-gray-800 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  {editingId === speaker.id ? (
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onBlur={() => handleAssign(speaker.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAssign(speaker.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      autoFocus
                      placeholder="Enter name..."
                      className="text-sm bg-transparent border border-gray-600 rounded px-2 py-1 text-gray-100 focus:border-accent-400 outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingId(speaker.id); setNameInput(''); loadClips(speaker.id) }}
                      className="text-sm text-accent-400 hover:text-accent-300"
                    >
                      Assign name
                    </button>
                  )}
                  <SpeakerClipPlayer clips={clips[speaker.id] || []} />
                </div>
                <div className="text-xs text-gray-500">
                  {speaker.appearances.length} recording{speaker.appearances.length !== 1 ? 's' : ''} &middot; First seen {new Date(speaker.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
          All Speakers ({named.length})
        </h2>
        <div className="flex flex-col gap-2">
          {named.map(speaker => (
            <div key={speaker.id} className="bg-gray-800 rounded-lg">
              <button
                onClick={() => {
                  const newId = expandedId === speaker.id ? null : speaker.id
                  setExpandedId(newId)
                  if (newId) loadClips(newId)
                }}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
              >
                <span className="text-sm font-medium text-gray-200">{speaker.name}</span>
                {speaker.notes && (
                  <span className="text-xs text-gray-500 truncate max-w-48">{speaker.notes}</span>
                )}
                <span className="ml-auto text-xs text-gray-500">
                  {speaker.appearances.length} recording{speaker.appearances.length !== 1 ? 's' : ''}
                </span>
              </button>

              {expandedId === speaker.id && (
                <div className="px-4 pb-4 border-t border-gray-700 pt-3">
                  <div className="flex items-center gap-3 mb-3">
                    <SpeakerClipPlayer clips={clips[speaker.id] || []} />
                    {!speaker.enrolledOnModal && (
                      <span className="text-xs text-yellow-500">not synced to Modal</span>
                    )}
                  </div>

                  {/* Notes */}
                  <div className="mb-3">
                    {editingNotes === speaker.id ? (
                      <div>
                        <textarea
                          value={notesInput}
                          onChange={(e) => setNotesInput(e.target.value)}
                          onBlur={() => handleSaveNotes(speaker.id)}
                          className="w-full text-sm bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 focus:border-accent-400 outline-none resize-none"
                          rows={2}
                          placeholder="Notes about this person..."
                          autoFocus
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingNotes(speaker.id); setNotesInput(speaker.notes || '') }}
                        className="text-xs text-gray-500 hover:text-gray-300"
                      >
                        {speaker.notes || 'Add notes...'}
                      </button>
                    )}
                  </div>

                  {/* Appearances */}
                  <div className="text-xs text-gray-500 mb-3">
                    Recordings: {speaker.appearances.map(a => a.recordingId).join(', ')}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setEditingId(speaker.id); setNameInput(speaker.name || '') }}
                      className="text-xs text-gray-400 hover:text-gray-200"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => unassign(speaker.id)}
                      className="text-xs text-gray-400 hover:text-yellow-400"
                    >
                      Unassign
                    </button>
                    <button
                      onClick={() => setMergeTarget(mergeTarget === speaker.id ? null : speaker.id)}
                      className="text-xs text-gray-400 hover:text-gray-200"
                    >
                      Merge with...
                    </button>
                    {confirmDelete === speaker.id ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleDelete(speaker.id)} className="text-xs text-red-400">Confirm</button>
                        <button onClick={() => setConfirmDelete(null)} className="text-xs text-gray-500">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(speaker.id)}
                        className="text-xs text-gray-400 hover:text-red-400"
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {/* Merge selector */}
                  {mergeTarget === speaker.id && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-400">Merge into:</span>
                      <select
                        onChange={(e) => {
                          if (e.target.value) handleMerge(e.target.value, speaker.id)
                        }}
                        className="text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200"
                        defaultValue=""
                      >
                        <option value="" disabled>Select speaker...</option>
                        {named.filter(s => s.id !== speaker.id).map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Replace placeholder in App.tsx**

Add import:

```typescript
import { SpeakersTab } from './components/SpeakersTab'
```

Replace the speakers tab placeholder:

```tsx
        {tab === 'speakers' && <SpeakersTab />}
```

Remove the old block:

```tsx
        {tab === 'speakers' && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm italic">
            Coming soon
          </div>
        )}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/src/renderer/components/SpeakersTab.tsx src/app/src/renderer/App.tsx
git commit -m "feat(renderer): implement Speakers tab with assign, merge, and management"
```

---

## Task 11: Integration Test — End-to-End Smoke

**Files:**
- No new test files (manual verification)

- [ ] **Step 1: Build and start the dev server**

Run: `cd /Users/hope/Documents/code/maiscribe/src/app && bun run dev`

- [ ] **Step 2: Verify Speakers tab renders**

Navigate to the Speakers tab. Confirm it shows the empty state: "No speakers yet. Process some recordings to get started."

- [ ] **Step 3: Verify pipeline tests pass**

Run: `cd /Users/hope/Documents/code/maiscribe && python -m pytest tests/ -v`
Expected: All tests pass (including new `test_speaker_clips.py`)

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/hope/Documents/code/maiscribe/src/app && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Test with existing recordings**

If there are recordings in the outbox with `speaker_embeddings` in their JSON files, the app should have populated the speaker store on first load. Check the Speakers tab shows any detected speakers. Navigate to a recording detail page and verify the Speakers submodule appears.

---

## Task 12: Final Cleanup and Commit

- [ ] **Step 1: Verify no console errors in the dev tools**

Open Electron dev tools (Cmd+Option+I), check console for errors.

- [ ] **Step 2: Run all checks one final time**

```bash
cd /Users/hope/Documents/code/maiscribe && python -m pytest tests/ -v
cd /Users/hope/Documents/code/maiscribe/src/app && npx tsc --noEmit
```

- [ ] **Step 3: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: cleanup and fix any issues from integration testing"
```
