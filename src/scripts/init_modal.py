#!/usr/bin/env python3
"""Run every maiscribe setup check in order, cheapest first.

This is a thin orchestrator. Each stage lives in its own script and is runnable
on its own — that is where the logic and the tests are:

    scripts/check_modal.py    Modal reachable, tokens valid, an app can run
    scripts/check_hf.py       every model in models.json is reachable
    scripts/check_claude.py   Claude API reachable (optional, never fatal)
    scripts/setup_modal.py    secret, image build, model prefetch  [--setup only]
    scripts/health_modal.py   read-only confirmation that it all landed

By default this runs the checks only, so it is fast and changes nothing. Pass
--setup to also build the image and download models, which is the run-once path
for a fresh workspace.

Usage:
    python scripts/init_modal.py           # check everything, change nothing
    python scripts/init_modal.py --setup   # provision a fresh workspace, then verify

Exit codes: 0 = all good, 1 = something is broken, 2 = a credential is missing.
"""

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    EXIT_FAILED,
    EXIT_MISSING_CREDENTIAL,
    EXIT_OK,
)

SCRIPTS_DIR = Path(__file__).resolve().parent


def run_stage(script, args=(), optional=False):
    """Run one stage as a subprocess so its exit code and output stay its own."""
    # flush: our stdout is block-buffered when piped, but the child writes
    # straight to the terminal — without this every banner appears at the end.
    print(f"\n{'=' * 70}\n  {script}\n{'=' * 70}", flush=True)
    proc = subprocess.run([sys.executable, str(SCRIPTS_DIR / script), *args])
    return proc.returncode, optional


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--setup", action="store_true",
        help="Also create the secret, build the image and prefetch models.",
    )
    args = parser.parse_args()

    stages = [("check_modal.py", (), False)]
    if args.setup:
        stages.append(("setup_modal.py", (), False))
    stages += [
        ("check_hf.py", (), False),
        ("health_modal.py", (), False),
        # Summaries are optional; a missing or bad Claude key must not fail setup.
        ("check_claude.py", (), True),
    ]

    worst = EXIT_OK
    for script, script_args, optional in stages:
        code, _ = run_stage(script, script_args, optional)
        if code == EXIT_OK:
            continue
        if optional:
            print(f"\n  (non-fatal: {script} exited {code})")
            continue
        if code == EXIT_MISSING_CREDENTIAL and worst == EXIT_OK:
            worst = EXIT_MISSING_CREDENTIAL
        else:
            worst = EXIT_FAILED
        print(f"\nStopping: {script} exited {code}.")
        return worst

    print("\n" + "=" * 70)
    if args.setup:
        print("  Workspace provisioned and verified. Ready to transcribe.")
    else:
        print("  All checks passed.")
    print("=" * 70)
    return worst


if __name__ == "__main__":
    sys.exit(main())
