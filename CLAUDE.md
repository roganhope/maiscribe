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

### Python Pipeline (from `src/scripts/`)
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

Tests use `sys.path.insert` to add `src/scripts` — no package install needed, just activate the venv.

### Utility Scripts (from repo root)
Each script does one thing and is runnable on its own. All share the same exit codes: **0** = pass, **1** = broken, **2** = a credential is missing (nothing broken, setup is just incomplete).

```bash
python src/scripts/check_modal.py     # Modal reachable, tokens valid, an app can run
python src/scripts/check_hf.py        # every model in models.json is reachable
python src/scripts/check_claude.py    # Claude API reachable (optional — summaries only)
python src/scripts/setup_modal.py     # create secret, build image, prefetch models  [expensive]
python src/scripts/health_modal.py    # read-only: is this workspace still healthy?

python src/scripts/init_modal.py          # orchestrator: run every check, change nothing
python src/scripts/init_modal.py --setup  # provision a fresh workspace, then verify
```

**Shared behaviour.** Credentials resolve from the process environment first and `{userData}/.env` second — the inverse of the app's own precedence (`pipeline.ts:56`), so a throwaway workspace can be tested inline without touching the file:

```bash
MODAL_TOKEN_ID=... MODAL_TOKEN_SECRET=... python src/scripts/setup_modal.py
```

The Modal scripts re-exec under the app's provisioned venv Python (the interpreter `pipeline.ts` spawns), so `python` above can be anything; `--python PATH` overrides. HTTPS uses certifi's CA bundle when available, because a python.org install that never ran `Install Certificates.command` otherwise fails every request with `CERTIFICATE_VERIFY_FAILED`.

**`check_modal.py`** ends by actually creating an ephemeral app and running a trivial CPU function. That last step is the only one that proves Modal can schedule work for this account — `GET api.modal.com/api/v1/apps` returns 200 even with *no* Authorization header, so reachability alone proves nothing about the tokens. `--no-run` stops before it.

**`setup_modal.py`** is the run-once script: it creates the `huggingface` secret, builds the CUDA image, and downloads whisper + pyannote weights into the `whisper-models` volume so the first real transcription doesn't. It does **not** `modal deploy` — the app stays ephemeral, so a pipeline change ships inside the desktop app instead of needing a redeploy in every user's workspace.

**`health_modal.py`** is strictly read-only and starts no container, so it is safe to run at any time. It checks that weights are actually *cached*, not just that the volume exists — a fully configured workspace with an empty volume still makes the user wait five minutes.

### Model manifest

`src/scripts/models.json` is the single source of truth for the Hugging Face repos the pipeline pulls. `check_hf.py` and `check-hf-access.mjs` both read it, so adding or swapping a model means editing that one file. `tests/test_models_manifest.py` fails if the manifest and `modal_app.py` drift apart.

`src/app/src/main/validate-keys.ts:58` still carries its own hardcoded copy of the list — worth pointing at the manifest when that file is next touched.

`check-hf-access.mjs` remains as the Node entry point (no Python needed) and now reads the manifest too.

## Architecture

### Pipeline (`src/scripts/`)

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
