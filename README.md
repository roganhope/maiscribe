<p align="center">
  <img src="src/app/resources/icon.png" width="128" height="128" alt="maiscribe icon" />
</p>

# maiscribe

Welcome! This is a completely open source app to transcribe audio files with ease. Only supports mac for now.

Your transcription runs through a remote service, but is private. The summarization step is not private. Update to a private llm or such to do so.


Transcribe and diarize audio files using Whisper large-v3 on Modal GPUs, with speaker identification and Claude-powered summaries. Includes an Electron desktop app and a CLI.

## Install

### Pipeline (Python)

```bash
cd src/scripts
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### Desktop App (Electron)

```bash
cd src/app
bun install
bun run dev
```

### DMG Installer (Experimental)

You can build a standalone macOS installer that bundles everything (app + pipeline scripts) into a single `.dmg` file. No separate Python setup or repo clone needed — the app provisions its own Python environment on first launch.

```bash
cd src/app
npm install
npm run dist
```

The DMG will be at `src/app/release/maiscribe-<version>-arm64.dmg`. Open it and drag maiscribe to Applications.

> **Note:** The DMG is currently unsigned and unnotarized. macOS will show a warning on first launch — right-click the app and select "Open" to bypass Gatekeeper, or go to System Settings → Privacy & Security and click "Open Anyway".

## Setup Wizard & Required Keys

On first launch, the setup wizard walks you through configuration:

1. **File Location** — Where transcripts are saved. A default is selected for you, but you can change it.

2. **Modal Key** `REQUIRED` — [Modal](https://modal.com) is a serverless GPU platform. This key is needed to run transcription on remote GPUs so you don't use compute on your own machine.

3. **Hugging Face Token** `REQUIRED` — Used for speaker diarization ("who's talking") via pyannote, plus downloading [faster-whisper large-v3](https://huggingface.co/Systran/faster-whisper-large-v3) for transcription. You must accept the license on **all three** gated pyannote model pages before your token will work:
   - [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
   - [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0)
   - [pyannote/embedding](https://huggingface.co/pyannote/embedding)

4. **Claude API Key** `OPTIONAL` — An [Anthropic API](https://console.anthropic.com) key. This is only needed if you want post-transcription summaries (title, topics, action items, etc.).

All keys are stored in a local `.env` file (the app manages this via the wizard/settings, or set them manually). The app automatically syncs your HF token to a Modal secret so the remote GPU function can access the gated models.

## How It Works

1. Drop audio files into the inbox (via the app or the folder directly)
2. Files are uploaded to a Modal GPU function running faster-whisper (large-v3) for transcription and pyannote for speaker diarization
3. Speaker embeddings are compared against a persistent voice repo — known speakers get labeled by name, unknown ones get `SPEAKER_00` etc.
4. The transcript JSON is saved to the outbox, then sent to Claude for a structured summary (title, topics, action items, etc.)
5. Unknown speakers can be enrolled via the CLI (`--enroll`) or the app's Speakers tab, so they're recognized in future recordings

## CLI Usage

```bash
cd src/scripts

# Transcribe files
python transcribe.py recording.m4a

# Transcribe a folder
python transcribe.py --folder ~/recordings

# Enroll unknown speakers from a transcript
python transcribe.py --enroll outbox/recording_20250101_120000/recording.json

# List enrolled speakers
python transcribe.py --list-speakers

# Re-summarize a transcript
python transcribe.py --summarize path/to/transcript.json

# Skip summary
python transcribe.py --no-summary recording.m4a
```

## Project Structure

```
src/
  pipeline/     Python backend — Modal transcription, diarization, summarization
  app/          Electron desktop app (React + Tailwind)
```
