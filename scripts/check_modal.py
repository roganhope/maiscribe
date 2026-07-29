#!/usr/bin/env python3
"""Check that Modal is reachable and that this machine can create an app.

Four steps, cheapest first:

    1. credentials present
    2. api.modal.com is reachable            (no credentials sent)
    3. the tokens are valid                  (`modal token info`, prints workspace)
    4. an app can actually be created        (ephemeral app.run + a CPU function)

Step 4 is the one worth having. Everything before it is control-plane chatter;
only running a function proves Modal can schedule and execute work for this
account. It uses a bare CPU container on the default image, so it costs
approximately nothing and never touches the transcription image.

Usage:
    python scripts/check_modal.py [--python PATH]

Exit codes: 0 = reachable, 1 = broken, 2 = a credential is missing.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    EXIT_OK,
    FAIL,
    MODAL_API_HOST,
    MODAL_KEYS,
    PASS,
    Outcome,
    classify_modal_failure,
    clean_cli_error,
    export_modal_credentials,
    fetch_modal_status,
    http_get,
    load_credentials,
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


def step_credentials(ctx):
    missing = require(ctx["creds"], *MODAL_KEYS)
    if missing:
        return missing
    return Outcome(PASS, "Modal credentials present")


def step_reachable(ctx):
    """Reachability only — deliberately makes no claim about the tokens.

    `GET /api/v1/apps` returns 200 for bogus credentials and for no Authorization
    header at all, so it can only prove the network path works. (The wizard's
    validateModal in validate-keys.ts treats that same 200 as proof the tokens are
    valid, which is why a wrong token can pass setup.)
    """
    try:
        status, _ = http_get(f"https://{MODAL_API_HOST}/api/v1/apps")
    except Exception as e:
        return Outcome(FAIL, classify_modal_failure(None, e, fetch_modal_status()))
    if status >= 500:
        return Outcome(FAIL, classify_modal_failure(status, None, fetch_modal_status()))
    return Outcome(PASS, "api.modal.com is reachable (tokens not checked yet)")


def step_tokens_valid(ctx):
    code, stdout, stderr = run_modal_cli(["token", "info"], ctx["env"])
    if code != 0:
        detail = clean_cli_error(stderr or stdout) or f"exit {code}"
        return Outcome(
            FAIL,
            f"Modal rejected the tokens: {detail}. "
            "Regenerate them at modal.com/settings/tokens.",
        )
    workspace = parse_workspace(stdout)
    ctx["workspace"] = workspace
    return Outcome(PASS, f"tokens valid (workspace: {workspace or 'unknown'})")


def step_app_can_run(ctx):
    """Create an ephemeral app and execute one trivial function on it."""
    export_modal_credentials(ctx["creds"])
    try:
        import modal
    except ImportError:
        return Outcome(FAIL, "The `modal` package is not installed in this interpreter.")

    try:
        app = modal.App("maiscribe-preflight")

        # serialized=True because this is defined in a function rather than at
        # module scope — modal otherwise refuses to register it. Keeping it local
        # means `import modal` stays lazy, so this module is importable (and
        # testable) on an interpreter that has no modal installed.
        @app.function(serialized=True)
        def ping() -> str:
            return "pong"

        with app.run():
            result = ping.remote()
    except Exception as e:
        return Outcome(FAIL, f"Could not create and run an app: {e}")

    if result != "pong":
        return Outcome(FAIL, f"App ran but returned {result!r} instead of 'pong'.")
    return Outcome(PASS, "an app can be created and a function executed")


def build_steps(skip_run):
    steps = [
        ("credentials", step_credentials),
        ("reachable", step_reachable),
        ("tokens", step_tokens_valid),
    ]
    if not skip_run:
        steps.append(("app can run", step_app_can_run))
    return steps


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--no-run", action="store_true",
        help="Skip step 4. Leaves only control-plane checks; starts no container.",
    )
    parser.add_argument("--python", metavar="PATH", default=None)
    args = parser.parse_args()

    maybe_reexec(__file__, args.python, ["--no-run"] if args.no_run else [])

    creds = load_credentials()
    print_header("Modal reachability check", creds, show_interpreter=True)
    ctx = {"creds": creds, "env": modal_env(creds)}
    code = run_steps(build_steps(args.no_run), ctx, print_outcome)
    print_footer(code, "Modal is reachable and this account can run apps.")
    return code


if __name__ == "__main__":
    sys.exit(main())
