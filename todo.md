# To Do

Ordered by importance. Details for pipeline items in [AUDIT.md](AUDIT.md).

## P1 — Bugs

- [x] Fix stale 30-min timeout killing the wrong queue item (`pipeline.ts:76-82`) — clear the timer on process close (AUDIT §3.1)
- [x] Stop writing `errors.txt` into the app bundle's source dir (`transcribe.py:21-30`) — now logs to the outbox (AUDIT §3.2)
- [ ] Cancel audio transcription (existing item — note `pipeline:cancel` exists in `queue.ts`; verify it works end-to-end / is exposed in UI)

## P2 — Reliability

- [x] Replace regex stdout parsing with JSON-lines protocol between `transcribe.py` and `pipeline.ts` (AUDIT §3.3) — `--json` flag; CLI keeps human-readable output
- [x] Pin pipeline dependencies in the Modal image; delete the pyannote version-sniffing block (AUDIT §4.1) — verified end-to-end on Modal with a real audio file (pyannote pinned to 4.0.4; 3.3.2 broke the `token=` kwarg)

## P3 — The big simplification (own branch — touches data model)

- [ ] Make Modal stateless: always return raw `SPEAKER_XX` labels + embeddings; do all speaker matching/naming locally. Deletes the voice-repo volume, 3 Modal functions, 4 CLI flags, and `runModalCommand` (AUDIT §1)
- [ ] Stop rewriting transcript JSONs on rename; map labels at display time via the existing `speakerMap` (AUDIT §2)

## P4 — Cleanups

- [ ] Drop base64 clip round-trip: return raw bytes or cut clips in one ffmpeg call (AUDIT §4.2)
- [ ] Remove unused batch/`--folder`/`map()` path in `transcribe.py` if CLI batch mode isn't needed (AUDIT §4.3)
- [ ] Don't force `min_speakers=2` by default — phantom speakers on solo recordings (AUDIT §4.4)
- [ ] Let whisper auto-detect language instead of hardcoded `"en"` (AUDIT §4.5)
- [ ] Speed up `assign_speaker` segment↔turn matching for long files (AUDIT §4.5)
