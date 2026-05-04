"""
process_workdir.py
──────────────────
Analyses every MP4 in workdir/, groups them by base video name,
renames files to the pipeline-standard  {video_id}_{rendition}.mp4,
captures a thumbnail PNG from the best-quality variant, and updates
the three metadata JSON files under keys/:
  • keys.json        – CENC ClearKey encryption keys
  • mpd_mapping.json – CDN manifest URLs
  • description.json – title, description, language, genre, thumbnail
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
WORKDIR = BASE_DIR / "workdir"
KEYS_DIR = BASE_DIR / "keys"
THUMBNAILS_DIR = BASE_DIR / "assets" / "thumbnails"
CONFIG_PATH = BASE_DIR / "config.json"

CDN_BASE = "https://ott.prashantkadam.in"

# ── Resolution suffix mapping ───────────────────────────────────
RESOLUTION_MAP = {
    "4k":      "2160p",
    "2160":    "2160p",
    "full-hd": "1080p",
    "1080":    "1080p",
    "hd-ready": "720p",
    "720":     "720p",
    "sd":      "360p",
    "360":     "360p",
}

# Known tail patterns (sorted longest first for greedy matching)
RESOLUTION_SUFFIXES = sorted(RESOLUTION_MAP.keys(), key=len, reverse=True)

# ── Clean video-ID and metadata inference ───────────────────────
# Maps raw base names → (clean_id, title, description, genre, language)
VIDEO_NAME_RULES = {
    "101516-video": {
        "id": "pexels_cityscape",
        "title": "Cityscape Aerial",
        "description": "Sweeping aerial footage over a modern cityscape at golden hour.",
        "genre": "Cinematic",
        "language": "en",
    },
    "mixkit-countryside-meadow-4075": {
        "id": "countryside_meadow",
        "title": "Countryside Meadow",
        "description": "Breathtaking aerial view of a lush green meadow bathed in sunlight.",
        "genre": "Nature",
        "language": "en",
    },
    "mixkit-flying-over-a-relaxing-creek-full-of-rock-on-the-51585": {
        "id": "relaxing_creek",
        "title": "Relaxing Creek",
        "description": "Fly over a serene rocky creek winding through untouched nature.",
        "genre": "Nature",
        "language": "en",
    },
    "mixkit-gigantic-field-of-sunflowers-on-a-sunny-day-4881": {
        "id": "sunflower_field",
        "title": "Sunflower Field",
        "description": "A vast golden field of sunflowers swaying in the warm breeze.",
        "genre": "Nature",
        "language": "en",
    },
    "mixkit-going-down-a-curved-highway-through-a-mountain-range-41576": {
        "id": "mountain_highway",
        "title": "Mountain Highway",
        "description": "Cruise down a winding mountain highway through dramatic peaks.",
        "genre": "Travel",
        "language": "en",
    },
    "mixkit-raft-going-slowly-down-a-river-1218": {
        "id": "river_raft",
        "title": "River Raft Journey",
        "description": "A peaceful raft drifting gently down a calm sunlit river.",
        "genre": "Adventure",
        "language": "en",
    },
    "mixkit-small-pink-flowers-1186": {
        "id": "pink_flowers",
        "title": "Pink Flowers",
        "description": "Delicate pink blossoms captured in stunning close-up detail.",
        "genre": "Nature",
        "language": "en",
    },
    "mixkit-stars-in-space-background-1610": {
        "id": "stars_in_space",
        "title": "Stars in Space",
        "description": "A mesmerizing journey drifting through the stars and cosmos.",
        "genre": "Sci-Fi",
        "language": "en",
    },
    "mixkit-stunning-sunset-seen-from-the-sea-4119": {
        "id": "sea_sunset",
        "title": "Sea Sunset",
        "description": "A breathtaking sunset painting the ocean in golden hues.",
        "genre": "Nature",
        "language": "en",
    },
    "mixkit-waterfall-in-forest-2213": {
        "id": "forest_waterfall",
        "title": "Forest Waterfall",
        "description": "A hidden waterfall cascading through a dense green forest.",
        "genre": "Nature",
        "language": "en",
    },
    "mixkit-white-sand-beach-background-1564": {
        "id": "white_sand_beach",
        "title": "White Sand Beach",
        "description": "Pristine white sand beach lapped by crystal-clear turquoise waves.",
        "genre": "Travel",
        "language": "en",
    },
}


def load_json(path):
    """Load a JSON file; return empty dict if missing/corrupt."""
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        return {}


def save_json(path, data):
    """Pretty-print JSON to *path*."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    print(f"   💾 Saved {path.name}")


