import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

AUDIO_EXTENSIONS = {".mp3", ".mp4", ".m4a", ".wav", ".flac", ".ogg", ".aac", ".opus"}

OUTBOX_DIR = Path(__file__).parent / "outbox"
INBOX_DIR = Path(__file__).parent / "inbox"


def make_outbox_folder(input_path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder = OUTBOX_DIR / f"{input_path.stem}_{timestamp}"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def write_error_log(file_path: Path, error: str, traceback: str | None = None):
    errors_path = INBOX_DIR / "errors.txt"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [f"[{timestamp}] {file_path.name}", f"  {error}"]
    if traceback:
        for line in traceback.strip().splitlines():
            lines.append(f"    {line}")
    lines.append("")
    with errors_path.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def validate_files(paths: list[Path]) -> tuple[list[Path], list[str]]:
    valid = []
    errors = []
    for p in paths:
        if not p.exists() or not p.is_file():
            errors.append(f"[error] {p.name}: file not found")
        else:
            valid.append(p)
    return valid, errors


def collect_from_folder(folder: Path) -> list[Path]:
    return sorted(
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in AUDIO_EXTENSIONS
    )


def _map_with_errors(
    valid_files: list[Path], bytes_list: list[bytes], name_list: list[str],
    min_speakers: int = 2,
) -> list[tuple[Path, dict]]:
    """Wrap transcribe_audio.map so individual execution errors become error results."""
    from modal_app import transcribe_audio

    results: list[tuple[Path, dict]] = []
    min_speakers_list = [min_speakers] * len(valid_files)
    for file_path, result in zip(valid_files, transcribe_audio.map(bytes_list, name_list, min_speakers_list)):
        results.append((file_path, result))
    return results


def _format_modal_error(exc: Exception) -> str:
    """Extract a user-friendly message from Modal/remote exceptions."""
    msg = str(exc)
    if "GatedRepoError" in msg or "401" in msg:
        return "HuggingFace token is invalid or lacks access to the required model. Update your HF token in Settings."
    if "MODAL_TOKEN" in msg or "AuthError" in msg:
        return "Modal authentication failed. Check your Modal credentials in Settings."
    if "ExecutionError" in msg:
        lines = msg.strip().splitlines()
        for line in reversed(lines):
            line = line.strip()
            if line and not line.startswith("File ") and not line.startswith("Traceback"):
                return f"Remote error: {line}"
    return f"Pipeline error: {msg[:200]}"


def run_enroll(json_path: Path):
    from modal_app import app, enroll_speaker

    data = json.loads(json_path.read_text(encoding="utf-8"))
    embeddings: dict = data.get("speaker_embeddings", {})
    segments: list = data.get("segments", [])

    if not embeddings:
        print("[error] no speaker embeddings found — re-transcribe to generate them")
        sys.exit(1)

    # Group sample lines by speaker — prefer longer, unique lines over short repeats
    by_speaker: dict[str, list[str]] = {}
    seen: dict[str, set] = {}
    for seg in segments:
        spk = seg.get("speaker", "UNKNOWN")
        text = seg["text"].strip()
        if spk not in seen:
            seen[spk] = set()
        if text and text not in seen[spk] and len(text) > 20:
            by_speaker.setdefault(spk, []).append(text)
            seen[spk].add(text)

    # All unlabeled speakers — from segments (not just those with embeddings)
    all_speakers = sorted({
        seg.get("speaker", "UNKNOWN")
        for seg in segments
        if seg.get("speaker", "UNKNOWN").startswith("SPEAKER_")
    })
    already_named = [s for s in embeddings if not s.startswith("SPEAKER_")]

    if already_named:
        print(f"Already recognized: {', '.join(already_named)}")

    if not all_speakers:
        print("All speakers already labeled.")
        return

    # Collect names; track the mapping as we go
    label_map: dict[str, str] = {}
    to_enroll: list[tuple[str, list[float]]] = []
    for speaker in all_speakers:
        print(f"\n--- {speaker} ---")
        for line in by_speaker.get(speaker, [])[:3]:
            print(f'  "{line}"')
        name = input(f"Name for {speaker} (Enter to skip): ").strip()
        if name:
            label_map[speaker] = name
            if speaker in embeddings:
                to_enroll.append((name, embeddings[speaker]))
            else:
                print(f"  (no voice embedding — will rename in JSON but won't auto-recognize in future files)")

    if not to_enroll:
        print("Nothing enrolled.")
        return

    print()
    with app.run():
        for name, emb in to_enroll:
            result = enroll_speaker.remote(name, emb)
            if result["ok"]:
                print(f"[enrolled] {name}")
            else:
                print(f"[error] failed to enroll {name}")

    # Rewrite the JSON with the new speaker labels
    data["segments"] = [
        {**seg, "speaker": label_map.get(seg.get("speaker", ""), seg.get("speaker", "UNKNOWN"))}
        for seg in segments
    ]
    data["speaker_embeddings"] = {
        label_map.get(spk, spk): emb for spk, emb in embeddings.items()
    }
    json_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"[updated] {json_path}")


