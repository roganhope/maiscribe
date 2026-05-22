import argparse
import json
import sys
from pathlib import Path

AUDIO_EXTENSIONS = {".mp3", ".mp4", ".m4a", ".wav", ".flac", ".ogg", ".aac", ".opus"}


def resolve_output_path(input_path: Path, output_dir: Path | None) -> Path:
    if output_dir is not None:
        return output_dir / f"{input_path.stem}.json"
    return input_path.parent / f"{input_path.stem}.json"


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
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXTENSIONS)


def main():
    from modal_app import transcribe_audio

    parser = argparse.ArgumentParser(
        description="Transcribe audio files using Modal + faster-whisper large-v3"
    )
    parser.add_argument("files", nargs="*", type=Path, help="Audio files to transcribe")
    parser.add_argument(
        "--folder", type=Path, default=None,
        help="Folder of audio files to transcribe (all supported formats)",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=None,
        help="Directory for JSON output (default: same directory as each input file)",
    )
    args = parser.parse_args()

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

    if args.output_dir is not None:
        args.output_dir.mkdir(parents=True, exist_ok=True)

    valid_files, errors = validate_files(file_paths)
    for e in errors:
        print(e)

    if not valid_files:
        sys.exit(1)

    # All files are read into memory before dispatching — fine for typical audio file sizes.
    bytes_list = [p.read_bytes() for p in valid_files]
    name_list = [p.name for p in valid_files]

    for file_path, result in zip(valid_files, transcribe_audio.map(bytes_list, name_list)):
        out_path = resolve_output_path(file_path, args.output_dir)
        try:
            if result["ok"]:
                out_path.write_text(json.dumps(result["result"], indent=2, ensure_ascii=False), encoding="utf-8")
                print(f"[done] {file_path.name} → {out_path}")
            else:
                print(f"[error] {file_path.name}: {result['error']}")
        except Exception as exc:
            print(f"[error] {file_path.name}: {exc}")


if __name__ == "__main__":
    main()
