# Speaker Management System

## Overview

A persistent speaker registry that tracks every voice encountered across transcriptions, lets users assign names and notes, and syncs enrollments to Modal's voice-repo for automatic recognition in future transcriptions.

## Architecture

- **Local speaker store** (`speakers.json` in Electron's userData) — source of truth for the UI. Holds names, notes, embeddings, appearances, and Modal sync state.
- **Modal voice-repo** — remote embedding store used during transcription for auto-matching. The app pushes enrollments here when a user assigns a name.
- **Speaker clips** — short audio excerpts (2-3 per speaker, max 10s each) extracted on Modal during transcription, saved to the outbox folder for playback in the UI.

## Data Model

### Speaker Store (`{userData}/speakers.json`)

```json
{
  "speakers": {
    "sp_a1b2c3": {
      "id": "sp_a1b2c3",
      "name": "Sarah",
      "notes": "PM on the analytics team",
      "createdAt": "2026-06-10T14:00:00Z",
      "enrolledOnModal": true,
      "embedding": [0.12, -0.34, ...],
      "appearances": [
        { "recordingId": "meeting_20260610_140000", "originalLabel": "SPEAKER_00" }
      ]
    }
  }
}
```

Fields:
- `id` — generated unique ID (`sp_` prefix + random hex)
- `name` — user-assigned name, or `null` if unassigned
- `notes` — freeform user notes about the person, or `null`
- `createdAt` — ISO timestamp of first encounter
- `enrolledOnModal` — whether the embedding has been pushed to Modal's voice-repo under this name
- `embedding` — the speaker's voice embedding vector (from pyannote)
- `appearances` — list of recordings this speaker appeared in, with the original diarization label

### Speaker Clips (filesystem)

Stored per outbox folder at `{outbox_folder}/speakers/{ORIGINAL_LABEL}_clip{N}.wav`.

Example: `meeting_20260610_140000/speakers/SPEAKER_00_clip1.wav`

Each clip is mono 16kHz wav, between 1-10 seconds (segments shorter than 1s are skipped), extracted from the longest diarized turns for that speaker.

## Pipeline Changes

### Modal (`modal_app.py`)

The `transcribe_audio` function gains a clip extraction step after diarization:

1. For each speaker, take up to 3 of the longest diarized turns (already sorted for embedding extraction)
2. Extract each as a wav clip using ffmpeg (capped at 10s)
3. Base64-encode and include in the return payload

New field in the result:

```json
"speaker_clips": {
  "SPEAKER_00": [
    { "start": 12.3, "end": 19.8, "wav_base64": "UklGR..." },
    { "start": 45.1, "end": 52.6, "wav_base64": "UklGR..." }
  ]
}
```

### New Modal function: `unenroll_speaker`

```python
@app.function(...)
def unenroll_speaker(name: str) -> dict:
    repo = _load_voice_repo()
    if name in repo:
        del repo[name]
        _save_voice_repo(repo)
        return {"ok": True, "removed": name}
    return {"ok": False, "error": "not found"}
```

### CLI (`transcribe.py`)

New flag `--enroll-single <name> <embedding_json>` for non-interactive enrollment from the Electron app. Takes a name and a JSON-encoded embedding array, calls `enroll_speaker.remote()`.

After transcription, the pipeline runner:
1. Decodes base64 clips from the result
2. Writes them to `{outbox_folder}/speakers/` as wav files
3. This happens before the `[done]` stdout marker

## Electron Main Process

### New module: `src/app/src/main/speakers.ts`

Responsibilities:
- Read/write `speakers.json` in userData
- Local cosine similarity matching (threshold 0.85) of new transcript embeddings against the store
- IPC handler registration
- Spawning pipeline commands for Modal enrollment/unenrollment

### Post-transcription integration

After a transcription completes (in `pipeline.ts` or `queue.ts`):

1. Read `speaker_embeddings` from the result JSON
2. For each speaker embedding, run cosine similarity against all speakers in the local store
3. If match found (>= 0.85): add new appearance to the existing speaker entry
4. If no match: create a new unnamed speaker entry with the embedding and appearance
5. Update the transcript JSON's speaker labels for any locally-matched speakers

### IPC Handlers

Registered as `speakers:*` channels:

- `speakers:list` — returns all speakers
- `speakers:get(id)` — returns a single speaker
- `speakers:rename(id, name)` — sets name, triggers Modal enrollment, returns sync result
- `speakers:unassign(id)` — clears name, unenrolls from Modal, reverts transcript labels to originalLabel
- `speakers:updateNotes(id, notes)` — updates freeform notes
- `speakers:merge(keepId, removeId)` — merges two speakers (averages embeddings, combines appearances, updates transcripts)
- `speakers:delete(id)` — removes from store, unenrolls from Modal if enrolled
- `speakers:getClips(id)` — returns clip file paths for a speaker (looked up via appearances -> outbox folders)

## Types (`src/shared/types.ts`)

```typescript
export interface Speaker {
  id: string
  name: string | null
  notes: string | null
  createdAt: string
  enrolledOnModal: boolean
  embedding: number[]
  appearances: SpeakerAppearance[]
}

export interface SpeakerAppearance {
  recordingId: string
  originalLabel: string
}

export interface SpeakerClip {
  speakerId: string
  recordingId: string
  filePath: string
  start: number
  end: number
}
```

Addition to `ElectronAPI`:

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

Addition to `RecordingDetail`:

```typescript
transcription: {
  // ...existing fields
  speakerMap: Record<string, string>  // originalLabel -> speakerId (computed at read time by main process, not stored in JSON)
}
```

## UI: Transcript Page — Speakers Submodule

A collapsible section on the `RecordingDetail` page, placed between the summary and transcript sections.

**Layout:**
- Compact list of speakers from this recording
- Each row: color dot, name (or "Unknown Speaker 1"), play button for first clip, assign/rename action
- Unnamed speakers: clicking the name area reveals an inline text input
- Named speakers: edit icon with Rename / Unassign options
- Color dots correspond to speaker labels in the transcript below

**Behavior:**
- Expanded by default if any speakers are unnamed, collapsed if all are named
- Assigning a name: optimistic local update, transcript labels update in real-time, Modal enrollment happens in background with a subtle sync indicator
- Notes accessible via an info icon that shows/hides a text area

## UI: Speakers Tab

Replaces the "Coming soon" placeholder. Two sections:

### "Needs Attention" (top)

- Cards for each unnamed speaker across all recordings
- Each card: play button for clips, text excerpts from their transcript segments, which recording(s) they appeared in, and a text input to assign a name
- Sorted by most recent appearance first
- Multi-recording speakers show grouped appearances

### "All Speakers" (bottom)

- Searchable list of all named speakers
- Each row: name, notes preview, number of appearances, first/last seen dates
- Click to expand: linked recordings list (clicking navigates to that recording), clip playback, editable notes text area, actions (Rename / Unassign / Delete / Merge with...)
- Merge: select another speaker from a dropdown, confirm, entries combine

### Empty State

If no transcriptions exist: message pointing user to the Process tab.

## Correction Workflows

| Action | Local effect | Modal effect | Transcript effect |
|--------|-------------|-------------|-------------------|
| Rename | Update name in store | Unenroll old name, enroll new name | Update labels in affected JSONs |
| Unassign | Set name to null | Unenroll | Revert labels to originalLabel |
| Reassign | Unassign + rename in one step | Unenroll old, enroll new | Update labels |
| Merge | Average embeddings, combine appearances, delete removed entry | Unenroll removed name if enrolled | Update labels in removed speaker's transcripts |
| Delete | Remove entry from store | Unenroll if enrolled | Labels unchanged (keep last-known label) |

For all corrections, the app uses the `appearances` list to find which transcript JSONs need label updates, and rewrites them.

## Error Handling

- **Modal unreachable during enrollment**: local rename succeeds, `enrolledOnModal` stays false. The Speakers tab shows a sync warning icon. User can retry later.
- **Embedding missing for a speaker**: can happen if diarization detected a speaker but couldn't extract enough audio for an embedding. Speaker still gets a local entry (for naming via text excerpts) but cannot be enrolled on Modal. UI indicates "voice not enrollable."
- **Clip files missing**: if outbox folder was deleted, clips are unavailable. UI falls back to showing text excerpts only.

## Out of Scope (v1)

- **Split speaker** — when diarization incorrectly merged two people into one label. Complex UI, rare case. Future enhancement.
- **Bulk import/export** — importing speaker databases from other tools.
- **Speaker similarity suggestions** — "this unknown speaker sounds like Sarah, assign?" Auto-suggestions based on local matching could be a v2 feature.
