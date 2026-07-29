#!/usr/bin/env python3
"""Transcribe a short test file end to end and check the result is usable.

This is the last tier, and the only one that exercises what the product actually
does. verify_modal.py proves every model *loads*; this proves they produce a
transcript with the shape the app depends on.

It is the hot path: on a workspace that setup_modal.py has prepared, nothing is
built and nothing is downloaded, so the whole run is the transcription itself.
That makes it a fair measure of what a user waits for.

The checks are deliberately structural rather than exact-text. Whisper output
varies slightly between runs, so asserting a specific transcript would produce
flaky failures that teach you nothing. Use --expect to assert content when you
know what the file says.

Usage:
    python scripts/smoke_transcribe.py [AUDIO] [--expect PHRASE] [--min-speakers N]

Exit codes: 0 = transcription is good, 1 = failed a check, 2 = credential missing.
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    FAIL,
    MODAL_KEYS,
    PASS,
    REPO_ROOT,
    Outcome,
    export_modal_credentials,
    import_pipeline,
    load_credentials,
    maybe_reexec,
    modal_env,
    print_footer,
    print_header,
    print_outcome,
    require,
    run_steps,
)

DEFAULT_AUDIO = Path(__file__).resolve().parent / "testaudio.m4a"
# pyannote/embedding produces 512-dimensional vectors.
EMBEDDING_DIM = 512


def local_duration(path):
    """Duration via ffprobe, or None if ffprobe is unavailable."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        return float(out.stdout.strip())
    except Exception:
        return None


def check_result(result, expected_duration=None, expect_phrase=None):
    """Structural checks on a transcription payload.

    Returns [(name, ok, detail)]. Pure — no network, no Modal — so the whole
    contract this script enforces is unit-testable without a GPU.
    """
    checks = []

    def add(name, ok, detail=""):
        checks.append((name, bool(ok), detail))

    if not result.get("ok"):
        add("remote call", False, result.get("error", "unknown error"))
        return checks
    add("remote call", True, "returned ok")

    payload = result.get("result") or {}

    text = (payload.get("text") or "").strip()
    add("text", bool(text), f"{len(text)} chars: {text[:60]!r}" if text else "empty transcript")

    segments = payload.get("segments") or []
    add("segments", bool(segments), f"{len(segments)} segments")

    if segments:
        well_formed = all(
            isinstance(s.get("start"), (int, float))
            and isinstance(s.get("end"), (int, float))
            and s.get("end") >= s.get("start")
            and (s.get("text") or "").strip()
            for s in segments
        )
        add("segment shape", well_formed,
            "every segment has start <= end and non-empty text"
            if well_formed else "a segment has bad timing or empty text")

        ordered = all(
            segments[i]["start"] <= segments[i + 1]["start"]
            for i in range(len(segments) - 1)
        )
        add("segment order", ordered, "segments are in chronological order")

        labelled = [s for s in segments if s.get("speaker")]
        add("speaker labels", len(labelled) == len(segments),
            f"{len(labelled)}/{len(segments)} segments carry a speaker label")

    duration = payload.get("duration")
    if expected_duration and duration:
        # Whisper reports decoded audio length; a second of slack absorbs
        # container-format rounding without letting a wrong file through.
        close = abs(duration - expected_duration) <= 1.0
        add("duration", close,
            f"reported {duration:.1f}s vs {expected_duration:.1f}s locally")
    else:
        add("duration", bool(duration), f"reported {duration}")

    speakers = sorted({s.get("speaker") for s in segments if s.get("speaker")})
    add("speakers found", bool(speakers), ", ".join(speakers) or "none")

    embeddings = payload.get("speaker_embeddings") or {}
    if speakers:
        have = [s for s in speakers if s in embeddings]
        add("embeddings", len(have) == len(speakers),
            f"{len(have)}/{len(speakers)} speakers have an embedding")
        dims = {len(v) for v in embeddings.values() if isinstance(v, list)}
        if dims:
            add("embedding size", dims == {EMBEDDING_DIM},
                f"dimensions {sorted(dims)} (expected {EMBEDDING_DIM})")

    clips = payload.get("speaker_clips") or {}
    if speakers:
        with_audio = [s for s in speakers if clips.get(s)]
        add("speaker clips", bool(with_audio),
            f"{len(with_audio)}/{len(speakers)} speakers have playback clips")

    if expect_phrase:
        found = expect_phrase.lower() in text.lower()
        add("expected phrase", found,
            f"{expect_phrase!r} {'found' if found else 'NOT found'} in transcript")

    return checks


