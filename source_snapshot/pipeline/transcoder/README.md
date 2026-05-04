# 🎬 Transcoder Module

## Overview
The Transcoder Module is optimized for high-performance parallel processing. It uses a single multi-output FFmpeg command to generate all renditions (360p, 720p) simultaneously, significantly reducing processing time compared to sequential encoding. It is pre-configured for Indian broadcast standards (**25 FPS**).

## Command Explanation
The transcoder uses advanced FFmpeg optimizations:
- **Parallel Renditions**: Uses multiple output streams in one command.
- **Preset veryfast**: Balanced speed/quality tradeoff for real-time ingestion.
- **25 FPS**: Standard frame rate for European/Indian PAL regions.
- **Fixed GOP (150)**: Forces keyframes every 150 frames (6 seconds * 25fps) for seamless DASH adaptation.
- **Dynamic Naming**: Outputs are named `{video_id}_{rendition}.mp4`.
- **Continuity**: Polling loop scans `/input` every 5 seconds for new media.

## Input / Output Structure
- **Input Folder**: Place raw videos here (`input/`).
- **Success Folder**: Archive for processed videos (`success_video/`).
- **Failed Folder**: Destination for failed jobs (`failed_video/`).
- **Work Directory**: Interim files stored in `workdir/` (cleaned after each job).

## Code Flow
1. Reload `config.json` for each loop.
2. Scan `/input` for media files.
3. For each file:
    a. Determine `video_id` from filename.
    b. Execute a single FFmpeg command for all renditions.
    c. Trigger `packager/package.py`.
    d. Move source file based on outcome.

## Configuration Options
- `fps`: Set to 25 (PAL/India).
- `preset`: `veryfast` for high-speed encoding.
- `renditions`: Defined as name, resolution, and bitrate.
