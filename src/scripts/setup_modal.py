#!/usr/bin/env python3
"""Get a Modal workspace ready so the first transcription is not the first build.

This is the expensive, run-once script. On a fresh workspace it:

    1. creates the `huggingface` secret from HF_TOKEN
    2. builds the CUDA image (several minutes, cached afterwards)
    3. downloads whisper + pyannote weights into the whisper-models volume
       and commits them, so later containers start warm

It does NOT `modal deploy`. The app stays ephemeral — transcribe.py keeps calling
`app.run()`, so a pipeline change ships with the desktop app instead of needing a
redeploy in every user's workspace. What "deploying" would have bought here is the
image build and the model download, and both are cached without it.

Safe to re-run. The secret is always recreated (Modal secrets are write-only, so
a stale token cannot be detected any other way), and already-downloaded weights
are skipped by the loaders.

Usage:
    python scripts/setup_modal.py [--skip-prefetch] [--python PATH]

Exit codes: 0 = ready, 1 = failed, 2 = a credential is missing.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    FAIL,
    MODAL_KEYS,
    PASS,
    SECRET_NAME,
    SKIP,
    VOLUME_NAME,
    Outcome,
    clean_cli_error,
    export_modal_credentials,
    import_pipeline,
    load_credentials,
    maybe_reexec,
    modal_env,
    print_footer,
    print_header,
    print_outcome,
    require,
    run_modal_cli,
    run_steps,
)


def step_credentials(ctx):
    missing = require(ctx["creds"], *MODAL_KEYS, "HF_TOKEN")
    if missing:
        return missing
    return Outcome(PASS, "Modal tokens and HF_TOKEN present")


def step_secret(ctx):
    """Always delete and recreate.

    Modal secrets are write-only — the stored value cannot be read back and
    compared against the current HF_TOKEN — so "create if missing" would keep a
    rotated token stale forever. Deleting first costs one extra control-plane
    call and makes rotation automatic.
    """
    env = ctx["env"]
    run_modal_cli(["secret", "delete", SECRET_NAME, "--yes"], env)
    code, stdout, stderr = run_modal_cli(
        ["secret", "create", SECRET_NAME,
         f"HUGGING_FACE_HUB_TOKEN={ctx['creds']['HF_TOKEN'][0]}"],
        env,
    )
    if code != 0:
        return Outcome(FAIL, f"Could not create secret: {clean_cli_error(stderr or stdout)}")
    return Outcome(PASS, f"secret '{SECRET_NAME}' set from the current HF_TOKEN")


def step_prefetch(ctx):
    """Build the image and pull every model into the volume."""
    if ctx["skip_prefetch"]:
        return Outcome(SKIP, "image build and model download skipped (--skip-prefetch)")

    export_modal_credentials(ctx["creds"])
    import_pipeline()
    try:
        import modal
        from modal_app import app, prefetch_models
    except Exception as e:
        return Outcome(FAIL, f"Could not import the Modal app: {e}")

    print("\n  Building the image and downloading models into the volume.")
    print("  On a fresh workspace this takes several minutes and pulls ~3GB.\n")

    try:
        # enable_output surfaces build logs; a cold build is otherwise silent.
        with modal.enable_output():
            with app.run():
                result = prefetch_models.remote()
    except Exception as e:
        from transcribe import _format_modal_error
        return Outcome(FAIL, _format_modal_error(e))

    notes = [
        f"{'ok  ' if s['ok'] else 'FAIL'} {s['name']} ({s['seconds']}s)"
        + (f" {s['error']}" if s["error"] else "")
        for s in result.get("steps", [])
    ]
    vol = result.get("volume") or {}
    notes.append(
        f"volume {VOLUME_NAME}: {vol.get('megabytes_before')}MB → "
        f"{vol.get('megabytes_after')}MB, committed={vol.get('committed')}"
    )

    if not result.get("ok"):
        return Outcome(FAIL, "Some models failed to download", notes=notes)
    return Outcome(PASS, "image built and all models cached in the volume", notes=notes)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--skip-prefetch", action="store_true",
        help="Only create the secret. No container, no build, no download.",
    )
    parser.add_argument("--python", metavar="PATH", default=None)
    args = parser.parse_args()

    maybe_reexec(__file__, args.python, ["--skip-prefetch"] if args.skip_prefetch else [])

    creds = load_credentials()
    print_header("Modal workspace setup", creds, show_interpreter=True)
    ctx = {
        "creds": creds,
        "env": modal_env(creds),
        "skip_prefetch": args.skip_prefetch,
    }
    steps = [
        ("credentials", step_credentials),
        ("secret", step_secret),
        ("image and models", step_prefetch),
    ]
    code = run_steps(steps, ctx, print_outcome)
    print_footer(code, "Workspace is ready. The first transcription will not build anything.")
    return code


if __name__ == "__main__":
    sys.exit(main())
