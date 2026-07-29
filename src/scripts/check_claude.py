#!/usr/bin/env python3
"""Check that the Claude API is reachable and the key works.

This is local-only. The Claude key never reaches Modal — summarize.py reads it in
the local process — so a failure here means summaries are skipped and nothing
else. Transcription is unaffected.

The probe is a one-token message to the cheapest model. A 400 with valid auth
counts as success: it means the key was accepted and only the payload was
rejected, which cannot happen with the body sent here but is cheap to allow for.

Usage:
    python scripts/check_claude.py [--key API_KEY] [--model MODEL]

Exit codes: 0 = key works, 1 = rejected or unreachable, 2 = no key set.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    EXIT_FAILED,
    EXIT_MISSING_CREDENTIAL,
    EXIT_OK,
    claude_key,
    http_request,
    load_credentials,
)

DEFAULT_MODEL = "claude-haiku-4-5-20251001"
API_URL = "https://api.anthropic.com/v1/messages"


def ping(api_key, model=DEFAULT_MODEL):
    """Return (ok, detail). Sends one token to the cheapest model."""
    body = json.dumps({
        "model": model,
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "hi"}],
    }).encode()
    try:
        status, response = http_request(
            API_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            data=body,
            method="POST",
        )
    except Exception as e:
        return False, f"could not reach api.anthropic.com ({e})"

    if status == 200:
        return True, "key accepted"
    if status == 400:
        # Auth succeeded; only the payload was rejected.
        return True, "key accepted (400 on payload)"
    if status == 401:
        return False, "key rejected — check ANTHROPIC_API_KEY"
    if status == 403:
        return False, "key lacks permission for this model"
    if status == 404:
        return False, f"model {model} not found for this key"
    if status == 429:
        return False, "rate limited — the key is valid but throttled"
    detail = ""
    try:
        detail = json.loads(response).get("error", {}).get("message", "")
    except Exception:
        pass
    return False, f"unexpected response {status}{': ' + detail if detail else ''}"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--key", default=None, help="API key (else env or .env)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="model to probe")
    args = parser.parse_args()

    api_key = args.key or claude_key(load_credentials())
    if not api_key:
        print(
            "No Claude API key. Summarization is optional — transcription works "
            "without it. Set ANTHROPIC_API_KEY to enable summaries."
        )
        return EXIT_MISSING_CREDENTIAL

    print(f"\nClaude API check (model: {args.model})\n")
    ok, detail = ping(api_key, args.model)
    print(f"  {'PASS' if ok else 'FAIL'}  api.anthropic.com — {detail}\n")
    if ok:
        print("Claude API is reachable. Summaries will work.")
        return EXIT_OK
    print("Claude API is not usable. Summaries will be skipped.")
    return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