def parse_filename(stem):
    """
    Split a stem like  mixkit-countryside-meadow-4075-full-hd
    into (base_name, resolution_label).
    """
    lower = stem.lower()
    for suffix in RESOLUTION_SUFFIXES:
        tail = f"-{suffix}"
        if lower.endswith(tail):
            base = stem[: len(stem) - len(tail)]
            return base, RESOLUTION_MAP[suffix]
        tail_underscore = f"_{suffix}"
        if lower.endswith(tail_underscore):
            base = stem[: len(stem) - len(tail_underscore)]
            return base, RESOLUTION_MAP[suffix]
    return stem, None


def auto_video_id(base_name):
    """Derive a clean video_id from a raw base name."""
    clean = base_name.lower()
    clean = re.sub(r"^mixkit-", "", clean)
    # Strip trailing Mixkit / Pexels numeric IDs
    clean = re.sub(r"-\d{3,}$", "", clean)
    clean = re.sub(r"[^a-z0-9]+", "_", clean).strip("_")
    # Shorten excessively long IDs
    parts = clean.split("_")
    if len(parts) > 4:
        clean = "_".join(parts[:4])
    return clean


def auto_metadata(base_name):
    """Return metadata dict from VIDEO_NAME_RULES or generate one."""
    if base_name in VIDEO_NAME_RULES:
        return dict(VIDEO_NAME_RULES[base_name])

    video_id = auto_video_id(base_name)
    title = video_id.replace("_", " ").title()
    return {
        "id": video_id,
        "title": title,
        "description": f"Enjoy {title} — a premium visual experience in high definition.",
        "genre": "Cinematic",
        "language": "en",
    }


def group_workdir_files():
    """
    Scan workdir/ and group MP4 files by their base video name.
    Returns { base_name: { rendition: Path, ... }, ... }
    """
    groups = {}
    for mp4 in sorted(WORKDIR.glob("*.mp4")):
        base, rendition = parse_filename(mp4.stem)
        if rendition is None:
            print(f"   ⚠️  Cannot determine resolution for {mp4.name}, skipping")
            continue
        groups.setdefault(base, {})[rendition] = mp4
    return groups


def rename_files(groups):
    """
    Rename every file to  {clean_video_id}_{rendition}.mp4 and return a
    new groups dict keyed by clean_video_id.
    """
    renamed = {}
    for base_name, renditions in groups.items():
        meta = auto_metadata(base_name)
        video_id = meta["id"]
        new_renditions = {}
        for rendition, old_path in renditions.items():
            new_name = f"{video_id}_{rendition}.mp4"
            new_path = WORKDIR / new_name
            if old_path != new_path:
                if new_path.exists():
                    print(f"   ⚠️  Target exists, skipping rename: {new_name}")
                    new_renditions[rendition] = old_path
                    continue
                old_path.rename(new_path)
                print(f"   📝 {old_path.name}  →  {new_name}")
            else:
                print(f"   ✅ Already named: {new_name}")
            new_renditions[rendition] = new_path
        renamed[video_id] = {"meta": meta, "files": new_renditions}
    return renamed


def best_quality_file(renditions):
    """Pick the highest-resolution file for thumbnail capture."""
    for pref in ("2160p", "1080p", "720p", "360p"):
        if pref in renditions:
            return renditions[pref]
    return next(iter(renditions.values()))


def capture_thumbnail(video_path, output_png):
    """
    Use ffmpeg to grab a frame at 10% into the video and save as PNG.
    Falls back to the 2-second mark if duration probe fails.
    """
    # Probe duration
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(video_path),
            ],
            capture_output=True, text=True, timeout=30,
        )
        duration = float(result.stdout.strip())
        seek = max(1, duration * 0.10)
    except Exception:
        seek = 2

    output_png.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{seek:.2f}",
        "-i", str(video_path),
        "-frames:v", "1",
        "-vf", "scale=640:-2",
        str(output_png),
    ]

    try:
        subprocess.run(cmd, capture_output=True, timeout=60, check=True)
        print(f"   🖼️  Thumbnail: {output_png.name} ({output_png.stat().st_size // 1024} KB)")
        return True
    except subprocess.CalledProcessError as exc:
        print(f"   ❌ ffmpeg failed for {video_path.name}: {exc.stderr[:200] if exc.stderr else exc}")
        return False
    except FileNotFoundError:
        print("   ❌ ffmpeg not found. Install it or add it to PATH.")
        return False


def update_keys_json(video_ids):
    """Add entries for each new video_id using the same shared CENC key."""
    keys_path = KEYS_DIR / "keys.json"
    keys = load_json(keys_path)

    # Use the existing shared key pair from config.json
    config = load_json(CONFIG_PATH)
    encryption = config.get("encryption", {})
    shared_key_id = encryption.get("key_id", "ed0102030405060708090a0b0c0d0e0f")
    shared_key = encryption.get("key", "f0e0d0c0b0a090807060504030201000")

    added = 0
    for vid in sorted(video_ids):
        if vid not in keys:
            keys[vid] = {"key_id": shared_key_id, "key": shared_key}
            added += 1

    save_json(keys_path, keys)
    print(f"   🔑 keys.json: {added} new entries added ({len(keys)} total)")


