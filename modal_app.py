import modal

app = modal.App("audio-transcription")

model_volume = modal.Volume.from_name("whisper-models", create_if_missing=True)

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04",
        add_python="3.11",
    )
    .apt_install("ffmpeg")
    .pip_install("faster-whisper")
)

_model = None


def _load_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel(
            "large-v3",
            device="cuda",
            compute_type="float16",
            download_root="/models",
        )
    return _model


@app.function(
    gpu="T4",
    image=image,
    volumes={"/models": model_volume},
    timeout=600,
)
def transcribe_audio(audio_bytes: bytes, filename: str) -> dict:
    import os
    import tempfile

    model = _load_model()
    suffix = os.path.splitext(filename)[1] or ".audio"

    tmp_path = None

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        tmp_path = f.name
        f.write(audio_bytes)

    try:
        segments_iter, info = model.transcribe(
            tmp_path,
            language="en",
            beam_size=5,
        )
        segments = [
            {"start": s.start, "end": s.end, "text": s.text.strip()}
            for s in segments_iter
        ]
        return {
            "ok": True,
            "result": {
                "text": " ".join(s["text"] for s in segments),
                "segments": segments,
                "language": "en",
                "duration": info.duration,
            },
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
