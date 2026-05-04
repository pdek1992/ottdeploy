import os
import json
import subprocess
import sys
import glob

# Resolve base paths
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')


def run_command(command, cwd=None):
    print("\n🚀 Executing command:")
    print(" ".join(command))
    try:
        subprocess.run(command, check=True, cwd=cwd)
    except subprocess.CalledProcessError as e:
        print(f"❌ Command failed: {e}")
        sys.exit(1)


def validate_file(path, description):
    if not os.path.exists(path):
        print(f"❌ Missing {description}: {path}")
        sys.exit(1)


def main():
    print("📦 Starting FREE content packaging (VOD DASH)...")

    # Load config
    if not os.path.exists(CONFIG_PATH):
        print(f"❌ Config file not found: {CONFIG_PATH}")
        sys.exit(1)

    with open(CONFIG_PATH, 'r') as f:
        config = json.load(f)

    # Video ID
    if len(sys.argv) > 1:
        video_id = sys.argv[1]
    else:
        video_id = config.get("video_id", "demo")

    work_dir = os.path.join(BASE_DIR, "workdir")
    output_base_dir = os.path.join(BASE_DIR, config["output_dir"], video_id)

    os.makedirs(output_base_dir, exist_ok=True)

    print(f"📁 Output directory: {output_base_dir}")

    # Build packager command
    packager_command = [
        "packager",
        "--generate_static_mpd",   # ✅ FIXED
        "--segment_duration",
        str(config["segment_duration"]),
        "--mpd_output",
        "manifest.mpd"
    ]

    # Add renditions
    for rendition in config["renditions"]:
        name = rendition["name"]

        input_file = os.path.join(work_dir, f"{video_id}_{name}.mp4")
        validate_file(input_file, f"{name} input file")

        # Create subfolder
        os.makedirs(os.path.join(output_base_dir, name), exist_ok=True)

        # Paths relative to output_base_dir
        video_init = f"{name}/video.mp4"
        video_segments = f"{name}/v_$Number$.m4s"

        audio_init = f"{name}/audio.mp4"
        audio_segments = f"{name}/a_$Number$.m4s"

        # Video stream
        packager_command.append(
            f"input={input_file},stream=video,init_segment={video_init},segment_template={video_segments}"
        )

        # Audio stream
        packager_command.append(
            f"input={input_file},stream=audio,init_segment={audio_init},segment_template={audio_segments}"
        )

    # Run packager
    run_command(packager_command, cwd=output_base_dir)

    # Cleanup temp files
    temp_files = glob.glob(os.path.join(output_base_dir, "packager-tempfile-*"))
    for temp_file in temp_files:
        try:
            os.remove(temp_file)
        except Exception:
            pass

    print("\n✅ Packaging completed successfully!")
    print(f"📄 MPD location: {os.path.join(output_base_dir, 'manifest.mpd')}")


if __name__ == "__main__":
    main()