def step_credentials(ctx):
    missing = require(ctx["creds"], *MODAL_KEYS, "HF_TOKEN")
    if missing:
        return missing
    return Outcome(PASS, "Modal tokens and HF_TOKEN present")


def step_audio_present(ctx):
    path = ctx["audio"]
    if not path.exists():
        return Outcome(FAIL, f"No audio file at {path}")
    ctx["duration"] = local_duration(path)
    size_kb = path.stat().st_size / 1024
    detail = f"{path.name} ({size_kb:.0f}KB"
    detail += f", {ctx['duration']:.1f}s)" if ctx["duration"] else ")"
    return Outcome(PASS, detail)


def step_transcribe(ctx):
    export_modal_credentials(ctx["creds"])
    import_pipeline()
    try:
        import modal
        from modal_app import app, transcribe_audio
    except Exception as e:
        return Outcome(FAIL, f"Could not import the Modal app: {e}")

    audio = ctx["audio"]
    print(f"\n  Transcribing {audio.name} on a T4.\n")

    started = time.monotonic()
    try:
        with modal.enable_output():
            with app.run():
                result = transcribe_audio.remote(
                    audio.read_bytes(), audio.name, ctx["min_speakers"]
                )
    except Exception as e:
        from transcribe import _format_modal_error
        return Outcome(FAIL, _format_modal_error(e))
    elapsed = time.monotonic() - started

    checks = check_result(result, ctx.get("duration"), ctx.get("expect"))
    notes = [
        f"{'ok  ' if ok else 'FAIL'} {name} — {detail}".rstrip()
        for name, ok, detail in checks
    ]
    notes.append(f"     round trip {elapsed:.1f}s")
    ctx["text"] = ((result.get("result") or {}).get("text") or "").strip()

    failed = [name for name, ok, _ in checks if not ok]
    if failed:
        return Outcome(FAIL, f"transcription failed {len(failed)} check(s): "
                             + ", ".join(failed), notes=notes)
    return Outcome(PASS, f"transcription is well-formed ({len(checks)} checks)", notes=notes)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("audio", nargs="?", default=DEFAULT_AUDIO, type=Path,
                        help=f"audio file to transcribe (default: {DEFAULT_AUDIO.name})")
    parser.add_argument("--expect", default=None,
                        help="assert this phrase appears in the transcript")
    parser.add_argument("--min-speakers", type=int, default=1,
                        help="minimum speakers to diarize for (default 1)")
    parser.add_argument("--python", metavar="PATH", default=None)
    args = parser.parse_args()

    passthrough = [str(args.audio), "--min-speakers", str(args.min_speakers)]
    if args.expect:
        passthrough += ["--expect", args.expect]
    maybe_reexec(__file__, args.python, passthrough)

    creds = load_credentials()
    print_header("End-to-end transcription smoke test", creds, show_interpreter=True)
    ctx = {
        "creds": creds,
        "env": modal_env(creds),
        "audio": Path(args.audio),
        "min_speakers": args.min_speakers,
        "expect": args.expect,
    }
    steps = [
        ("credentials", step_credentials),
        ("audio file", step_audio_present),
        ("transcribe", step_transcribe),
    ]
    code = run_steps(steps, ctx, print_outcome)
    if ctx.get("text"):
        print(f"\n  Transcript:\n  {ctx['text'][:400]}")
    print_footer(code, "End-to-end transcription works.")
    return code


if __name__ == "__main__":
    sys.exit(main())
