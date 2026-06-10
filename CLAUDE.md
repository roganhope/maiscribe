# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Maiscribe is a macOS desktop app that transcribes and diarizes audio files using remote GPUs, then optionally summarizes transcripts with Claude. It has two main components: a Python pipeline that runs on Modal (serverless GPU), and an Electron desktop app (React + Tailwind) that wraps the pipeline with a drag-and-drop UI.

## Commands

### Electron App (from `src/app/`)
```bash
bun install          # install dependencies
bun run dev          # start dev mode (hot reload)
bun run build        # build for production
bun run dist         # build + package .dmg/.zip
```

### Python Pipeline (from `src/pipeline/`)
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python transcribe.py recording.m4a        # transcribe a file
python transcribe.py --summarize path.json # re-summarize existing transcript
```

### Tests (from repo root)
```bash
pytest                          # run all tests
pytest tests/test_summarize.py  # run one test file
pytest -k test_name             # run a single test
```

Tests use `sys.path.insert` to add `src/pipeline` — no package install needed, just activate the venv.

## Architecture

### Pipeline (`src/pipeline/`)

Three files, each self-contained:

- **`modal_app.py`** — Modal app definition with a GPU function (`transcribe_audio`) that runs faster-whisper for transcription and pyannote for speaker diarization. Uses two Modal Volumes: `whisper-models` (model cache) and `voice-repo` (enrolled speaker embeddings as JSON). Speaker matching uses cosine similarity (threshold 0.85) against stored embeddings.
- **`transcribe.py`** — CLI entry point. Handles file validation, calls the Modal function, writes results to outbox folders (`{stem}_{timestamp}/`), and triggers summarization. Also has `--enroll` and `--list-speakers` subcommands.
- **`summarize.py`** — Calls Claude API with a structured prompt, writes `summary.json` and `summary.md` next to the transcript.

The pipeline communicates progress via stdout markers: `[step]`, `[done]`, `[error]`. The Electron app parses these to drive the queue UI.

### Electron App (`src/app/`)

Built with `electron-vite`. Three process layers:

- **Main process** (`src/main/`) — manages config, env vars, file watching, queue processing, Python environment provisioning, and API key validation. IPC handlers are registered per module (`registerConfigIpc`, `registerQueueIpc`, etc).
- **Preload** (`src/preload/`) — exposes `window.api` typed interface to renderer.
- **Renderer** (`src/renderer/`) — React app with components for drop zone, queue, recording history/detail, settings, and setup wizard.

Key architectural decisions:
- The app auto-provisions a standalone Python 3.12 runtime + venv on first launch (no system Python dependency). See `python-env.ts`.
- Config lives in Electron's `userData` dir as `config.json`; secrets in a `.env` file in the same location. The app migrated from repo-root storage.
- The `pipeline.ts` module spawns `transcribe.py` as a child process, passing env vars and parsing stdout for progress.
- Queue items go through states: `staged → pending → processing → done/error`. Items start as `staged` and only move to `pending` when the user clicks start.
- File watcher (chokidar) monitors the configured inbox folder and auto-adds audio files to the queue.

### IPC Bridge

All renderer↔main communication goes through typed IPC channels defined in `src/shared/types.ts` (the `ElectronAPI` interface). When adding new functionality, add the type to `ElectronAPI`, implement the handler in main, and expose it in the preload script.

## Environment Variables

Stored in `{userData}/.env`, managed by the setup wizard:
- `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` — Modal auth
- `HF_TOKEN` — Hugging Face (gated model access)
- `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` — optional, for summarization

The app syncs `HF_TOKEN` to a Modal secret named "huggingface" so the remote GPU function can access gated models.
