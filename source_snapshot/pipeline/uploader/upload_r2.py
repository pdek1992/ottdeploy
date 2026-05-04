import os
import json
import sys
import boto3
from botocore.config import Config

# Standardize path resolution
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')

def get_content_type(file_path):
    """
    Returns the appropriate MIME type for streaming media files.
    """
    if file_path.endswith('.mpd'):
        return 'application/dash+xml'
    if file_path.endswith('.m4s'):
        return 'video/iso.segment'
    if file_path.endswith('.mp4'):
        return 'video/mp4'
    return 'application/octet-stream'

def upload_folder(local_folder, s3_client, bucket_name, video_id):
    """
    Walks through the local output folder and uploads everything to R2.
    """
    for root, dirs, files in os.walk(local_folder):
        for filename in files:
            local_path = os.path.join(root, filename)
            
            # Calculate the key (path in R2)
            # Example: asiacup/360p/v_1.m4s
            relative_path = os.path.relpath(local_path, local_folder)
            s3_key = f"{video_id}/{relative_path.replace(os.sep, '/')}"
            
            content_type = get_content_type(filename)
            
            print(f"   ⬆️ Uploading: {s3_key} ({content_type})")
            
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

def main():
    if not os.path.exists(CONFIG_PATH):
        print(f"Config file not found at {CONFIG_PATH}")
        sys.exit(1)

    with open(CONFIG_PATH, 'r') as f:
        config = json.load(f)

    if len(sys.argv) < 2:
        print("Usage: python upload_r2.py <video_id>")
        sys.exit(1)
        
    video_id = sys.argv[1]
    r2_config = config['r2_config']
    
    # Check if placeholders are still present
    if "YOUR_" in r2_config['access_key_id']:
        print("⚠️ Please update config.json with your actual R2 credentials!")
        sys.exit(1)

    # Initialize R2 client (S3-compatible)
    s3 = boto3.client(
        's3',
        endpoint_url=r2_config['endpoint_url'],
        aws_access_key_id=r2_config['access_key_id'],
        aws_secret_access_key=r2_config['secret_access_key'],
        config=Config(signature_version='s3v4'),
        region_name='auto' # R2 uses 'auto'
    )

    local_output_dir = os.path.abspath(os.path.join(BASE_DIR, config['output_dir'], video_id))

    if not os.path.exists(local_output_dir):
        print(f"❌ Local output folder not found: {local_output_dir}")
        sys.exit(1)

    print(f"🚀 Starting API Upload for {video_id} to R2 bucket: {r2_config['bucket_name']}")
    
    if upload_folder(local_output_dir, s3, r2_config['bucket_name'], video_id):
        print(f"✨ Successfully uploaded {video_id} to Cloudflare R2!")
        
        # Save to keys folder
        keys_dir = os.path.abspath(os.path.join(BASE_DIR, 'keys'))
        os.makedirs(keys_dir, exist_ok=True)
        mapping_file = os.path.join(keys_dir, 'mpd_mapping.json')
        
        mapping = {}
        if os.path.exists(mapping_file):
            try:
                with open(mapping_file, 'r') as mf:
                    mapping = json.load(mf)
            except json.JSONDecodeError:
                pass
                
        # Typically the R2 URL would be https://ott.prashantkadam.in/video_id/manifest.mpd
        mpd_url = f"https://ott.prashantkadam.in/{video_id}/manifest.mpd"
        mapping[video_id] = mpd_url
        
        with open(mapping_file, 'w') as mf:
            json.dump(mapping, mf, indent=4)
        print(f"📝 Appended to keys/mpd_mapping.json: {video_id} -> {mpd_url}")
        
    else:
        print(f"❌ Upload failed.")
        sys.exit(1)

if __name__ == "__main__":
    main()
