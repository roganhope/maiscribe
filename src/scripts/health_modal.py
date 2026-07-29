#!/usr/bin/env python3
"""Confirm a Modal workspace is still set up correctly. Read-only.

Answers "is this healthy?" without changing anything and without starting a
container. Every step is a lookup:

    1. credentials present
    2. tokens valid                         (`modal token info`)
    3. secret `huggingface` exists          (existence only — never recreated)
    4. volume `whisper-models` exists
    5. the volume actually holds weights    (`modal volume ls`)

Step 5 is what distinguishes this from the reachability check. A workspace can
have every object in place and still make the user wait five minutes on their
first transcription, because the volume is empty. If it reports empty, run
setup_modal.py.

Being read-only is the point: this is safe to run at any time, including while a
transcription is in flight.

Usage:
    python scripts/health_modal.py [--python PATH]

Exit codes: 0 = healthy, 1 = broken, 2 = a credential is missing.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    FAIL,
    MODAL_KEYS,
    PASS,
    SECRET_NAME,
    VOLUME_NAME,
    WARN,
    Outcome,
    clean_cli_error,
    load_credentials,
    load_models,
    maybe_reexec,
    modal_env,
    parse_workspace,
    print_footer,
    print_header,
    print_outcome,
    require,
    run_modal_cli,
    run_steps,
)


# `modal secret list` uses "Name"; `modal volume ls` uses "filename". Both are
# checked rather than assumed, so a shape change degrades to the substring
# fallback instead of silently reporting an empty workspace.
_NAME_KEYS = ("Name", "name", "Filename", "filename")


def _names_from_json(stdout, fallback_needle=None):
    """Read a list of names out of `modal ... --json`, tolerating shape drift."""
    try:
        names = set()
        for row in json.loads(stdout):
            for key in _NAME_KEYS:
                if key in row:
                    names.add(row[key])
                    break
        if names:
            return names
    except (ValueError, TypeError, AttributeError):
        pass
    if fallback_needle and fallback_needle in stdout:
        return {fallback_needle}
    return set()


def step_credentials(ctx):
    missing = require(ctx["creds"], *MODAL_KEYS)
    if missing:
        return missing
    notes = []
    if "HF_TOKEN" not in ctx["creds"]:
        notes.append("HF_TOKEN not set — transcription will fail at container start")
    return Outcome(PASS, "Modal credentials present", notes=notes)


def step_tokens(ctx):
    code, stdout, stderr = run_modal_cli(["token", "info"], ctx["env"])
    if code != 0:
        detail = clean_cli_error(stderr or stdout) or f"exit {code}"
        return Outcome(FAIL, f"Modal rejected the tokens: {detail}")
    return Outcome(PASS, f"tokens valid (workspace: {parse_workspace(stdout) or 'unknown'})")


def step_secret(ctx):
    code, stdout, stderr = run_modal_cli(["secret", "list", "--json"], ctx["env"])
    if code != 0:
        return Outcome(FAIL, f"Could not list secrets: {clean_cli_error(stderr or stdout)}")
    if SECRET_NAME in _names_from_json(stdout, SECRET_NAME):
        return Outcome(PASS, f"secret '{SECRET_NAME}' exists")
    return Outcome(
        FAIL,
        f"secret '{SECRET_NAME}' is missing — transcription will fail at container "
        "start. Run setup_modal.py.",
    )


def step_volume(ctx):
    code, stdout, stderr = run_modal_cli(["volume", "list", "--json"], ctx["env"])
    if code != 0:
        return Outcome(FAIL, f"Could not list volumes: {clean_cli_error(stderr or stdout)}")
    if VOLUME_NAME in _names_from_json(stdout, VOLUME_NAME):
        return Outcome(PASS, f"volume '{VOLUME_NAME}' exists")
    return Outcome(
        FAIL,
        f"volume '{VOLUME_NAME}' does not exist — run setup_modal.py to create and fill it.",
    )


def _cache_dir_name(repo):
    """huggingface_hub stores `org/name` as `models--org--name`."""
    return "models--" + repo.replace("/", "--")


def step_weights_cached(ctx):
    """The difference between "configured" and "will not make the user wait".

    A workspace can have every object in place and still stall for five minutes on
    the first transcription because the volume is empty. Counting entries is not
    enough — an empty volume with a stray .locks directory would look populated —
    so this looks for the whisper cache directory by name.
    """
    code, stdout, stderr = run_modal_cli(["volume", "ls", VOLUME_NAME, "--json"], ctx["env"])
    if code != 0:
        return Outcome(
            WARN,
            f"Could not list volume contents: {clean_cli_error(stderr or stdout)}",
        )
    entries = _names_from_json(stdout)
    whisper_repo = next(
        (m["repo"] for m in load_models() if m.get("loaded_by") == "_load_whisper"), None
    )
    expected = _cache_dir_name(whisper_repo) if whisper_repo else None

    if expected and expected in entries:
        return Outcome(
            PASS,
            "whisper weights are cached — the first transcription will not download them",
            notes=[f"{len(entries)} entries: " + ", ".join(sorted(entries)[:6])],
        )
    if not entries:
        return Outcome(
            WARN,
            "volume is empty — the first transcription will download ~3GB. "
            "Run setup_modal.py to pre-cache it.",
        )
    return Outcome(
        WARN,
        f"volume has contents but no {expected} — the first transcription will "
        "download whisper. Run setup_modal.py.",
        notes=[", ".join(sorted(entries)[:6])],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--python", metavar="PATH", default=None)
    args = parser.parse_args()

    maybe_reexec(__file__, args.python)

    creds = load_credentials()
    print_header("Modal health check (read-only)", creds, show_interpreter=True)
    ctx = {"creds": creds, "env": modal_env(creds)}
    steps = [
        ("credentials", step_credentials),
        ("tokens", step_tokens),
        ("secret", step_secret),
        ("volume", step_volume),
        ("cached weights", step_weights_cached),
    ]
    code = run_steps(steps, ctx, print_outcome)
    print_footer(code, "Workspace is healthy.")
    return code


if __name__ == "__main__":
    sys.exit(main())
