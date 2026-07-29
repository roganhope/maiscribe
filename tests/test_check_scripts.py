"""Tests for the individual check scripts. No network."""

import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import check_claude
import check_hf
import check_modal
from _common import EXIT_MISSING_CREDENTIAL, FAIL, PASS, resolve_credentials


# ---------------------------------------------------------------------------
# check_hf
# ---------------------------------------------------------------------------

def _hf_responses(mapping):
    """Fake http_get keyed by the filename at the end of the URL."""
    def fake(url, headers=None, timeout=None):
        return mapping[url.rsplit("/", 1)[-1]], ""
    return fake


def test_hf_access_granted_on_first_probe_file():
    with patch.object(check_hf, "http_get", _hf_responses({"config.yaml": 200})):
        ok, detail = check_hf.check_model("tok", "pyannote/embedding")
    assert ok
    assert detail == "config.yaml"


def test_hf_falls_through_404_to_the_next_probe_file():
    """A 404 means wrong filename for this repo, not denied access."""
    responses = {"config.yaml": 404, "config.json": 200}
    with patch.object(check_hf, "http_get", _hf_responses(responses)):
        ok, detail = check_hf.check_model("tok", "some/repo")
    assert ok
    assert detail == "config.json"


def test_hf_403_reports_license_acceptance():
    with patch.object(check_hf, "http_get", _hf_responses({"config.yaml": 403})):
        ok, detail = check_hf.check_model("tok", "pyannote/embedding")
    assert not ok
    assert "accept the license" in detail
    assert "pyannote/embedding" in detail


def test_hf_401_reports_bad_token():
    with patch.object(check_hf, "http_get", _hf_responses({"config.yaml": 401})):
        ok, detail = check_hf.check_model("tok", "pyannote/embedding")
    assert not ok
    assert "token rejected" in detail


def test_hf_all_probe_files_404_is_a_failure_not_a_pass():
    responses = {"config.yaml": 404, "config.json": 404, "README.md": 404}
    with patch.object(check_hf, "http_get", _hf_responses(responses)):
        ok, _ = check_hf.check_model("tok", "some/repo")
    assert not ok


def test_hf_network_error_is_reported():
    def boom(*a, **k):
        raise OSError("dns failure")

    with patch.object(check_hf, "http_get", boom):
        ok, detail = check_hf.check_model("tok", "some/repo")
    assert not ok
    assert "dns failure" in detail


def test_hf_checks_every_model_in_the_manifest():
    """The list is data: adding a model must not require touching the script."""
    models = [{"repo": "a/one"}, {"repo": "b/two"}, {"repo": "c/three"}]
    seen = []

    def fake(token, repo, probe_files=None):
        seen.append(repo)
        return True, "config.yaml"

    with patch.object(check_hf, "check_model", fake):
        results = check_hf.check_all("tok", models)
    assert seen == ["a/one", "b/two", "c/three"]
    assert len(results) == 3


def test_hf_result_carries_manifest_metadata():
    models = [{"repo": "a/one", "gated": True, "used_for": "diarization"}]
    with patch.object(check_hf, "check_model", lambda *a, **k: (True, "ok")):
        result = check_hf.check_all("tok", models)[0]
    assert result["gated"] is True
    assert result["used_for"] == "diarization"


# ---------------------------------------------------------------------------
# check_claude
# ---------------------------------------------------------------------------

def _claude_response(status, body=""):
    def fake(url, headers=None, data=None, method="GET", timeout=None):
        return status, body
    return fake


def test_claude_200_is_success():
    with patch.object(check_claude, "http_request", _claude_response(200)):
        ok, _ = check_claude.ping("key")
    assert ok


def test_claude_400_counts_as_a_working_key():
    """Auth succeeded; only the payload was rejected."""
    with patch.object(check_claude, "http_request", _claude_response(400)):
        ok, detail = check_claude.ping("key")
    assert ok
    assert "400" in detail


def test_claude_401_is_a_rejected_key():
    with patch.object(check_claude, "http_request", _claude_response(401)):
        ok, detail = check_claude.ping("key")
    assert not ok
    assert "rejected" in detail


def test_claude_429_reports_throttling_not_a_bad_key():
    with patch.object(check_claude, "http_request", _claude_response(429)):
        ok, detail = check_claude.ping("key")
    assert not ok
    assert "valid but throttled" in detail


def test_claude_unexpected_status_surfaces_the_api_message():
    body = json.dumps({"error": {"message": "overloaded"}})
    with patch.object(check_claude, "http_request", _claude_response(503, body)):
        ok, detail = check_claude.ping("key")
    assert not ok
    assert "overloaded" in detail


def test_claude_network_error_is_reported():
    def boom(*a, **k):
        raise OSError("connection refused")

    with patch.object(check_claude, "http_request", boom):
        ok, detail = check_claude.ping("key")
    assert not ok
    assert "connection refused" in detail


def test_claude_missing_key_exits_with_credential_code():
    with patch.object(check_claude, "load_credentials", dict):
        with patch.object(sys, "argv", ["check_claude.py"]):
            assert check_claude.main() == EXIT_MISSING_CREDENTIAL


# ---------------------------------------------------------------------------
# check_modal
# ---------------------------------------------------------------------------

def test_modal_reachability_claims_nothing_about_tokens():
    with patch.object(check_modal, "http_get", lambda *a, **k: (200, "")):
        outcome = check_modal.step_reachable({"creds": {}})
    assert outcome.status == PASS
    assert "not checked yet" in outcome.message


