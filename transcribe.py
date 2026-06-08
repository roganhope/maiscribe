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

    global OUTBOX_DIR
    if args.outbox is not None:
        OUTBOX_DIR = args.outbox
        OUTBOX_DIR.mkdir(parents=True, exist_ok=True)

    from modal_app import app, transcribe_audio

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

    with app.run():
        for file_path, result in zip(valid_files, transcribe_audio.map(bytes_list, name_list)):
            try:
                print(f"[step] Transcribing", flush=True)
                if result["ok"]:
                    out_folder = make_outbox_folder(file_path)
                    json_path = out_folder / f"{file_path.stem}.json"
                    json_path.write_text(
                        json.dumps(result["result"], indent=2, ensure_ascii=False),
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
                    if result.get("traceback"):
                        print(result["traceback"])
            except Exception as exc:
                write_error_log(file_path, str(exc))
                print(f"[error] {file_path.name}: {exc}")


if __name__ == "__main__":
    main()
