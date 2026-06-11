# Pipeline Audit — Audio → Diarization → Transcription

*Date: 2026-06-10. Scope: the transcription/diarization pipeline (`src/pipeline/`) and the Electron main-process code that drives it (`src/app/src/main/`).*

**Headline finding:** there are two parallel speaker-recognition systems doing the same job — one on Modal, one in Electron — and most of the pipeline's complexity, plus several real bugs, fall out of that duplication. Collapsing to one would delete roughly a third of the pipeline-related code.

---

## 1. The big one: dual voice repositories

There are two complete, independent speaker stores with identical matching logic:

- **Modal side**: `voice-repo` volume + `_match_speaker` / `enroll_speaker` / `unenroll_speaker` / `list_speakers` in `src/pipeline/modal_app.py`. Cosine similarity, threshold 0.85. Matches during transcription and bakes real names into segment labels.
- **Electron side**: `{userData}/speakers.json` + `findBestMatch` in `src/app/src/main/speakers.ts:34-57` — the same cosine similarity, the same 0.85 threshold, re-matching the same embeddings after the fact.

They're kept in sync by spawning a full Python process that does a Modal `app.run()` round-trip for every rename, merge, unassign, and delete (`runModalCommand` in `speakers.ts:100`). And they drift anyway: `mergeSpeakers` averages embeddings locally but never re-enrolls the result on Modal, so after a merge the two repos disagree until the next rename happens to push a fresh copy.

**Recommendation:** make Modal stateless. Have `transcribe_audio` always return raw `SPEAKER_XX` labels plus embeddings, and do all matching/naming locally in `speakers.ts` (which already does it). This deletes:

- the `voice-repo` Modal volume
- three Modal functions (`enroll_speaker`, `unenroll_speaker`, `list_speakers`)
- `_load_voice_repo`, `_save_voice_repo`, `_match_speaker` in `modal_app.py`
- `run_enroll`, `run_list_speakers`, and the `--enroll` / `--enroll-single` / `--unenroll` / `--list-speakers` CLI flags in `transcribe.py`
- `runModalCommand` in `speakers.ts`

Every rename/merge becomes an instant local file write instead of a GPU-app cold start.

## 2. Second-order complexity caused by the dual system

Because Modal sometimes returns real names and sometimes `SPEAKER_XX`, the rest of the code has to handle both:

- `updateTranscriptsForSpeaker` (`speakers.ts:126`) rewrites every transcript JSON on rename, mutating segment labels on disk. But `history.ts:136` already builds a `speakerMap` for display-time mapping — the file mutation is redundant with it. If segments always kept raw labels, renaming would be a pure view concern, and the rewrite function plus the dual `originalLabel`-or-`name` matching in `getSpeakerQuotes` and `getSpeakerMap` would disappear.
- `registerNewSpeakers` (called from `queue.ts:96`) re-matches embeddings that Modal already matched and keyed by final name — a Modal-matched "Alice" gets locally re-matched against the store to find… Alice.
- The 0.85 similarity threshold is defined twice, once per language (`modal_app.py:23`, `speakers.ts:44`).

## 3. Bugs

### 3.1 Stale timeout kills the wrong process — `pipeline.ts:76-82`

The 30-minute `setTimeout` is never cleared when a run finishes. `currentProcess` is module-global, so when queue item #1 finishes in 5 minutes and item #5 is running at the 30-minute mark, item #1's timer fires, sees a non-null `currentProcess`, and kills item #5. Long queues will hit this. Fix: store the timer handle and clear it on process close.

### 3.2 Error log writes into the app bundle — `transcribe.py:21-30`

`write_error_log` appends to `INBOX_DIR/errors.txt` where `INBOX_DIR = Path(__file__).parent / "inbox"` — inside the packaged app's resources, which may be read-only and is never the user's configured inbox. It should go to the outbox/basePath, or be dropped in favor of stdout (the app already captures errors).

### 3.3 Fragile stdout-as-protocol — `pipeline.ts:47-62`

The output path is recovered by regexing `[done] file → /path (...)` — a folder name containing `" ("` truncates the path; any stray print line becomes a "progress" update; an `[error]` line for one concern can fire `onError` mid-run. Fix: have `transcribe.py` emit JSON lines (`{"event": "done", "output": ...}`) and parse those. Small change, removes a whole class of breakage.

## 4. Modal-side simplifications

### 4.1 Pin dependencies; delete version sniffing

The image installs unpinned `torch`, `faster-whisper`, `pyannote.audio` (`modal_app.py:14-19`), which is exactly why the defensive `dir()`-scan for an object with `itertracks` exists (`modal_app.py:207-224`). Pin the versions and that 18-line block becomes one line.

### 4.2 Drop the base64 clip round-trip

Speaker clips are cut with one ffmpeg subprocess each, base64-encoded into the Modal return payload (~430 KB per 10 s clip), shipped home, decoded, and written to disk (`modal_app.py:104-155`, `transcribe.py:309-317`). Return raw bytes instead of base64 (Modal serializes bytes fine), or cut all clips in a single ffmpeg invocation — and consider whether clips need to come from Modal at all when `audio-handling=store` keeps the original locally.

### 4.3 The batch/`map()` path is unused by the app

Electron always passes exactly one file per spawn, but `transcribe.py` carries `--folder`, `collect_from_folder`, and `_map_with_errors` batching. If CLI batch mode isn't actually used, the single-file path is meaningfully simpler.

### 4.4 `min_speakers=2` default splits solo recordings

Forcing the diarizer to find ≥2 speakers in a one-person voice memo manufactures a phantom speaker that then pollutes the speaker store. Consider defaulting to no constraint and letting pyannote decide.

### 4.5 Minor

- `language="en"` is hardcoded in `whisper.transcribe` (`modal_app.py:199`); auto-detect is free.
- `assign_speaker` is O(segments × turns) (`modal_app.py:264-270`) — fine for an hour of audio, but a sorted-turn lookup is trivial if long files ever matter.

## Suggested order of attack

1. Fix the timeout bug (small, real, user-facing).
2. JSON-lines stdout protocol (small, unlocks reliable error/done handling).
3. Make Modal stateless + local-only speaker store, then drop transcript rewriting in favor of the existing `speakerMap`. These two go together and remove 300+ lines plus the drift bugs. Do this as its own branch — it touches the data model.
4. Pin deps, delete version sniffing, simplify clips.
