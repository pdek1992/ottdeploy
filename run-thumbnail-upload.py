import os
import shutil
import json
import subprocess

# This script runs from the 'versel' directory
workspace_dir = os.getcwd()
base_dir = os.path.abspath(os.path.join(workspace_dir, ".."))
thumbnails_dir = os.path.join(workspace_dir, "public", "assets", "thumbnails")
output_dir = os.path.join(base_dir, "output")
uploader_script = os.path.join(base_dir, "uploader", "upload_r2.py")

print(f"Base Dir: {base_dir}")
print(f"Thumbnails Dir: {thumbnails_dir}")
print(f"Output Dir: {output_dir}")

if not os.path.exists(output_dir):
    os.makedirs(output_dir)

files = [f for f in os.listdir(thumbnails_dir) if os.path.isfile(os.path.join(thumbnails_dir, f))]
for f in files:
    slug = os.path.splitext(f)[0]
    src = os.path.join(thumbnails_dir, f)
    dst_folder = os.path.join(output_dir, slug)
    
    if not os.path.exists(dst_folder):
        os.makedirs(dst_folder)
        
    dst = os.path.join(dst_folder, "thumbnail.jpeg")
    print(f"Copying {f} to {dst}...")
    shutil.copy(src, dst)
    
    # Run uploader
    print(f"Running uploader for {slug}...")
    try:
        # Use subprocess to run the python script
        result = subprocess.run(["python", uploader_script, slug], capture_output=True, text=True)
        print(result.stdout)
        if result.stderr:
            print(f"Error: {result.stderr}")
    except Exception as e:
        print(f"Failed to run uploader for {slug}: {e}")

print("Done!")
