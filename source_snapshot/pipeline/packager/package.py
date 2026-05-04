import os
import json
import subprocess
import sys

# Standardize path resolution
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')

def run_command(command):
    print(f"Executing: {' '.join(command)}")
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error executing command: {e}")
        sys.exit(1)

def main():
    if not os.path.exists(CONFIG_PATH):
        print(f"Config file not found at {CONFIG_PATH}")
        sys.exit(1)

    with open(CONFIG_PATH, 'r') as f:
        config = json.load(f)

    if len(sys.argv) < 2:
        video_id = config.get('video_id', 'demo_video')
    else:
        video_id = sys.argv[1]
    
    work_dir = os.path.abspath(os.path.join(BASE_DIR, 'workdir'))
    output_base_dir = os.path.abspath(os.path.join(BASE_DIR, config['output_dir'], video_id))
    
    # Ensure destination directory exists
    os.makedirs(output_base_dir, exist_ok=True)

    packager_command = [
        'packager',
        '--generate_static_live_mpd',
        '--segment_duration', str(config['segment_duration']),
        '--mpd_output', 'manifest.mpd'
    ]

    for rendition in config['renditions']:
        res_dir_name = rendition['name']
        res_dir_abs = os.path.join(output_base_dir, res_dir_name)
        os.makedirs(res_dir_abs, exist_ok=True)
        
        # Absolute path for input rendition
        input_mp4 = os.path.join(work_dir, f"{video_id}_{rendition['name']}.mp4")
        
        if not os.path.exists(input_mp4):
            print(f"❌ Core rendition not found: {input_mp4}")
            sys.exit(1)
        
        # Paths for Shaka: These are relative to the CWD (output_base_dir)
        video_init = f"{res_dir_name}/video.mp4"
        video_segment = f"{res_dir_name}/v_$Number$.m4s"
        
        audio_init = f"{res_dir_name}/audio.mp4"
        audio_segment = f"{res_dir_name}/a_$Number$.m4s"
        
        packager_command.append(
            f"input={input_mp4},stream=video,output={video_init},segment_template={video_segment}"
        )
        
        packager_command.append(
            f"input={input_mp4},stream=audio,output={audio_init},segment_template={audio_segment}"
        )

    # Encryption (CENC)
    encryption = config['encryption']
    if encryption['enabled']:
        packager_command.extend([
            '--enable_raw_key_encryption',
            '--keys', f"label=:key_id={encryption['key_id']}:key={encryption['key']}",
            '--protection_scheme', 'cenc'
        ])

    print(f"📦 Packaging into: {output_base_dir}")
    try:
        subprocess.run(packager_command, check=True, cwd=output_base_dir)
        import glob
        for temp_file in glob.glob(os.path.join(output_base_dir, 'packager-tempfile-*')):
            try:
                os.remove(temp_file)
            except OSError:
                pass
    except subprocess.CalledProcessError as e:
        print(f"❌ Shaka Packager failed: {e}")
        sys.exit(1)

    print(f"✅ Packaging success: {video_id}")

if __name__ == "__main__":
    main()
