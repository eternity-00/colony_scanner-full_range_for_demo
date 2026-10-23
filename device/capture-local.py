#!/usr/bin/env python3
"""Capture the local Pi 4 USB camera and prepare full-size processing files."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from local_agent import capture

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def stage(name):
    print(json.dumps({'stage': name}), file=sys.stderr, flush=True)

def run(cmd, **kwargs):
    p = subprocess.run(cmd, capture_output=True, **kwargs)
    if p.returncode:
        raise RuntimeError(p.stderr.decode(errors='replace')[-2000:] or 'COMMAND_FAILED')
    return p.stdout

def process_frame(meta, folder, dest, started, fmt, publish_lock=None):
    name = meta['name']
    w, h = meta['width'], meta['height']
    token = name.rsplit('.', 1)[0]
    source = folder / name
    # The acquisition process leaves hashing to this process (off the camera path);
    # a SHA-256 supplied by the source is still verified.
    source_sha256 = digest(source)
    if source.stat().st_size != meta['bytes'] or meta.get('sha256', source_sha256) != source_sha256:
        raise RuntimeError('CAPTURE_INTEGRITY_FAILED')
    meta = {**meta, 'sha256': source_sha256}
    transfer_seconds = 0
    stage('processing')
    raw = folder / (token + '.yuy2')
    png = folder / (token + '.png')
    preview = folder / (token + '-preview.jpg')
    common = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '2']
    if fmt == 'MJPG':
        probe = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height', '-of', 'json', str(source)], timeout=20))
        info = probe['streams'][0]
        if (info['width'], info['height']) != (w, h):
            raise RuntimeError('DECODE_DIMENSIONS_MISMATCH')
        run(common + ['-i', str(source), '-frames:v', '1', '-vf', 'scale=in_range=full:out_range=limited:out_color_matrix=bt601',
                      '-pix_fmt', 'yuyv422', '-f', 'rawvideo', str(raw)], timeout=60)
    if raw.stat().st_size != w*h*2:
        raise RuntimeError('YUY2_SIZE_MISMATCH')
    raw_input = ['-f', 'rawvideo', '-pixel_format', 'yuyv422', '-video_size', f'{w}x{h}',
                 '-color_range', 'tv', '-colorspace', 'smpte170m', '-i', str(raw)]
    # One decode for both outputs. The preview is scaled from the same RGB image as the PNG
    # (identical to scaling the PNG). PNG compression level 1: same pixels, faster, ~15 % larger.
    run(common + raw_input + ['-filter_complex', 'format=rgb24,split=2[full][small];[small]scale=1280:-2[preview]',
                              '-map', '[full]', '-frames:v', '1', '-compression_level', '1', str(png),
                              '-map', '[preview]', '-frames:v', '1', '-q:v', '2', str(preview)], timeout=60)
    files = {'source': name, 'raw': raw.name, 'image': png.name, 'preview': preview.name,
             'metadata': token + '.json'}
    result = {'ok': True, 'id': token, **meta, 'files': files, 'acquisition': 'local-usb',
              'processingFormat': 'yuyv422', 'rowStride': w*2,
              'colorRange': 'limited', 'colorMatrix': 'bt601',
              'nativeYuy2': fmt == 'YUYV',
              'processingOrigin': 'camera-native' if fmt == 'YUYV' else 'decoded-from-lossy-mjpeg',
              'transferSeconds': transfer_seconds,
              'totalSeconds': round(time.monotonic() - started, 3),
              'processedAt': time.time(),
              'rawSha256': source_sha256 if raw == source else digest(raw), 'rawBytes': raw.stat().st_size,
              'outputDirectory': str(dest)}
    (folder / files['metadata']).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    with publish_lock or contextlib.nullcontext():
        for file in folder.iterdir():
            file.replace(dest / file.name)
        pending = dest / '.latest.json.tmp'
        pending.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        pending.replace(dest / 'latest.json')
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--format', choices=['MJPG', 'YUYV'], default='YUYV')
    args = parser.parse_args()
    dest = Path(os.environ.get('COLONY_RECEIVE_DIR', str(Path.home() / 'Pictures' / 'colony-pi')))
    dest.mkdir(parents=True, exist_ok=True)
    with (dest / '.receive.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('CAPTURE_BUSY')
        if shutil.disk_usage(dest).free < 256 * 1024 * 1024:
            raise RuntimeError('INSUFFICIENT_STORAGE')
        started = time.monotonic()
        stage('capturing')
        with tempfile.TemporaryDirectory(prefix='.capture-local-', dir=dest) as temporary:
            folder = Path(temporary)
            meta = capture({'format': args.format}, directory=folder)
            result = process_frame(meta, folder, dest, started, args.format)
            stage('completed')
            print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
