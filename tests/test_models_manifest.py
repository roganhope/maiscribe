"""The model manifest is the single source of truth — these tests keep it honest.

Model IDs used to live in three places (modal_app.py, validate-keys.ts,
check-hf-access.mjs). src/scripts/models.json is now the one list the checks read,
so the risk moves from "duplicated" to "silently out of date". These tests fail
when the manifest and the pipeline disagree.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "scripts"))

from _common import MODELS_MANIFEST, load_manifest, load_models

PIPELINE_DIR = Path(__file__).parent.parent / "src" / "scripts"
MODAL_APP_SOURCE = (PIPELINE_DIR / "modal_app.py").read_text(encoding="utf-8")


def test_manifest_is_valid_json_with_the_expected_shape():
    manifest = load_manifest()
    assert isinstance(manifest["models"], list)
    assert manifest["models"], "manifest lists no models"
    for entry in manifest["models"]:
        assert entry["repo"], "every model needs a repo"
        assert isinstance(entry.get("gated", False), bool)


def test_every_repo_named_in_source_really_is_in_modal_app():
    """A repo flagged `named_in_source` must actually appear in modal_app.py.

    Repos flagged false are exempt because they are real but never spelled out:
    segmentation-3.0 arrives transitively via speaker-diarization-3.1, and
    faster-whisper resolves the alias `large-v3` to the Systran repo internally.
    The token still needs access to both, which is why they stay in the manifest.
    """
    for entry in load_models():
        if not entry.get("named_in_source"):
            continue
        assert entry["repo"] in MODAL_APP_SOURCE, (
            f"{entry['repo']} is flagged named_in_source but is not in modal_app.py"
        )


def test_repos_flagged_absent_from_source_really_are_absent():
    """Guards the exemption itself: if one of these ever gets named directly, the
    flag is stale and should be corrected rather than silently trusted."""
    for entry in load_models():
        if entry.get("named_in_source"):
            continue
        assert entry["repo"] not in MODAL_APP_SOURCE, (
            f"{entry['repo']} now appears in modal_app.py — set named_in_source: true"
        )


def test_every_model_declares_whether_it_is_named_in_source():
    for entry in load_models():
        assert "named_in_source" in entry, f"{entry['repo']} is missing named_in_source"


def test_whisper_model_name_matches_modal_app():
    name = load_manifest()["whisper_model_name"]
    assert f'"{name}"' in MODAL_APP_SOURCE


def test_every_gated_pyannote_repo_the_pipeline_uses_is_listed():
    """Catches the reverse drift: a repo added to modal_app.py but not the manifest."""
    listed = {e["repo"] for e in load_models()}
    for line in MODAL_APP_SOURCE.splitlines():
        if '"pyannote/' not in line:
            continue
        repo = line.split('"')[1]
        assert repo in listed, f"{repo} is loaded by modal_app.py but missing from the manifest"


def test_all_pyannote_repos_are_marked_gated():
    """They are license-gated on Hugging Face; mismarking one hides a real failure."""
    for entry in load_models():
        if entry["repo"].startswith("pyannote/"):
            assert entry["gated"] is True, f"{entry['repo']} should be marked gated"


def test_manifest_has_no_duplicate_repos():
    repos = [e["repo"] for e in load_models()]
    assert len(repos) == len(set(repos))


def test_manifest_path_resolves():
    assert MODELS_MANIFEST.exists()
    json.loads(MODELS_MANIFEST.read_text(encoding="utf-8"))