def run_list_speakers():
    from modal_app import app, list_speakers
    with app.run():
        names = list_speakers.remote()
    if names:
        print("Known speakers:")
        for name in sorted(names):
            print(f"  {name}")
    else:
        print("No speakers enrolled yet.")


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe audio files using Modal + faster-whisper + pyannote diarization"
    )
    parser.add_argument("files", nargs="*", type=Path, help="Audio files to transcribe")
    parser.add_argument(
        "--folder", type=Path, default=None,
        help="Folder of audio files to transcribe",
    )
    parser.add_argument(
        "--enroll", type=Path, metavar="JSON",
        help="Label unknown speakers in a transcription JSON and save to voice repo",
    )
    parser.add_argument(
        "--list-speakers", action="store_true",
        help="List all enrolled speakers in the voice repo",
    )
    parser.add_argument(
        "--enroll-single", nargs=2, metavar=("NAME", "EMBEDDING_JSON"),
        help="Enroll a single speaker by name and JSON-encoded embedding (non-interactive)",
    )
    parser.add_argument(
        "--unenroll", type=str, metavar="NAME",
        help="Remove a speaker from the Modal voice repo",
    )
    parser.add_argument(
        "--summarize", type=Path, metavar="JSON",
        help="Summarize an existing transcription JSON file",
    )
    parser.add_argument(
        "--no-summary", action="store_true",
        help="Skip automatic summarization after transcription",
    )
    parser.add_argument(
        "--audio-handling", choices=["store", "store-and-delete", "delete"],
        default="delete",
        help="What to do with the audio file after processing: store (copy to outbox), store-and-delete (move to outbox), delete (remove)",
    )
    parser.add_argument(
        "--outbox", type=Path, default=None,
        help="Custom output directory (defaults to ./outbox next to this script)",
    )
    parser.add_argument(
        "--min-speakers", type=int, default=2,
        help="Minimum number of speakers to detect (default: 2)",
    )
    args = parser.parse_args()

    if args.summarize is not None:
        if not args.summarize.exists():
            print(f"[error] file not found: {args.summarize}")
            sys.exit(1)
        from summarize import summarize_file
        success = summarize_file(args.summarize)
        sys.exit(0 if success else 1)

    if args.list_speakers:
        run_list_speakers()
        return

    if args.enroll is not None:
        if not args.enroll.exists():
            print(f"[error] file not found: {args.enroll}")
            sys.exit(1)
        run_enroll(args.enroll)
        return

    if args.enroll_single is not None:
        name, embedding_json = args.enroll_single
        import json as _json
        embedding = _json.loads(embedding_json)
        from modal_app import app, enroll_speaker
        with app.run():
            result = enroll_speaker.remote(name, embedding)
            if result["ok"]:
                print(f"[enrolled] {name}")
            else:
                print(f"[error] failed to enroll {name}")
                sys.exit(1)
        return

    if args.unenroll is not None:
        from modal_app import app, unenroll_speaker
        with app.run():
            result = unenroll_speaker.remote(args.unenroll)
            if result["ok"]:
                print(f"[unenrolled] {args.unenroll}")
            else:
                print(f"[error] {result.get('error', 'unknown')}")
                sys.exit(1)
        return

    global OUTBOX_DIR
    if args.outbox is not None:
        OUTBOX_DIR = args.outbox
        OUTBOX_DIR.mkdir(parents=True, exist_ok=True)

    from modal_app import app

    if args.folder is not None:
        if not args.folder.is_dir():
            print(f"[error] not a directory: {args.folder}")
            sys.exit(1)
        file_paths = collect_from_folder(args.folder)
        if not file_paths:
            print(f"[error] no audio files found in {args.folder}")
            sys.exit(1)
        print(f"Found {len(file_paths)} audio file(s) in {args.folder}")
    elif args.files:
        file_paths = args.files
    else:
        parser.print_help()
        sys.exit(1)

    valid_files, errors = validate_files(file_paths)
    for e in errors:
        print(e)

    if not valid_files:
        sys.exit(1)

    bytes_list = [p.read_bytes() for p in valid_files]
    name_list = [p.name for p in valid_files]

    try:
        print("[step] Connecting to Modal", flush=True)
        with app.run():
            print("[step] Transcribing on remote GPU", flush=True)
            results = _map_with_errors(valid_files, bytes_list, name_list, min_speakers=args.min_speakers)
            for file_path, result in results:
                try:
                    print(f"[step] Saving results", flush=True)
                    if result["ok"]:
                        out_folder = make_outbox_folder(file_path)

                        # Save speaker clips
                        clips_data = result["result"].get("speaker_clips", {})
                        if clips_data:
                            import base64
                            clips_dir = out_folder / "speakers"
                            clips_dir.mkdir(exist_ok=True)
                            for speaker_label, clips in clips_data.items():
                                for idx, clip in enumerate(clips, 1):
                                    clip_path = clips_dir / f"{speaker_label}_clip{idx}.wav"
                                    clip_path.write_bytes(base64.b64decode(clip["wav_base64"]))

                        # Strip base64 clip data before saving (clips saved as separate files)
                        result_to_save = {**result["result"]}
                        result_to_save.pop("speaker_clips", None)
                        json_path = out_folder / f"{file_path.stem}.json"
                        json_path.write_text(
                            json.dumps(result_to_save, indent=2, ensure_ascii=False),
                            encoding="utf-8",
                        )
                        if args.audio_handling == 'store':
                            shutil.copy2(file_path, out_folder / file_path.name)
                        elif args.audio_handling == 'store-and-delete':
                            shutil.move(str(file_path), str(out_folder / file_path.name))
                        else:
                            file_path.unlink()
                        speakers = {s.get("speaker") for s in result["result"]["segments"]}
                        unknown = [s for s in speakers if s and s.startswith("SPEAKER_")]
                        label = f" (unknown speakers: {', '.join(sorted(unknown))})" if unknown else ""
                        print(f"[done] {file_path.name} → {out_folder}{label}")
                        if not args.no_summary:
                            print(f"[step] Summarizing", flush=True)
                            from summarize import summarize_file
                            summarize_file(json_path)
                    else:
                        write_error_log(file_path, result["error"], result.get("traceback"))
                        print(f"[error] {file_path.name}: {result['error']}")
                except Exception as exc:
                    write_error_log(file_path, str(exc))
                    print(f"[error] {file_path.name}: {exc}")
    except Exception as exc:
        error_msg = _format_modal_error(exc)
        for file_path in valid_files:
            write_error_log(file_path, error_msg)
        print(f"[error] {error_msg}")


if __name__ == "__main__":
    main()
