# Maiscribe

Welcome! This is a completely open source app to transcribe audio files with ease. Only supports mac for now.

Your transcription runs through a remote service, but is private. The summarization step is not private. Update to a private llm or such to do so.


Transcribe and diarize audio files using Whisper large-v3 on Modal GPUs, with speaker identification and Claude-powered summaries. Includes an Electron desktop app and a CLI.

## Install

### Pipeline (Python)

```bash
cd src/pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### Desktop App (Electron)

```bash
cd src/app
bun install
bun run dev
```

## API Keys

All keys are stored in a `.env` file (the app manages this via Settings, or set them manually).

| Key | What it does |
|-----|------|
| `MODAL_TOKEN_ID` | Authenticates with Modal to run GPU transcription jobs |
| `MODAL_TOKEN_SECRET` | Paired with the token ID above |
| `HF_TOKEN` | Hugging Face token — needed for pyannote speaker diarization and embedding models (must accept the model licenses on HF) |
| `CLAUDE_API_KEY` | Anthropic API key for generating post-transcription summaries |

The app automatically syncs your HF token to a Modal secret named `huggingface` so the remote GPU function can access gated models.

## How It Works

1. Drop audio files into the inbox (via the app or the folder directly)
2. Files are uploaded to a Modal GPU function running faster-whisper (large-v3) for transcription and pyannote for speaker diarization
3. Speaker embeddings are compared against a persistent voice repo — known speakers get labeled by name, unknown ones get `SPEAKER_00` etc.
4. The transcript JSON is saved to the outbox, then sent to Claude for a structured summary (title, topics, action items, etc.)
5. Unknown speakers can be enrolled via the CLI (`--enroll`) or the app's Speakers tab, so they're recognized in future recordings

## CLI Usage

```bash
cd src/pipeline

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
