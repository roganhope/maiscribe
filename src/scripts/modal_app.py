import modal

app = modal.App("audio-transcription")

model_volume = modal.Volume.from_name("whisper-models", create_if_missing=True)

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04",
        add_python="3.11",
    )
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.5.1",
        "torchaudio==2.5.1",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "faster-whisper==1.1.1",
        # ctranslate2 >= 4.5 requires cuDNN 9; base image ships cuDNN 8
        "ctranslate2==4.4.0",
        "pyannote.audio==4.0.4",
        "omegaconf==2.3.0",
    )
)

_whisper_model = None
_diarization_pipeline = None
_embedding_inference = None

# Where the mounted whisper-models volume lives inside the container.
MODELS_DIR = "/models"
HF_CACHE_DIR = f"{MODELS_DIR}/hf"


def _use_volume_hf_cache():
    """Point the Hugging Face cache at the volume so weights survive the container.

    faster-whisper is handed `download_root` directly, but pyannote goes through
    huggingface_hub, which caches under HF_HOME — by default a container-local
    path that dies with the container, so every cold start re-downloads it.

    Set inside the function body rather than on the image: huggingface_hub reads
    HF_HOME at import time, and the loaders below import it lazily, so this lands
    before it matters. Setting it on the image would invalidate the image and
    force a rebuild for no benefit.
    """
    import os
    os.environ.setdefault("HF_HOME", HF_CACHE_DIR)


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
            tmp_clip_path = None
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
            except Exception:
                pass
            finally:
                if tmp_clip_path and os.path.exists(tmp_clip_path):
                    os.unlink(tmp_clip_path)
            if len(speaker_clips) >= max_clips:
                break
        clips[speaker] = speaker_clips
    return clips


