"""
run_package_upload.py
─────────────────────
Packages all renamed files from workdir/ and uploads them to R2.

Packaging logic  : exact copy from packager/package.py
Upload logic     : exact copy from uploader/upload_r2.py

Usage:
    python run_package_upload.py --all            # process every video in workdir/
    python run_package_upload.py sea_sunset       # single video by id
    python run_package_upload.py --all --dry-run  # preview packaging commands only
    python run_package_upload.py --all --skip-upload  # package but skip R2 upload

Run  python process_workdir.py  first to rename files and capture thumbnails.
"""

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys

import boto3
from botocore.config import Config

# ── Paths ────────────────────────────────────────────────────────
BASE_DIR    = os.path.abspath(os.path.join(os.path.dirname(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')
WORKDIR     = os.path.join(BASE_DIR, 'workdir')
KEYS_DIR    = os.path.join(BASE_DIR, 'keys')

# Rendition names as produced by process_workdir.py
RENDITION_ORDER = ['2160p', '1080p', '720p', '360p']


def find_packager():
    """
    Auto-detect the Shaka Packager binary.
    Priority: packager.exe in project root → packager in PATH.
    """
    # Windows binary downloaded alongside this script
    local_exe = os.path.join(BASE_DIR, 'packager.exe')
    if os.path.exists(local_exe):
        return local_exe
    local_bin = os.path.join(BASE_DIR, 'packager')
    if os.path.exists(local_bin) and not os.path.isdir(local_bin):
        return local_bin
    # Fall back to system PATH
    if shutil.which('packager.exe'):
        return 'packager.exe'
    if shutil.which('packager'):
        return 'packager'
    return None


# ════════════════════════════════════════════════════════════════
#  From packager/package.py  (exact logic, lifted verbatim)
# ════════════════════════════════════════════════════════════════

def run_command(command):
    print(f"Executing: {' '.join(command)}")
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error executing command: {e}")
        sys.exit(1)


def has_audio_track(mp4_path):
    """Return True if the MP4 file contains an audio stream."""
    try:
        result = subprocess.run(
            [
                'ffprobe', '-v', 'quiet',
                '-select_streams', 'a',
                '-show_entries', 'stream=codec_type',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                str(mp4_path),
            ],
            capture_output=True, text=True, timeout=15,
        )
        return bool(result.stdout.strip())
    except Exception:
        return False


def add_silence_to_mp4(mp4_path):
    """Adds a silent audio track to an MP4 if it's missing."""
    if has_audio_track(mp4_path):
        return True

    print(f"   🔇 Adding silence track to {os.path.basename(mp4_path)}...")
    temp_mp4 = mp4_path + ".silent.mp4"
    try:
        # Generate silence and merge with video
        subprocess.run([
            'ffmpeg', '-y', '-i', mp4_path,
            '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-c:v', 'copy', '-c:a', 'aac', '-shortest',
            '-map', '0:v:0', '-map', '1:a:0',
            temp_mp4
        ], check=True, capture_output=True)
        
        # Replace original with the version containing silence
        os.replace(temp_mp4, mp4_path)
        return True
    except subprocess.CalledProcessError as e:
        err = e.stderr.decode() if e.stderr else str(e)
        print(f"   ❌ Failed to add silence to {os.path.basename(mp4_path)}: {err}")
        if os.path.exists(temp_mp4):
            os.remove(temp_mp4)
        return False


def package_video(video_id, config, dry_run=False):
    """
    Exact logic from packager/package.py, adapted to accept video_id
    as a parameter (instead of sys.argv) and support a dry-run flag.
    """
    work_dir        = WORKDIR
    output_base_dir = os.path.abspath(
        os.path.join(BASE_DIR, config['output_dir'], video_id)
    )

    # Ensure destination directory exists
    os.makedirs(output_base_dir, exist_ok=True)

    # ── Locate Shaka Packager binary ───────────────────────────
    packager_bin = find_packager()
    if not packager_bin:
        print("   ❌ Shaka Packager not found.")
        print("      Expected: packager.exe in the project root, or 'packager' in PATH.")
        print("      Download: https://github.com/shaka-project/shaka-packager/releases")
        return False

    packager_command = [
        packager_bin,
        '--generate_static_live_mpd',
        '--segment_duration', str(config['segment_duration']),
        '--mpd_output', 'manifest.mpd'
    ]

    # Build stream descriptors for each rendition
    # Input file name pattern: {video_id}_{rendition_name}.mp4
    # We iterate the renditions actually present in workdir/ for this video_id
    found_renditions = []
    for rendition in config['renditions']:
        res_dir_name = rendition['name']
        input_mp4    = os.path.join(work_dir, f"{video_id}_{res_dir_name}.mp4")

        if not os.path.exists(input_mp4):
            print(f"   ⚠️  Rendition not found, skipping: {os.path.basename(input_mp4)}")
            continue

        # Ensure audio exists (add silence if missing)
        add_silence_to_mp4(input_mp4)

        found_renditions.append(res_dir_name)
        res_dir_abs = os.path.join(output_base_dir, res_dir_name)
        os.makedirs(res_dir_abs, exist_ok=True)

        # Paths are relative to CWD (output_base_dir)
        video_init    = f"{res_dir_name}/video.mp4"
        video_segment = f"{res_dir_name}/v_$Number$.m4s"
        audio_init    = f"{res_dir_name}/audio.mp4"
        audio_segment = f"{res_dir_name}/a_$Number$.m4s"

        packager_command.append(
            f"input={input_mp4},stream=video,output={video_init},segment_template={video_segment}"
        )
        if has_audio_track(input_mp4):
            packager_command.append(
                f"input={input_mp4},stream=audio,output={audio_init},segment_template={audio_segment}"
            )
        else:
            print(f"   ⚠️  Still no audio track in {os.path.basename(input_mp4)}, skipping audio stream")

    if not found_renditions:
        print(f"   ❌ No rendition files found for '{video_id}' in workdir/")
        return False

    # Also check for extra renditions not listed in config (e.g. 2160p, 1080p from process_workdir)
    for extra_res in RENDITION_ORDER:
        if extra_res in [r['name'] for r in config['renditions']]:
            continue  # already handled above
        input_mp4 = os.path.join(work_dir, f"{video_id}_{extra_res}.mp4")
        if not os.path.exists(input_mp4):
            continue

        # Ensure audio exists (add silence if missing)
        add_silence_to_mp4(input_mp4)

        found_renditions.append(extra_res)
        res_dir_abs = os.path.join(output_base_dir, extra_res)
        os.makedirs(res_dir_abs, exist_ok=True)

        video_init    = f"{extra_res}/video.mp4"
        video_segment = f"{extra_res}/v_$Number$.m4s"
        audio_init    = f"{extra_res}/audio.mp4"
        audio_segment = f"{extra_res}/a_$Number$.m4s"

        packager_command.append(
            f"input={input_mp4},stream=video,output={video_init},segment_template={video_segment}"
        )
        if has_audio_track(input_mp4):
            packager_command.append(
                f"input={input_mp4},stream=audio,output={audio_init},segment_template={audio_segment}"
            )
        else:
            print(f"   ⚠️  Still no audio track in {os.path.basename(input_mp4)}, skipping audio stream")

    # Encryption (CENC ClearKey) — same key as keys.json
    encryption = config['encryption']
    if encryption['enabled']:
        packager_command.extend([
            '--enable_raw_key_encryption',
            '--keys', f"key_id={encryption['key_id']}:key={encryption['key']}",
            '--protection_scheme', 'cenc'
        ])

    print(f"\n📦 Packaging into: {output_base_dir}")
    print(f"   Renditions : {', '.join(found_renditions)}")

    if dry_run:
        print(f"   [DRY RUN] {' '.join(packager_command)}")
        return True

    # Copy thumbnail into output dir before uploading
    thumb_src = os.path.join(BASE_DIR, 'assets', 'thumbnails', f"{video_id}.png")
    thumb_dst = os.path.join(output_base_dir, 'thumbnail.png')
    if os.path.exists(thumb_src) and not os.path.exists(thumb_dst):
        shutil.copy2(thumb_src, thumb_dst)
        print(f"   Copied thumbnail.png -> output/{video_id}/")

    try:
        result = subprocess.run(
            packager_command,
            check=True,
            cwd=output_base_dir,
            stderr=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        if result.stdout:
            print(result.stdout[-2000:])  # last 2000 chars of stdout
        # Clean up Shaka temp files (exact cleanup from package.py)
        for temp_file in glob.glob(os.path.join(output_base_dir, 'packager-tempfile-*')):
            try:
                os.remove(temp_file)
            except OSError:
                pass
    except FileNotFoundError:
        print(f"   ❌ Packager binary not executable: {packager_bin}")
        return False
    except subprocess.CalledProcessError as e:
        print(f"   ❌ Shaka Packager exit code {e.returncode}")
        if e.stderr:
            print(f"   STDERR:\n{e.stderr[-3000:]}")
        if e.stdout:
            print(f"   STDOUT:\n{e.stdout[-1000:]}")
        return False

    print(f"   ✅ Packaging success: {video_id}")
    return True


# ════════════════════════════════════════════════════════════════
#  From uploader/upload_r2.py  (exact logic, lifted verbatim)
# ════════════════════════════════════════════════════════════════

def get_content_type(file_path):
    """
    Returns the appropriate MIME type for streaming media files.
    (exact from upload_r2.py, extended with image types for thumbnails)
    """
    if file_path.endswith('.mpd'):
        return 'application/dash+xml'
    if file_path.endswith('.m4s'):
        return 'video/iso.segment'
    if file_path.endswith('.mp4'):
        return 'video/mp4'
    if file_path.endswith('.png'):
        return 'image/png'
    if file_path.endswith('.jpg') or file_path.endswith('.jpeg'):
        return 'image/jpeg'
    if file_path.endswith('.webp'):
        return 'image/webp'
    return 'application/octet-stream'


def upload_folder(local_folder, s3_client, bucket_name, video_id):
    """
    Walks through the local output folder and uploads everything to R2.
    (exact copy from upload_r2.py)
    """
    for root, dirs, files in os.walk(local_folder):
        for filename in files:
            local_path = os.path.join(root, filename)

            # Calculate the key (path in R2)
            # Example: asiacup/360p/v_1.m4s
            relative_path = os.path.relpath(local_path, local_folder)
            s3_key = f"{video_id}/{relative_path.replace(os.sep, '/')}"

            content_type = get_content_type(filename)

            print(f"   Uploading: {s3_key} ({content_type})")

            try:
                s3_client.upload_file(
                    local_path,
                    bucket_name,
                    s3_key,
                    ExtraArgs={'ContentType': content_type}
                )
            except Exception as e:
                print(f"   ❌ Failed to upload {filename}: {e}")
                return False
    return True


def upload_video(video_id, config):
    """
    Exact logic from upload_r2.py main(), adapted to accept video_id
    as a parameter instead of sys.argv.
    """
    r2_config = config['r2_config']

    # Check if placeholders are still present
    if "YOUR_" in r2_config['access_key_id']:
        print("   ⚠️  Please update config.json with your actual R2 credentials!")
        return False

    # Initialize R2 client (S3-compatible)
    s3 = boto3.client(
        's3',
        endpoint_url=r2_config['endpoint_url'],
        aws_access_key_id=r2_config['access_key_id'],
        aws_secret_access_key=r2_config['secret_access_key'],
        config=Config(signature_version='s3v4'),
        region_name='auto'  # R2 uses 'auto'
    )

    local_output_dir = os.path.abspath(
        os.path.join(BASE_DIR, config['output_dir'], video_id)
    )

    if not os.path.exists(local_output_dir):
        print(f"   ❌ Local output folder not found: {local_output_dir}")
        return False

    print(f"   🚀 Starting upload for {video_id} to R2 bucket: {r2_config['bucket_name']}")

    if upload_folder(local_output_dir, s3, r2_config['bucket_name'], video_id):
        print(f"   ✨ Successfully uploaded {video_id} to Cloudflare R2!")

        # Save to keys folder (exact logic from upload_r2.py)
        os.makedirs(KEYS_DIR, exist_ok=True)
        mapping_file = os.path.join(KEYS_DIR, 'mpd_mapping.json')

        mapping = {}
        if os.path.exists(mapping_file):
            try:
                with open(mapping_file, 'r') as mf:
                    mapping = json.load(mf)
            except json.JSONDecodeError:
                pass

        mpd_url = f"https://ott.prashantkadam.in/{video_id}/manifest.mpd"
        mapping[video_id] = mpd_url

        with open(mapping_file, 'w') as mf:
            json.dump(mapping, mf, indent=4)
        print(f"   📝 Appended to keys/mpd_mapping.json: {video_id} -> {mpd_url}")
        return True
    else:
        print(f"   ❌ Upload failed for {video_id}.")
        return False


# ════════════════════════════════════════════════════════════════
#  Discovery helper
# ════════════════════════════════════════════════════════════════

def discover_videos():
    """
    Scan workdir/ for files matching {video_id}_{rendition}.mp4
    and return a sorted list of unique video IDs.
    """
    video_ids = set()
    all_renditions = RENDITION_ORDER + ['360p', '480p']  # also catch config renditions
    for mp4 in glob.glob(os.path.join(WORKDIR, '*.mp4')):
        stem = os.path.splitext(os.path.basename(mp4))[0]
        for res in all_renditions:
            suffix = f"_{res}"
            if stem.endswith(suffix):
                video_ids.add(stem[:-len(suffix)])
                break
        # Also detect config rendition names (e.g. 360p, 720p from config)
    return sorted(video_ids)


# ════════════════════════════════════════════════════════════════
#  CLI
# ════════════════════════════════════════════════════════════════

def parse_args():
    parser = argparse.ArgumentParser(
        description="Package (Shaka) + Upload (R2) pipeline for all workdir videos"
    )
    parser.add_argument(
        'video_id', nargs='?',
        help='Single video ID to process (e.g. sea_sunset)'
    )
    parser.add_argument(
        '--all', action='store_true',
        help='Process every video found in workdir/'
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='Print packaging commands without running them'
    )
    parser.add_argument(
        '--skip-upload', action='store_true',
        help='Package only, skip the R2 upload step'
    )
    return parser.parse_args()


def main():
    args = parse_args()

    if not os.path.exists(CONFIG_PATH):
        print(f"Config file not found at {CONFIG_PATH}")
        sys.exit(1)

    with open(CONFIG_PATH, 'r') as f:
        config = json.load(f)

    print("=" * 60)
    print("  Package + Upload Pipeline")
    print("  Packager : packager/package.py  (exact logic)")
    print("  Uploader : uploader/upload_r2.py (exact logic)")
    print("=" * 60)

    # Determine which videos to process
    all_ids = discover_videos()
    if not all_ids:
        print("No renamed video files found in workdir/")
        print("Run  python process_workdir.py  first.")
        sys.exit(1)

    if args.all:
        video_ids = all_ids
    elif args.video_id:
        if args.video_id not in all_ids:
            print(f"Video '{args.video_id}' not found in workdir/")
            print(f"Available: {', '.join(all_ids)}")
            sys.exit(1)
        video_ids = [args.video_id]
    else:
        if len(all_ids) == 1:
            video_ids = all_ids
        else:
            print(f"Multiple videos found: {', '.join(all_ids)}")
            print("Pass a video_id or use --all")
            sys.exit(1)

    print(f"\nProcessing {len(video_ids)} video(s): {', '.join(video_ids)}\n")

    packaged = 0
    uploaded = 0
    failed   = 0

    for video_id in video_ids:
        print(f"\n{'─' * 50}")
        print(f"  VIDEO: {video_id}")
        print(f"{'─' * 50}")

        # ── Step 1: Package (exact packager/package.py logic) ──
        ok = package_video(video_id, config, dry_run=args.dry_run)
        if not ok:
            failed += 1
            continue
        packaged += 1

        # ── Step 2: Upload (exact uploader/upload_r2.py logic) ─
        if not args.dry_run and not args.skip_upload:
            if upload_video(video_id, config):
                uploaded += 1
            else:
                failed += 1

    # Summary
    print(f"\n{'=' * 60}")
    print(f"  Results  |  Packaged: {packaged}  |  Uploaded: {uploaded}  |  Failed: {failed}")
    print(f"{'=' * 60}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