def update_mpd_mapping(video_ids):
    """Add CDN manifest URLs for each new video_id."""
    mapping_path = KEYS_DIR / "mpd_mapping.json"
    mapping = load_json(mapping_path)

    added = 0
    for vid in sorted(video_ids):
        if vid not in mapping:
            mapping[vid] = f"{CDN_BASE}/{vid}/manifest.mpd"
            added += 1

    save_json(mapping_path, mapping)
    print(f"   🗺️  mpd_mapping.json: {added} new entries added ({len(mapping)} total)")


def update_description_json(renamed_data):
    """Add rich description entries including language, genre, thumbnail."""
    desc_path = KEYS_DIR / "description.json"
    desc = load_json(desc_path)

    added = 0
    for video_id, data in sorted(renamed_data.items()):
        meta = data["meta"]
        if video_id not in desc:
            desc[video_id] = {
                "title": meta["title"],
                "description": meta["description"],
                "category": meta["genre"],
                "language": meta["language"],
                "genre": meta["genre"],
                "year": "2026",
                "duration": "Preview",
                "thumbnail": f"{CDN_BASE}/{video_id}/thumbnail.png",
            }
            added += 1
        else:
            # Ensure language and genre tags exist on pre-existing entries
            if "language" not in desc[video_id]:
                desc[video_id]["language"] = meta["language"]
            if "genre" not in desc[video_id]:
                desc[video_id]["genre"] = meta["genre"]

    save_json(desc_path, desc)
    print(f"   📄 description.json: {added} new entries added ({len(desc)} total)")


def main():
    print("=" * 60)
    print("  🎬 Workdir Processor — Analyse · Rename · Thumbnail · Meta")
    print("=" * 60)

    if not WORKDIR.exists():
        print(f"❌ Workdir not found: {WORKDIR}")
        return 1

    # ── Step 1: Scan and group ──────────────────────────────────
    print("\n📂 Step 1 — Scanning workdir files...")
    groups = group_workdir_files()
    if not groups:
        print("   ❌ No MP4 files found in workdir/")
        return 1

    print(f"   Found {sum(len(r) for r in groups.values())} files across {len(groups)} video groups:")
    for base, renditions in groups.items():
        res_list = ", ".join(sorted(renditions.keys()))
        print(f"     • {base}  [{res_list}]")

    # ── Step 2: Rename files ────────────────────────────────────
    print("\n📝 Step 2 — Renaming files to pipeline format...")
    renamed = rename_files(groups)

    # ── Step 3: Capture thumbnails ──────────────────────────────
    print("\n🖼️  Step 3 — Capturing thumbnails...")
    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
    for video_id, data in renamed.items():
        best_file = best_quality_file(data["files"])
        thumb_path = THUMBNAILS_DIR / f"{video_id}.png"
        if thumb_path.exists():
            print(f"   ✅ Thumbnail exists: {video_id}.png")
        else:
            capture_thumbnail(best_file, thumb_path)

    # Also save thumbnail.png inside each video's output dir (for CDN serving)
    print("\n📦 Step 3b — Saving CDN thumbnails to output folders...")
    output_root = BASE_DIR / "output"
    for video_id, data in renamed.items():
        out_dir = output_root / video_id
        out_dir.mkdir(parents=True, exist_ok=True)
        cdn_thumb = out_dir / "thumbnail.png"
        asset_thumb = THUMBNAILS_DIR / f"{video_id}.png"
        if asset_thumb.exists() and not cdn_thumb.exists():
            import shutil
            shutil.copy2(asset_thumb, cdn_thumb)
            print(f"   📋 Copied {video_id}.png → output/{video_id}/thumbnail.png")
        elif cdn_thumb.exists():
            print(f"   ✅ CDN thumbnail exists: output/{video_id}/thumbnail.png")

    # ── Step 4: Update metadata JSONs ───────────────────────────
    video_ids = list(renamed.keys())

    print("\n🔑 Step 4a — Updating keys.json...")
    update_keys_json(video_ids)

    print("\n🗺️  Step 4b — Updating mpd_mapping.json...")
    update_mpd_mapping(video_ids)

    print("\n📄 Step 4c — Updating description.json...")
    update_description_json(renamed)

    # ── Summary ─────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  ✅ Processing complete!")
    print(f"     Videos processed : {len(renamed)}")
    print(f"     Renditions total : {sum(len(d['files']) for d in renamed.values())}")
    print("=" * 60)

    print("\n📋 Renamed video inventory:")
    for video_id, data in sorted(renamed.items()):
        meta = data["meta"]
        res_list = ", ".join(sorted(data["files"].keys()))
        print(f"  {video_id:25s}  [{res_list:20s}]  {meta['genre']:12s}  {meta['language']}")

    print("\n💡 Next step: run  python run_package_upload.py --all")
    return 0


if __name__ == "__main__":
    sys.exit(main())
