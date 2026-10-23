#!/usr/bin/env python3
"""Local JSON hardware interface for the Colony Scanner app. USB camera has a single flock owner."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(os.environ.get('COLONY_RECEIVE_DIR', '~/Pictures/colony-pi')).expanduser()
CAMERA_LOCK = ROOT / '.camera.lock'
DEVICE = os.environ.get('COLONY_CAMERA_DEVICE', '/dev/video0')

def run(args, timeout=10):
    p = subprocess.run(['v4l2-ctl', '-d', DEVICE] + args, capture_output=True,
                       text=True, timeout=timeout, env={**os.environ, 'LC_ALL': 'C'})
    if p.returncode:
        raise RuntimeError('V4L2_FAILED: ' + (p.stderr or p.stdout)[-1500:])
    return p.stdout

def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def formats():
    text = run(['--list-formats-ext'])
    result = {}
    current = None
    for line in text.splitlines():
        m = re.search(r"\[\d+\]: '([^']+)'", line)
        if m:
            current = m[1]
            result[current] = []
        m = re.search(r'Size: Discrete (\d+)x(\d+)', line)
        if m and current:
            result[current].append(tuple(map(int, m.groups())))
    return result

def capture(args, directory=None):
    root = Path(directory) if directory is not None else ROOT
    fmt = args.get('format', 'YUYV')
    if fmt not in ('MJPG', 'YUYV'):
        raise ValueError('INVALID_FORMAT: MJPG or YUYV required')
    root.mkdir(parents=True, exist_ok=True)
    CAMERA_LOCK.parent.mkdir(parents=True, exist_ok=True)
    with CAMERA_LOCK.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('CAMERA_BUSY')
        sizes = formats().get(fmt, [])
        if not sizes:
            raise RuntimeError('FORMAT_UNAVAILABLE: ' + fmt)
        width, height = max(sizes, key=lambda s: s[0] * s[1])
        if shutil.disk_usage(root).free < width * height * 2 * 3:
            raise RuntimeError('INSUFFICIENT_STORAGE')
        started = time.monotonic()
        run([f'--set-fmt-video=width={width},height={height},pixelformat={fmt}',
             '--set-parm=' + ('5' if fmt == 'MJPG' else '1')])
        actual = run(['--get-fmt-video', '--get-parm'])
        if not re.search(rf'Width/Height\s*:\s*{width}/{height}\b', actual) or f"'{fmt}'" not in actual:
            raise RuntimeError('CAMERA_FORMAT_CHANGED: ' + actual)
        token = str(uuid.uuid4())
        name = token + ('.jpg' if fmt == 'MJPG' else '.yuy2')
        with tempfile.TemporaryDirectory(prefix='.capture-', dir=root) as temporary:
            image = Path(temporary) / name
            try:
                run(['--stream-mmap=2', '--stream-skip=2',
                     '--stream-count=1', '--stream-to=' + str(image)], timeout=30)
            except subprocess.TimeoutExpired:
                raise RuntimeError('CAMERA_TIMEOUT: no complete maximum-resolution ' + fmt + ' frame in 30 seconds')
            size = image.stat().st_size if image.exists() else 0
            if size == 0:
                raise RuntimeError('CAMERA_EMPTY_IMAGE')
            if fmt == 'YUYV' and size != width * height * 2:
                raise RuntimeError('INCOMPLETE_YUY2_FRAME')
            if fmt == 'MJPG':
                with image.open('rb') as stream:
                    first = stream.read(2)
                    stream.seek(-2, 2)
                    last = stream.read(2)
                if first != b'\xff\xd8' or last != b'\xff\xd9':
                    raise RuntimeError('INCOMPLETE_JPEG_FRAME')
            meta = {'name': name, 'bytes': size, 'sha256': sha256(image),
                    'width': width, 'height': height, 'sourceFormat': fmt,
                    'nativeYuy2': fmt == 'YUYV', 'capturedAt': time.time(),
                    'captureSeconds': round(time.monotonic() - started, 3),
                    'device': DEVICE, 'v4l2Format': actual}
            manifest = Path(temporary) / (token + '.json')
            manifest.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
            image.replace(root / name)
            manifest.replace(root / manifest.name)
            return meta

def dispatch(req):
    if not isinstance(req, dict):
        raise ValueError('Request must be a JSON object')
    command = req.get('command')
    if command == 'ping':
        return {'pong': True, 'echo': req.get('args', {})}
    if command == 'status':
        return {'hostname': platform.node(), 'architecture': platform.machine(),
                'cameraCommand': shutil.which('v4l2-ctl'), 'device': DEVICE,
                'imageDirectory': str(ROOT), 'formats': formats()}
    if command == 'capture':
        args = req.get('args', {})
        if not isinstance(args, dict):
            raise ValueError('args must be an object')
        return capture(args)
    if command == 'purge':
        # delete captured frames (and their manifests) by id; ids are the uuid names
        ids = req.get('args', {}).get('ids', [])
        if not isinstance(ids, list) or len(ids) > 100:
            raise ValueError('ids must be a list of at most 100 ids')
        removed = []
        for i in ids:
            if not isinstance(i, str) or not re.fullmatch(r'[0-9a-f-]{36}', i):
                raise ValueError('INVALID_ID: ' + str(i))
            for f in ROOT.glob(i + '.*'):
                f.unlink()
                removed.append(f.name)
        return {'removed': removed}
    if command == 'mcb':
        args = req.get('args', {})
        if not isinstance(args, dict):
            raise ValueError('args must be an object')
        import mcb  # MCB motor board over /dev/serial0 (mcb.py next to this file)
        return mcb.run(args)
    raise ValueError('UNKNOWN_COMMAND: use ping, status, capture, purge or mcb')

def main():
    request = {}
    try:
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536:
            raise ValueError('REQUEST_TOO_LARGE')
        request = json.loads(raw)
        result = dispatch(request)
        output = {'ok': True, 'requestId': request.get('requestId'), 'result': result, 'error': None}
    except Exception as error:
        output = {'ok': False, 'requestId': request.get('requestId') if isinstance(request, dict) else None,
                  'result': None, 'error': {'code': type(error).__name__, 'message': str(error)}}
    print(json.dumps(output, ensure_ascii=False))
    return 0 if output['ok'] else 1

if __name__ == '__main__':
    sys.exit(main())
