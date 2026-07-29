#!/usr/bin/env python3
"""Prove a Modal workspace actually works, by running the real thing on a GPU.

This is the tier between health_modal.py (free, read-only, but only checks that
objects exist) and a real transcription. It runs `verify_setup` on a T4 using the
same image, volume and secret as `transcribe_audio`, so a pass proves the genuine
artifact rather than a lookalike.

Its value is isolation. Six steps run independently, each timed, each exception
caught on its own — so a broken workspace tells you *which* layer broke:

    secret       HUGGING_FACE_HUB_TOKEN reached the container
    gpu          torch sees CUDA, and which device
    ffmpeg       the apt layer survived the build
    whisper      loads on CUDA — the real test of the ctranslate2/cuDNN pin
    diarization  gated access to speaker-diarization-3.1 and segmentation-3.0
    embedding    gated access to pyannote/embedding

Nothing is downloaded that setup_modal.py has not already fetched, and nothing is
written except a volume commit, so this is safe to re-run while debugging.

Usage:
    python scripts/verify_modal.py [--python PATH]

Exit codes: 0 = works, 1 = a layer is broken, 2 = a credential is missing.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    FAIL,
    MODAL_KEYS,
    PASS,
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


def step_credentials(ctx):
    missing = require(ctx["creds"], *MODAL_KEYS, "HF_TOKEN")
    if missing:
        return missing
    return Outcome(PASS, "Modal tokens and HF_TOKEN present")


def format_steps(result):
    """One line per remote step, so a partial failure is readable at a glance."""
    notes = []
    for step in result.get("steps", []):
        marker = "ok  " if step["ok"] else "FAIL"
        detail = step["error"] if not step["ok"] else (step.get("detail") or "")
        notes.append(f"{marker} {step['name']} ({step['seconds']}s) {detail}".rstrip())
    return notes


def step_verify(ctx):
    export_modal_credentials(ctx["creds"])
    import_pipeline()
    try:
        import modal
        from modal_app import app, verify_setup
    except Exception as e:
        return Outcome(FAIL, f"Could not import the Modal app: {e}")

    print("\n  Running verify_setup on a T4. A cold container takes a few minutes.\n")

    try:
        # enable_output surfaces build logs; a cold start is otherwise silent.
        with modal.enable_output():
            with app.run():
                result = verify_setup.remote()
    except Exception as e:
        from transcribe import _format_modal_error
        return Outcome(FAIL, _format_modal_error(e))

    notes = format_steps(result)
    volume = result.get("volume") or {}
    if volume.get("cached_on_entry"):
        notes.append("ok   weights were already cached in the volume on entry")
    else:
        notes.append("--   volume was empty on entry (expected only on a first run)")

    if not result.get("ok"):
        return Outcome(FAIL, "Remote verification reported failures", notes=notes)
    return Outcome(PASS, "image, GPU, ffmpeg and all three models are working", notes=notes)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--python", metavar="PATH", default=None)
    args = parser.parse_args()

    maybe_reexec(__file__, args.python)

    creds = load_credentials()
    print_header("Modal GPU verification", creds, show_interpreter=True)
    ctx = {"creds": creds, "env": modal_env(creds)}
    steps = [
        ("credentials", step_credentials),
        ("gpu verification", step_verify),
    ]
    code = run_steps(steps, ctx, print_outcome)
    print_footer(code, "Workspace verified. Transcription will work.")
    return code


if __name__ == "__main__":
    sys.exit(main())