@app.function(
    gpu="T4",
    image=image,
    volumes={"/models": model_volume},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=1200,
)
def transcribe_audio(audio_bytes: bytes, filename: str, min_speakers: int = 2) -> dict:
    import os
    import tempfile
    import numpy as np
    from pyannote.audio import Audio
    from pyannote.core import Segment

    _use_volume_hf_cache()
    token = os.environ["HUGGING_FACE_HUB_TOKEN"]
    whisper = _load_whisper()
    diarizer = _load_diarization(token)
    embedder = _load_embedding(token)

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

        # Diarize against the wav. pyannote 4.x wraps the Annotation in an
        # output object for some pipelines; unwrap when needed.
        diarization = diarizer(wav_path, min_speakers=min_speakers)
        if not hasattr(diarization, "itertracks"):
            diarization = diarization.speaker_diarization

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

        # Assign raw diarization label to each transcript segment by max time
        # overlap. Matching labels to known people happens locally in the app.
        def assign_speaker(start: float, end: float) -> str:
            best_spk, best_overlap = None, 0.0
            for turn, _, spk in diarization.itertracks(yield_label=True):
                overlap = max(0.0, min(end, turn.end) - max(start, turn.start))
                if overlap > best_overlap:
                    best_overlap, best_spk = overlap, spk
            return best_spk or "UNKNOWN"

        labeled_segments = [
            {**seg, "speaker": assign_speaker(seg["start"], seg["end"])}
            for seg in segments
        ]

        # Extract audio clips per speaker for UI playback
        speaker_clips = _extract_speaker_clips(wav_path, speaker_turns)

        return {
            "ok": True,
            "result": {
                "text": " ".join(s["text"] for s in segments),
                "segments": labeled_segments,
                "language": "en",
                "duration": info.duration,
                "speaker_embeddings": {
                    spk: emb.tolist() for spk, emb in speaker_embeddings.items()
                },
                "speaker_clips": speaker_clips,
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
    gpu="T4",
    image=image,
    volumes={"/models": model_volume},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=3600,
)
def prefetch_models() -> dict:
    """Download every model into the volume so the first transcription is fast.

    Runs on a GPU rather than CPU on purpose: the loaders instantiate on cuda, so
    a CPU run would download the weights but prove nothing about whether they
    actually load. This is the step that makes a cold workspace usable.
    """
    import os
    import time

    _use_volume_hf_cache()
    token = os.environ["HUGGING_FACE_HUB_TOKEN"]

    steps = []

    def fetch(name, fn):
        started = time.monotonic()
        try:
            fn()
            ok, error = True, None
        except Exception as e:
            ok, error = False, str(e)
        steps.append({
            "name": name,
            "ok": ok,
            "error": error,
            "seconds": round(time.monotonic() - started, 1),
        })

    def dir_size_mb(path):
        total = 0
        for root, _, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
        return round(total / (1024 * 1024), 1)

    before_mb = dir_size_mb(MODELS_DIR)

    fetch("whisper", _load_whisper)
    fetch("diarization", lambda: _load_diarization(token))
    fetch("embedding", lambda: _load_embedding(token))

    # Without this the downloads die with the container and the next run repeats them.
    try:
        model_volume.commit()
        committed = True
    except Exception:
        committed = False

    return {
        "ok": all(s["ok"] for s in steps),
        "steps": steps,
        "volume": {
            "megabytes_before": before_mb,
            "megabytes_after": dir_size_mb(MODELS_DIR),
            "committed": committed,
        },
    }


@app.function(
    gpu="T4",
    image=image,
    volumes={"/models": model_volume},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=1800,
)
def verify_setup() -> dict:
    """Exercise everything transcribe_audio needs, without transcribing.

    Shares image, volume and secret with transcribe_audio so a passing run proves
    the real artifact builds. Each step is timed and caught independently — one
    failure must not mask the ones after it.
    """
    import os
    import subprocess
    import time

    _use_volume_hf_cache()
    steps: list[dict] = []

    def step(name: str, fn):
        started = time.monotonic()
        try:
            detail = fn()
            ok, error = True, None
        except Exception as e:
            detail, ok, error = None, False, str(e)
        steps.append({
            "name": name,
            "ok": ok,
            "detail": detail,
            "error": error,
            "seconds": round(time.monotonic() - started, 1),
        })
        return ok

    def check_secret():
        token = os.environ["HUGGING_FACE_HUB_TOKEN"]
        if not token:
            raise RuntimeError("HUGGING_FACE_HUB_TOKEN is empty")
        return "injected"

    def check_gpu():
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA not available on the container")
        return torch.cuda.get_device_name(0)

    def check_ffmpeg():
        out = subprocess.run(
            ["ffmpeg", "-version"], check=True, capture_output=True, text=True
        )
        return out.stdout.splitlines()[0]

    step("secret", check_secret)
    step("gpu", check_gpu)
    step("ffmpeg", check_ffmpeg)

    # Snapshot the volume *before* loading whisper. Non-empty on a second run is
    # direct evidence that weights persist between runs — more reliable than
    # inferring it from download timing.
    try:
        cached_before = sorted(os.listdir("/models"))
    except OSError:
        cached_before = []

    # Only meaningful once the secret is present; the loaders need the token.
    token = os.environ.get("HUGGING_FACE_HUB_TOKEN", "")
    step("whisper", lambda: type(_load_whisper()).__name__)
    step("diarization", lambda: type(_load_diarization(token)).__name__)
    step("embedding", lambda: type(_load_embedding(token)).__name__)

    # Persist any newly downloaded whisper weights so the next run reuses them.
    committed = None
    try:
        model_volume.commit()
        committed = True
    except Exception:
        committed = False

    try:
        cached_after = sorted(os.listdir("/models"))
    except OSError:
        cached_after = []

    return {
        "ok": all(s["ok"] for s in steps),
        "steps": steps,
        "volume": {
            "cached_on_entry": cached_before,
            "cached_on_exit": cached_after,
            "committed": committed,
        },
    }


