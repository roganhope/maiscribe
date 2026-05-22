import modal

app = modal.App("audio-transcription")

model_volume = modal.Volume.from_name("whisper-models", create_if_missing=True)
voice_repo_volume = modal.Volume.from_name("voice-repo", create_if_missing=True)

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04",
        add_python="3.11",
    )
    .apt_install("ffmpeg")
    .pip_install(
        "torch",
        "torchaudio",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install("faster-whisper", "pyannote.audio", "omegaconf")
)

VOICE_REPO_PATH = "/voice-repo/speakers.json"
SIMILARITY_THRESHOLD = 0.85

_whisper_model = None
_diarization_pipeline = None
_embedding_inference = None


def _load_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel(
            "large-v3",
            device="cuda",
            compute_type="float16",
            download_root="/models",
        )
    return _whisper_model


def _load_diarization(token: str):
    global _diarization_pipeline
    if _diarization_pipeline is None:
        import torch
        from pyannote.audio import Pipeline
        _diarization_pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=token,
        ).to(torch.device("cuda"))
    return _diarization_pipeline


def _load_embedding(token: str):
    global _embedding_inference
    if _embedding_inference is None:
        import torch
        from pyannote.audio import Model, Inference
        model = Model.from_pretrained(
            "pyannote/embedding",
            token=token,
        ).to(torch.device("cuda"))
        _embedding_inference = Inference(model, window="whole")
    return _embedding_inference


def _load_voice_repo() -> dict:
    import os
    import json
    import numpy as np
    if not os.path.exists(VOICE_REPO_PATH):
        return {}
    with open(VOICE_REPO_PATH) as f:
        data = json.load(f)
    return {name: np.array(emb) for name, emb in data.items()}


def _save_voice_repo(repo: dict):
    import os
    import json
    os.makedirs(os.path.dirname(VOICE_REPO_PATH), exist_ok=True)
    with open(VOICE_REPO_PATH, "w") as f:
        json.dump({name: emb.tolist() for name, emb in repo.items()}, f)
    voice_repo_volume.commit()


def _cosine_similarity(a, b) -> float:
    import numpy as np
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def _match_speaker(embedding, voice_repo: dict) -> tuple[str | None, float]:
    best_name, best_score = None, 0.0
    for name, stored_emb in voice_repo.items():
        score = _cosine_similarity(embedding, stored_emb)
        if score > best_score:
            best_score, best_name = score, name
    if best_score >= SIMILARITY_THRESHOLD:
        return best_name, best_score
    return None, best_score


