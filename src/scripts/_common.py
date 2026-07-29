"""Shared plumbing for the maiscribe setup scripts.

Every script in this directory is runnable on its own and reports the same way:
a list of named steps, each PASS/FAIL/WARN/SKIP, halting on the first failure.

Exit codes are uniform across all of them:
    0  everything passed
    1  something is broken
    2  a credential is missing — nothing is broken, setup is just incomplete
"""

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
SRC_DIR = SCRIPTS_DIR.parent
REPO_ROOT = SRC_DIR.parent
# The pipeline (modal_app, transcribe, summarize) lives alongside the scripts.
PIPELINE_DIR = SCRIPTS_DIR
MODELS_MANIFEST = SCRIPTS_DIR / "models.json"

SECRET_NAME = "huggingface"
VOLUME_NAME = "whisper-models"
MODAL_API_HOST = "api.modal.com"
MODAL_STATUS_URL = "https://status.modal.com/index.json"
HTTP_TIMEOUT = 10

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_MISSING_CREDENTIAL = 2

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"
SKIP = "SKIP"

MODAL_KEYS = ("MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET")
CLAUDE_KEYS = ("ANTHROPIC_API_KEY", "CLAUDE_API_KEY")
ALL_KEYS = MODAL_KEYS + ("HF_TOKEN",) + CLAUDE_KEYS


class Outcome:
    """Result of one step. `exit_code` overrides the default failure code."""

    __slots__ = ("status", "message", "exit_code", "notes")

    def __init__(self, status, message, exit_code=None, notes=None):
        self.status = status
        self.message = message
        self.exit_code = exit_code
        self.notes = notes or []

    def __repr__(self):  # pragma: no cover - debugging aid
        return f"Outcome({self.status}, {self.message!r})"


# ---------------------------------------------------------------------------
# Model manifest
# ---------------------------------------------------------------------------

def load_models(path=MODELS_MANIFEST):
    """Read the model manifest. Returns the list of {repo, gated, ...} entries."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data["models"]


def load_manifest(path=MODELS_MANIFEST):
    return json.loads(Path(path).read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

def parse_env_file(text):
    """Parse a .env file the same way the app does (see env.ts getEnvVars)."""
    values = {}
    for line in text.split("\n"):
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        eq = trimmed.find("=")
        if eq == -1:
            continue
        values[trimmed[:eq].strip()] = trimmed[eq + 1:].strip()
    return values


def user_data_dir():
    """Electron's userData directory for this app."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "maiscribe"
    if sys.platform == "win32":
        base = os.environ.get("APPDATA")
        return (Path(base) if base else Path.home()) / "maiscribe"
    base = os.environ.get("XDG_CONFIG_HOME")
    return (Path(base) if base else Path.home() / ".config") / "maiscribe"


def env_file_path():
    return user_data_dir() / ".env"


def load_env_file(path):
    try:
        return parse_env_file(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return {}


def resolve_credentials(process_env, file_vars):
    """Merge credentials, process env winning over the .env file.

    This inverts the app's own precedence (pipeline.ts spreads .env over process.env)
    on purpose: it lets a throwaway workspace be tested with a single inline-env
    command, with no file edits and no risk of clobbering real credentials.

    Returns {key: (value, source)} for non-empty values only.
    """
    resolved = {}
    for key in ALL_KEYS:
        value = (process_env.get(key) or "").strip()
        if value:
            resolved[key] = (value, "env")
            continue
        value = (file_vars.get(key) or "").strip()
        if value:
            resolved[key] = (value, ".env")
    return resolved


def load_credentials():
    return resolve_credentials(os.environ, load_env_file(env_file_path()))


def claude_key(creds):
    """ANTHROPIC_API_KEY wins over the legacy CLAUDE_API_KEY."""
    for key in CLAUDE_KEYS:
        if key in creds:
            return creds[key][0]
    return None


def require(creds, *keys):
    """Return an Outcome describing missing credentials, or None if all present."""
    missing = [k for k in keys if k not in creds]
    if not missing:
        return None
    return Outcome(
        FAIL,
        f"Missing {' and '.join(missing)}. Run the setup wizard, or pass them inline.",
        exit_code=EXIT_MISSING_CREDENTIAL,
    )


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

_ssl_ctx = False  # False = not resolved yet; None = use the interpreter default


def ssl_context():
    """Prefer certifi's CA bundle over the interpreter's default trust store.

    A python.org install whose `Install Certificates.command` was never run has an
    empty trust store, so every HTTPS call fails with CERTIFICATE_VERIFY_FAILED —
    which reads like the model is unreachable rather than like a local setup
    problem. certifi ships with these dependencies, so use it when it is there and
    fall back to the default when it is not.
    """
    global _ssl_ctx
    if _ssl_ctx is not False:
        return _ssl_ctx
    try:
        import ssl

        import certifi
        _ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        _ssl_ctx = None
    return _ssl_ctx


def http_request(url, headers=None, data=None, method="GET", timeout=HTTP_TIMEOUT):
    """Make a request. Returns (status, body). Raises only when unreachable."""
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_context()) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def http_get(url, headers=None, timeout=HTTP_TIMEOUT):
    return http_request(url, headers=headers, timeout=timeout)


def fetch_modal_status():
    """Read Modal's public status page.

    Modal uses BetterStack, not Atlassian Statuspage — the conventional
    /api/v2/status.json redirects to HTML. Returns the aggregate state string
    (e.g. "operational") or None if the page can't be read.
    """
    try:
        status, body = http_get(MODAL_STATUS_URL)
        if status != 200:
            return None
        return json.loads(body)["data"]["attributes"]["aggregate_state"]
    except Exception:
        return None