def test_modal_reachability_sends_no_credentials():
    """GET /api/v1/apps returns 200 unauthenticated, so sending a token would
    create a false sense that this step validated something."""
    seen = {}

    def fake_get(url, headers=None, timeout=None):
        seen["headers"] = headers
        return 200, ""

    with patch.object(check_modal, "http_get", fake_get):
        check_modal.step_reachable({"creds": {}})
    assert not seen["headers"]


def test_modal_reachability_fails_on_server_error():
    with patch.object(check_modal, "http_get", lambda *a, **k: (503, "")):
        with patch.object(check_modal, "fetch_modal_status", lambda: "operational"):
            assert check_modal.step_reachable({"creds": {}}).status == FAIL


def test_modal_token_step_reports_the_workspace():
    stdout = "Token: ak-1\nWorkspace: acme-labs (ws-9)\n"
    with patch.object(check_modal, "run_modal_cli", lambda *a, **k: (0, stdout, "")):
        ctx = {"env": {}}
        outcome = check_modal.step_tokens_valid(ctx)
    assert outcome.status == PASS
    assert "acme-labs" in outcome.message
    assert ctx["workspace"] == "acme-labs"


def test_modal_token_step_unwraps_the_boxed_error():
    boxed = "╭── Error ──╮\n│ Token not found │\n╰──╯"
    with patch.object(check_modal, "run_modal_cli", lambda *a, **k: (1, "", boxed)):
        outcome = check_modal.step_tokens_valid({"env": {}})
    assert outcome.status == FAIL
    assert "Token not found" in outcome.message


def test_modal_missing_credentials_exits_with_credential_code():
    outcome = check_modal.step_credentials({"creds": {}})
    assert outcome.status == FAIL
    assert outcome.exit_code == EXIT_MISSING_CREDENTIAL


def test_modal_no_run_flag_drops_the_app_creation_step():
    """--no-run must leave only control-plane checks; it starts no container."""
    names = [name for name, _ in check_modal.build_steps(skip_run=True)]
    assert "app can run" not in names
    assert [name for name, _ in check_modal.build_steps(skip_run=False)][-1] == "app can run"


def test_modal_credentials_step_passes_when_tokens_present():
    creds = resolve_credentials({"MODAL_TOKEN_ID": "a", "MODAL_TOKEN_SECRET": "b"}, {})
    assert check_modal.step_credentials({"creds": creds}).status == PASS


# ---------------------------------------------------------------------------
# health_modal
# ---------------------------------------------------------------------------

import health_modal  # noqa: E402

VOLUME_LS_JSON = json.dumps([
    {"filename": ".locks", "type": "dir"},
    {"filename": "models--Systran--faster-whisper-large-v3", "type": "dir"},
    {"filename": "CACHEDIR.TAG", "type": "file"},
])


def test_volume_ls_uses_the_lowercase_filename_key():
    """`modal volume ls` returns "filename"; `modal secret list` returns "Name"."""
    names = health_modal._names_from_json(VOLUME_LS_JSON)
    assert "models--Systran--faster-whisper-large-v3" in names
    assert len(names) == 3


def test_secret_list_name_key_still_works():
    stdout = json.dumps([{"Name": "huggingface"}])
    assert health_modal._names_from_json(stdout) == {"huggingface"}


def test_empty_needle_does_not_invent_an_entry():
    """An empty fallback needle is a substring of everything, so it must be
    ignored rather than reported as one nameless entry."""
    assert health_modal._names_from_json("not json at all", "") == set()


def test_substring_fallback_still_applies_for_a_real_needle():
    assert health_modal._names_from_json("garbage huggingface", "huggingface") == {"huggingface"}


def test_cache_dir_name_matches_huggingface_layout():
    assert health_modal._cache_dir_name("Systran/faster-whisper-large-v3") == (
        "models--Systran--faster-whisper-large-v3"
    )


def _health_ctx():
    return {"creds": {}, "env": {}}


def test_cached_weights_passes_when_whisper_is_present():
    with patch.object(health_modal, "run_modal_cli", lambda *a, **k: (0, VOLUME_LS_JSON, "")):
        outcome = health_modal.step_weights_cached(_health_ctx())
    assert outcome.status == PASS


def test_cached_weights_warns_on_an_empty_volume():
    with patch.object(health_modal, "run_modal_cli", lambda *a, **k: (0, "[]", "")):
        outcome = health_modal.step_weights_cached(_health_ctx())
    assert outcome.status == health_modal.WARN
    assert "empty" in outcome.message


def test_cached_weights_warns_when_only_junk_is_present():
    """A volume holding just .locks must not read as populated."""
    junk = json.dumps([{"filename": ".locks", "type": "dir"}])
    with patch.object(health_modal, "run_modal_cli", lambda *a, **k: (0, junk, "")):
        outcome = health_modal.step_weights_cached(_health_ctx())
    assert outcome.status == health_modal.WARN
    assert "download whisper" in outcome.message


def test_missing_secret_is_fatal_and_names_the_fix():
    with patch.object(health_modal, "run_modal_cli", lambda *a, **k: (0, "[]", "")):
        outcome = health_modal.step_secret(_health_ctx())
    assert outcome.status == FAIL
    assert "setup_modal.py" in outcome.message


def test_health_check_never_mutates():
    """Read-only is the whole point of this script: no create, no delete."""
    calls = []

    def fake_cli(args, env, timeout=60):
        calls.append(args)
        return 0, VOLUME_LS_JSON if "ls" in args else '[{"Name": "huggingface"}]', ""

    ctx = _health_ctx()
    with patch.object(health_modal, "run_modal_cli", fake_cli):
        health_modal.step_secret(ctx)
        health_modal.step_volume(ctx)
        health_modal.step_weights_cached(ctx)

    flat = [word for args in calls for word in args]
    assert "create" not in flat
    assert "delete" not in flat