@app.function(
    gpu="T4",
    image=image,
    volumes={"/models": model_volume, "/voice-repo": voice_repo_volume},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=600,
)
def transcribe_audio(audio_bytes: bytes, filename: str) -> dict:
    import os
    import tempfile
    import numpy as np
    from pyannote.audio import Audio
    from pyannote.core import Segment

    token = os.environ["HUGGING_FACE_HUB_TOKEN"]
    whisper = _load_whisper()
    diarizer = _load_diarization(token)
    embedder = _load_embedding(token)
    voice_repo = _load_voice_repo()

    import subprocess

    suffix = os.path.splitext(filename)[1] or ".audio"
    tmp_path = None
    wav_path = None

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        tmp_path = f.name
        f.write(audio_bytes)

    try:
        # Convert to 16kHz mono wav — pyannote requires exact sample counts,
        # which m4a/mp4 container headers don't always guarantee.
        wav_path = tmp_path + ".wav"
        subprocess.run(
            ["ffmpeg", "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", wav_path],
            check=True,
            capture_output=True,
        )

        # Transcribe (use original file so whisper gets full quality)
        segs_iter, info = whisper.transcribe(tmp_path, language="en", beam_size=5)
        segments = [
            {"start": s.start, "end": s.end, "text": s.text.strip()}
            for s in segs_iter
        ]

        # Diarize against the wav
        diarization_result = diarizer(wav_path)
        # pyannote changed its return type across versions
        if hasattr(diarization_result, 'itertracks'):
            diarization = diarization_result
        else:
            public_attrs = [a for a in dir(diarization_result) if not a.startswith('_')]
            # Try known attribute names used in different pyannote versions
            found = False
            for attr in public_attrs:
                candidate = getattr(diarization_result, attr)
                if hasattr(candidate, 'itertracks'):
                    diarization = candidate
                    found = True
                    break
            if not found:
                raise ValueError(
                    f"Cannot find Annotation in {type(diarization_result).__name__}. "
                    f"Public attrs: {public_attrs}"
                )

        # Collect speaker turns
        speaker_turns: dict[str, list[tuple[float, float]]] = {}
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            speaker_turns.setdefault(speaker, []).append((turn.start, turn.end))

        # Extract mean embedding per speaker
        audio_loader = Audio(sample_rate=16000, mono=True)
        speaker_embeddings: dict[str, np.ndarray] = {}
        for speaker, turns in speaker_turns.items():
            embs = []
            # Sort by duration descending so we try the longest segments first
            sorted_turns = sorted(turns, key=lambda t: t[1] - t[0], reverse=True)
            for start, end in sorted_turns[:10]:
                if end - start < 0.5:
                    continue
                try:
                    waveform, sr = audio_loader.crop(wav_path, Segment(start, end))
                    emb = embedder({"waveform": waveform, "sample_rate": sr})
                    embs.append(emb)
                    if len(embs) >= 5:
                        break
                except Exception:
                    continue
            if embs:
                speaker_embeddings[speaker] = np.mean(embs, axis=0)

        # Match each speaker against the voice repo
        speaker_labels: dict[str, str] = {}
        # Seed every speaker from diarization so none fall through to UNKNOWN
        for speaker in speaker_turns:
            speaker_labels[speaker] = speaker
        # Override with matched name where we have an embedding
        for speaker, emb in speaker_embeddings.items():
            name, _ = _match_speaker(emb, voice_repo)
            if name:
                speaker_labels[speaker] = name

        # Assign speaker label to each transcript segment by max time overlap
        def assign_speaker(start: float, end: float) -> str:
            best_spk, best_overlap = None, 0.0
            for turn, _, spk in diarization.itertracks(yield_label=True):
                overlap = max(0.0, min(end, turn.end) - max(start, turn.start))
                if overlap > best_overlap:
                    best_overlap, best_spk = overlap, spk
            return speaker_labels.get(best_spk, "UNKNOWN") if best_spk else "UNKNOWN"

        labeled_segments = [
            {**seg, "speaker": assign_speaker(seg["start"], seg["end"])}
            for seg in segments
        ]

        return {
            "ok": True,
            "result": {
                "text": " ".join(s["text"] for s in segments),
                "segments": labeled_segments,
                "language": "en",
                "duration": info.duration,
                # stored for enrollment — keyed by final label so the user sees
                # "SPEAKER_00" for unknowns and real names for matched speakers
                "speaker_embeddings": {
                    speaker_labels[spk]: emb.tolist()
                    for spk, emb in speaker_embeddings.items()
                },
            },
        }
    except Exception as e:
        import traceback
        return {"ok": False, "error": str(e), "traceback": traceback.format_exc()}
    finally:
        for path in (tmp_path, wav_path):
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass


@app.function(
    image=image,
    volumes={"/voice-repo": voice_repo_volume},
    timeout=60,
)
def enroll_speaker(name: str, embedding: list[float]) -> dict:
    import numpy as np
    repo = _load_voice_repo()
    new_emb = np.array(embedding)
    if name in repo:
        # Running average with existing embedding
        repo[name] = (repo[name] + new_emb) / 2
    else:
        repo[name] = new_emb
    _save_voice_repo(repo)
    return {"ok": True, "enrolled": name}


@app.function(
    image=image,
    volumes={"/voice-repo": voice_repo_volume},
    timeout=60,
)
def list_speakers() -> list[str]:
    return list(_load_voice_repo().keys())