def classify_modal_failure(status, error, aggregate_state):
    """Turn a failed reachability check into a message that points somewhere useful.

    The status page is only consulted to disambiguate an outage from a local problem.
    It never gates a run: status pages lag incidents, and a stale "operational" must
    not block a check that would otherwise succeed.
    """
    if status is not None:
        if aggregate_state and aggregate_state != "operational":
            return (
                f"Modal returned {status}, and status.modal.com reports "
                f"'{aggregate_state}' — this looks like a Modal incident."
            )
        return f"Modal returned an unexpected {status}."
    if aggregate_state and aggregate_state != "operational":
        return (
            f"Could not reach Modal, and status.modal.com reports '{aggregate_state}' — "
            "this looks like a Modal incident, not your setup."
        )
    if aggregate_state == "operational":
        return (
            f"Could not reach Modal ({error}), but status.modal.com reports all systems "
            "operational — check your network, VPN or proxy."
        )
    return f"Could not reach Modal ({error}), and status.modal.com was also unreachable."


# ---------------------------------------------------------------------------
# Modal CLI
# ---------------------------------------------------------------------------

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_BOX_CHARS = "─│╭╮╰╯━┃┏┓┗┛═║╔╗╚╝┌┐└┘├┤┬┴┼ "


def clean_cli_error(text):
    """Pull the message out of the rich-formatted box the modal CLI prints.

    Errors arrive as `╭── Error ──╮ │ Token not found │ ╰──╯`, so taking the last
    line of stderr yields box-drawing characters rather than the reason.
    """
    for raw in _ANSI_RE.sub("", text).splitlines():
        line = raw.strip().strip(_BOX_CHARS).strip()
        if not line or line.lower() == "error":
            continue
        return line
    return ""


def run_modal_cli(args, env, timeout=60):
    """Invoke the modal CLI under the current interpreter.

    Shelling out rather than using the client library directly matches what
    syncModalSecret already does (validate-keys.ts) and keeps this on public
    surface. It also means a success genuinely proves *this* interpreter works.
    """
    proc = subprocess.run(
        [sys.executable, "-m", "modal", *args],
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return proc.returncode, proc.stdout, proc.stderr


def modal_env(creds):
    env = dict(os.environ)
    for key in MODAL_KEYS:
        if key in creds:
            env[key] = creds[key][0]
    # Keep rich from colouring output we have to parse.
    env["NO_COLOR"] = "1"
    env["TERM"] = "dumb"
    return env


def parse_workspace(stdout):
    """Pull the workspace name out of `modal token info` output."""
    for line in stdout.splitlines():
        if "Workspace:" in line:
            after = line.split("Workspace:", 1)[1].strip()
            return after.split("(")[0].strip() or None
    return None


def import_pipeline():
    """Put the script directory on the path so modal_app / transcribe import."""
    if str(PIPELINE_DIR) not in sys.path:
        sys.path.insert(0, str(PIPELINE_DIR))


def export_modal_credentials(creds):
    """Copy Modal tokens into this process so the modal client library sees them."""
    for key in MODAL_KEYS:
        if key in creds:
            os.environ[key] = creds[key][0]


# ---------------------------------------------------------------------------
# Step runner
# ---------------------------------------------------------------------------

def run_steps(steps, ctx, report):
    """Run steps in order, halting on the first failure. Returns an exit code."""
    for name, fn in steps:
        outcome = fn(ctx)
        report(name, outcome)
        if outcome.status == FAIL:
            return outcome.exit_code if outcome.exit_code is not None else EXIT_FAILED
    return EXIT_OK


def print_outcome(name, outcome):
    print(f"  {outcome.status:<4}  {name} — {outcome.message}")
    for note in outcome.notes:
        print(f"          {note}")


def print_header(title, creds=None, show_interpreter=False):
    print(f"\n{title}")
    if show_interpreter:
        print(f"  interpreter: {sys.executable}")
    path = env_file_path()
    print(f"  env file:    {path}{'' if path.exists() else ' (not found)'}")
    if creds is not None:
        sources = ", ".join(f"{k}={v[1]}" for k, v in creds.items()) or "none found"
        print(f"  credentials: {sources}")
    print("")


def print_footer(code, ok_message):
    print("")
    if code == EXIT_OK:
        print(ok_message)
    elif code == EXIT_MISSING_CREDENTIAL:
        print("Incomplete — a credential is missing. Nothing is broken.")
    else:
        print("Broken. Fix the failure above and re-run.")


# ---------------------------------------------------------------------------
# Interpreter
# ---------------------------------------------------------------------------

def venv_python():
    """The Python the Electron app provisions and spawns (see python-env.ts)."""
    base = user_data_dir() / "python-env" / "venv"
    path = base / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    return path if path.exists() else None


def maybe_reexec(script_path, override=None, passthrough=()):
    """Re-run under the app's venv Python so we exercise the real environment.

    Scripts that only speak HTTP do not need this; the ones that import `modal` do.
    """
    target = Path(override) if override else venv_python()
    if target is None:
        return
    if not target.exists():
        print(f"  {FAIL}  interpreter — {target} does not exist")
        sys.exit(EXIT_FAILED)
    try:
        if target.resolve() == Path(sys.executable).resolve():
            return
    except OSError:
        return
    argv = [str(target), str(Path(script_path).resolve()), *passthrough]
    os.execv(str(target), argv)
