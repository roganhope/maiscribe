<p align="center">
  <img src="src/app/resources/icon.png" width="128" height="128" alt="maiscribe icon" />
</p>

<h3 align="center">maiscribe: my open source ai scribe</h3>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0--beta-orange" alt="version 0.1.0-beta" />
</p>

## Mission statement

I don’t want to pay for audio transcription, and I like my privacy. My laptop wasn’t powerful enough to run the models locally, though, so I built this app to get a bit of both.

## Current Features

- Upload an audio file, transcribe it on an external cloud provider, identify the speakers, and summarize it with Claude
- Browse your recordings
- Play back your files

## HOW TO INSTALL

First, install [bun](https://bun.sh) (package manager):

```bash
curl -fsSL https://bun.sh/install | bash
```

Then run maiscribe:

```bash
cd src/app
bun install
bun run dev
```

## How it works

1. I set this up with Modal, a serverless cloud platform with a free tier — I’ll eventually add a version that runs on your local machine too. Modal doesn’t use your data right now and is technically secure, but your audio does leave your machine.
2. You accept the Hugging Face models that power the app, and Maiscribe handles the rest of the install for you.
3. You can set up a Claude API key if you want summarization, though this part isn’t secure.

## SCREENSHOTS HERE

## Setup instructions

The setup wizard will walk you through all of this, though.

### MODAL SETUP

1. Create an account if you don’t have one
2. Set up a workspace
3. Add a card (generous free tier — you shouldn’t get charged unless you run a lot of files)
4. Save your key for the wizard

### HUGGING FACE SETUP

1. Set up an account
2. Get your key
3. Accept these models:
   - [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
   - [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0)
   - [pyannote/embedding](https://huggingface.co/pyannote/embedding)

### CLAUDE API KEY

- You’ll need to use the developer platform
- It’s also charged by use, but it’s cheap
- Optional — you can skip summarization entirely

## Future Features

✨ Run the transcription on your local machine  
✨ Smart Speaker Detection  
✨ Audio File Tagging for Organization (Tag by meeting)  
✨ Ask an agent about your transcriptions (“Tell me about the daily status update meetings over the last week”)
