#!/usr/bin/env python3
"""Check that this Hugging Face token can reach every model the pipeline needs.

The model list is data, not code: it lives in `src/pipeline/models.json`. Adding
or swapping a model means editing that file — this script picks it up with no
change here, and `tests/test_models_manifest.py` catches drift between the
manifest and what `modal_app.py` actually loads.

Access is checked by asking for a config file with the token attached. That is a
metadata request: it proves entitlement without downloading any weights, so this
stays fast and free no matter how large the models are.

Usage:
    python scripts/check_hf.py [--token HF_TOKEN] [--models PATH] [--json]

Exit codes: 0 = all reachable, 1 = one or more denied, 2 = no token.
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
    MODELS_MANIFEST,
    http_get,
    load_credentials,
    load_models,
)

# Repos disagree about which of these exists; the first hit wins. A 404 only
# means "wrong filename for this repo", so it must not be read as denial.
PROBE_FILES = ("config.yaml", "config.json", "README.md")


def check_model(token, repo, probe_files=PROBE_FILES):
    """Return (ok, detail) for one repo without downloading weights."""
    last = None
    for filename in probe_files:
        try:
            status, _ = http_get(
                f"https://huggingface.co/{repo}/resolve/main/{filename}",
                headers={"Authorization": f"Bearer {token}"},
            )
        except Exception as e:
            return False, f"network error ({e})"
        if status in (200, 302, 307):
            return True, filename
        if status == 401:
            return False, "token rejected"
        if status == 403:
            return False, f"access denied — accept the license at huggingface.co/{repo}"
        last = status
        if status == 404:
            continue
        return False, f"unexpected response {status}"
    return False, f"could not verify access (last response {last})"


def check_all(token, models):
    results = []
    for entry in models:
        ok, detail = check_model(token, entry["repo"])
        results.append({
            "repo": entry["repo"],
            "gated": entry.get("gated", False),
            "used_for": entry.get("used_for", ""),
            "ok": ok,
            "detail": detail,
        })
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--token", default=None, help="HF token (else HF_TOKEN or .env)")
    parser.add_argument("--models", default=MODELS_MANIFEST, help="path to models.json")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of text")
    args = parser.parse_args()

    token = args.token
    if not token:
        creds = load_credentials()
        token = creds.get("HF_TOKEN", (None,))[0]
    if not token:
        print("No HF token. Pass --token, set HF_TOKEN, or run the setup wizard.")
        return EXIT_MISSING_CREDENTIAL

    models = load_models(args.models)
    results = check_all(token, models)
    all_ok = all(r["ok"] for r in results)

    if args.json:
        print(json.dumps({"ok": all_ok, "models": results}, indent=2))
        return EXIT_OK if all_ok else EXIT_FAILED

    print(f"\nHugging Face model access ({len(models)} models from {Path(args.models).name})\n")
    for r in results:
        marker = "PASS" if r["ok"] else "FAIL"
        gated = " [gated]" if r["gated"] else ""
        print(f"  {marker}  {r['repo']}{gated} — {r['detail']}")
        if r["used_for"]:
            print(f"          used for {r['used_for']}")
    print("")
    if all_ok:
        print("All models reachable with this token.")
        return EXIT_OK
    print("Some models are not reachable. Accept the licenses above, then re-run.")
    return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
