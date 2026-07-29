"""Tests for scripts/_common.py — the plumbing every setup script shares."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import _common
from _common import (
    EXIT_FAILED,
    EXIT_MISSING_CREDENTIAL,
    EXIT_OK,
    FAIL,
    PASS,
    SKIP,
    WARN,
    Outcome,
    claude_key,
    classify_modal_failure,
    clean_cli_error,
    load_env_file,
    modal_env,
    parse_env_file,
    parse_workspace,
    require,
    resolve_credentials,
    run_steps,
)


# --- .env parsing (mirrors env.ts getEnvVars) -------------------------------

def test_parse_env_file_basic():
    assert parse_env_file("A=1\nB=2\n") == {"A": "1", "B": "2"}


def test_parse_env_file_skips_blanks_and_comments():
    assert parse_env_file("\n  \n# comment\nA=1\n#B=2\n") == {"A": "1"}


def test_parse_env_file_splits_on_first_equals():
    assert parse_env_file("KEY=a=b=c")["KEY"] == "a=b=c"


def test_parse_env_file_trims_whitespace():
    assert parse_env_file("  KEY  =  value  ") == {"KEY": "value"}


def test_parse_env_file_ignores_lines_without_equals():
    assert parse_env_file("JUSTAKEY\nA=1") == {"A": "1"}


def test_load_env_file_missing_returns_empty(tmp_path):
    assert load_env_file(tmp_path / "nope.env") == {}


def test_load_env_file_reads_real_file(tmp_path):
    path = tmp_path / ".env"
    path.write_text("HF_TOKEN=hf_abc\n", encoding="utf-8")
    assert load_env_file(path) == {"HF_TOKEN": "hf_abc"}


# --- credential precedence --------------------------------------------------

def test_process_env_wins_over_env_file():
    creds = resolve_credentials({"HF_TOKEN": "from_env"}, {"HF_TOKEN": "from_file"})
    assert creds["HF_TOKEN"] == ("from_env", "env")


def test_env_file_used_as_fallback():
    assert resolve_credentials({}, {"HF_TOKEN": "f"})["HF_TOKEN"] == ("f", ".env")


def test_blank_process_env_falls_through_to_file():
    creds = resolve_credentials({"HF_TOKEN": "   "}, {"HF_TOKEN": "f"})
    assert creds["HF_TOKEN"] == ("f", ".env")


def test_absent_credentials_are_omitted():
    assert resolve_credentials({}, {}) == {}


def test_unrelated_env_vars_are_ignored():
    assert set(resolve_credentials({"PATH": "/usr/bin", "HF_TOKEN": "x"}, {})) == {"HF_TOKEN"}


def test_anthropic_key_preferred_over_legacy_claude_key():
    creds = resolve_credentials({"ANTHROPIC_API_KEY": "new", "CLAUDE_API_KEY": "old"}, {})
    assert claude_key(creds) == "new"


def test_legacy_claude_key_used_when_alone():
    assert claude_key(resolve_credentials({"CLAUDE_API_KEY": "old"}, {})) == "old"


def test_claude_key_absent():
    assert claude_key({}) is None


# --- require ----------------------------------------------------------------

def test_require_passes_when_all_present():
    creds = resolve_credentials({"MODAL_TOKEN_ID": "a", "MODAL_TOKEN_SECRET": "b"}, {})
    assert require(creds, "MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET") is None


def test_require_reports_missing_with_credential_exit_code():
    outcome = require({}, "MODAL_TOKEN_ID")
    assert outcome.status == FAIL
    assert outcome.exit_code == EXIT_MISSING_CREDENTIAL
    assert "MODAL_TOKEN_ID" in outcome.message


# --- modal env --------------------------------------------------------------

def test_modal_env_injects_tokens_and_disables_colour():
    creds = resolve_credentials({"MODAL_TOKEN_ID": "a", "MODAL_TOKEN_SECRET": "b"}, {})
    env = modal_env(creds)
    assert env["MODAL_TOKEN_ID"] == "a"
    assert env["MODAL_TOKEN_SECRET"] == "b"
    assert env["NO_COLOR"] == "1"


# --- failure classification -------------------------------------------------

def test_server_error_while_operational_is_reported_verbatim():
    msg = classify_modal_failure(503, None, "operational")
    assert "503" in msg and "incident" not in msg.lower()


def test_server_error_during_incident_blames_modal():
    assert "incident" in classify_modal_failure(503, None, "downtime").lower()


def test_unreachable_while_operational_blames_the_network():
    msg = classify_modal_failure(None, OSError("timed out"), "operational")
    assert "network" in msg.lower() and "incident" not in msg.lower()


def test_unreachable_during_incident_blames_modal():
    assert "incident" in classify_modal_failure(None, OSError("x"), "downtime").lower()


def test_unreachable_with_unreadable_status_page():
    msg = classify_modal_failure(None, OSError("dns failure"), None)
    assert "status.modal.com was also unreachable" in msg


# --- CLI error extraction ---------------------------------------------------

def test_clean_cli_error_unwraps_the_rich_box():
    boxed = (
        "╭───────────────── Error ─────────────────╮\n"
        "│ Token not found                         │\n"
        "╰─────────────────────────────────────────╯\n"
    )
    assert clean_cli_error(boxed) == "Token not found"


def test_clean_cli_error_strips_ansi():
    assert clean_cli_error("\x1b[31mboom\x1b[0m") == "boom"


def test_clean_cli_error_on_empty_input():
    assert clean_cli_error("\n  \n") == ""


# --- workspace parsing ------------------------------------------------------

def test_parse_workspace_strips_id():
    assert parse_workspace("Token: ak-1\nWorkspace: acme-labs (ws-9)\n") == "acme-labs"


def test_parse_workspace_without_id():
    assert parse_workspace("Workspace: acme-labs") == "acme-labs"


def test_parse_workspace_absent():
    assert parse_workspace("Token: ak-123") is None


# --- step runner ------------------------------------------------------------

def _recorder(name, status, order, exit_code=None):
    def step(_ctx):
        order.append(name)
        return Outcome(status, name, exit_code=exit_code)
    return (name, step)


def test_failure_halts_the_remaining_steps():
    order = []
    steps = [
        _recorder("one", PASS, order),
        _recorder("two", FAIL, order),
        _recorder("three", PASS, order),
    ]
    assert run_steps(steps, {}, lambda *_: None) == EXIT_FAILED
    assert order == ["one", "two"]


def test_all_passing_steps_exit_zero():
    order = []
    steps = [_recorder("one", PASS, order), _recorder("two", PASS, order)]
    assert run_steps(steps, {}, lambda *_: None) == EXIT_OK
    assert order == ["one", "two"]


def test_failure_can_override_the_exit_code():
    order = []
    steps = [_recorder("one", FAIL, order, exit_code=EXIT_MISSING_CREDENTIAL)]
    assert run_steps(steps, {}, lambda *_: None) == EXIT_MISSING_CREDENTIAL


def test_warnings_do_not_halt_or_fail():
    order = []
    steps = [_recorder("one", WARN, order), _recorder("two", PASS, order)]
    assert run_steps(steps, {}, lambda *_: None) == EXIT_OK
    assert order == ["one", "two"]


def test_skipped_steps_do_not_halt():
    order = []
    steps = [_recorder("one", SKIP, order), _recorder("two", PASS, order)]
    assert run_steps(steps, {}, lambda *_: None) == EXIT_OK
    assert order == ["one", "two"]


def test_every_step_is_reported():
    reported = []
    order = []
    steps = [_recorder("one", PASS, order), _recorder("two", PASS, order)]
    run_steps(steps, {}, lambda name, outcome: reported.append(name))
    assert reported == ["one", "two"]
