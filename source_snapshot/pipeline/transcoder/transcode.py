import os
import json
import subprocess
import sys
import time
import shutil

# Use absolute paths to avoid Windows path resolution issues
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PACKAGE_SCRIPT = os.path.join(BASE_DIR, 'packager', 'package.py')
UPLOAD_SCRIPT = os.path.join(BASE_DIR, 'uploader', 'upload_r2.py')
CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')

def run_command(command):
    print(f"Executing: {' '.join(command)}")
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error executing command: {e}")
        return False
    return True

def transcode_multi_output(input_file, video_id, config):
    """
    Runs a single FFmpeg command to generate all renditions in parallel.
    """
    work_dir = os.path.join(BASE_DIR, 'workdir')
    
    if os.path.exists(work_dir):
        shutil.rmtree(work_dir)
    os.makedirs(work_dir, exist_ok=True)

    final_command = ['ffmpeg', '-y', '-i', input_file]
    
    for r in config['renditions']:
        out_name = f"{video_id}_{r['name']}.mp4"
        out_path = os.path.join(work_dir, out_name)
        
        final_command.extend([
            '-vf', f"scale={r['resolution'].replace('x', ':')}",
            '-c:v', 'libx264',
            '-preset', config.get('preset', 'veryfast'),
            '-b:v', r['bitrate'],
            '-maxrate', r['bitrate'],
            '-bufsize', r['bitrate'],
            '-r', str(config['fps']),
            '-x264-params', f"keyint={config['gop_size']}:min-keyint={config['gop_size']}:no-scenecut=1",
            '-c:a', 'aac',
            '-profile:v', 'main',
            '-level', '4.0',
            '-movflags', '+faststart',
            out_path
        ])

    return run_command(final_command)

def main():
    while True:
        try:
            if not os.path.exists(CONFIG_PATH):
                print(f"Config file not found at {CONFIG_PATH}")
                time.sleep(5)
                continue
                
            with open(CONFIG_PATH, 'r') as f:
                config = json.load(f)
        except Exception as e:
            print(f"Error reading config: {e}")
            time.sleep(5)
            continue

        # Resolve directories to absolute paths
        input_dir = os.path.abspath(os.path.join(BASE_DIR, config['input_dir']))
        success_dir = os.path.abspath(os.path.join(BASE_DIR, config['success_dir']))
        failed_dir = os.path.abspath(os.path.join(BASE_DIR, config['failed_dir']))

        # Ensure all required directories exist
        for d in [input_dir, success_dir, failed_dir]:
            if not os.path.exists(d):
                print(f"Creating directory: {d}")
                os.makedirs(d, exist_ok=True)

        video_extensions = ('.mp4', '.mkv', '.mov', '.avi')
        files = [f for f in os.listdir(input_dir) if f.lower().endswith(video_extensions)]

        if not files:
            # print("Watching input folder...") # Minimal log to avoid noise
            time.sleep(5)
            continue

        for filename in files:
            input_path = os.path.join(input_dir, filename)
            
            # Skip files that are currently being uploaded/copied (check size stability)
            try:
                size1 = os.path.getsize(input_path)
                time.sleep(1)
                size2 = os.path.getsize(input_path)
                if size1 != size2:
                    print(f"File {filename} is still being uploaded, skipping...")
                    continue
            except FileNotFoundError:
                continue

            video_id = os.path.splitext(filename)[0].replace(" ", "_")
            
            print(f"\n🚀 Processing: {filename}...")

            if transcode_multi_output(input_path, video_id, config):
                print(f"✅ Transcoding success: {video_id}")
                
                print(f"📦 Starting Packager...")
                if run_command([sys.executable, PACKAGE_SCRIPT, video_id]):
                    print(f"📝 Packaging success for {video_id}")
                    
                    # Phase 3: Upload to Cloudflare R2
                    print(f"☁️ Uploading to Cloudflare R2...")
                    if run_command([sys.executable, UPLOAD_SCRIPT, video_id]):
                        print(f"✨ Full Pipeline Success: {video_id} is LIVE!")
                        dest_path = os.path.join(success_dir, filename)
                        if os.path.exists(dest_path):
                            dest_path = os.path.join(success_dir, f"{int(time.time())}_{filename}")
                        shutil.move(input_path, dest_path)
                    else:
                        print(f"❌ Upload failed for {video_id}")
                        # Move to success folder anyway if transcoded/packaged? 
                        # Or move to failed to prompt retry? Let's move to failed for safety.
                        shutil.move(input_path, os.path.join(failed_dir, filename))
                else:
                    print(f"❌ Packaging failed for {video_id}")
                    shutil.move(input_path, os.path.join(failed_dir, filename))
            else:
                print(f"❌ Transcoding failed for {video_id}")
                shutil.move(input_path, os.path.join(failed_dir, filename))

if __name__ == "__main__":
    main()
