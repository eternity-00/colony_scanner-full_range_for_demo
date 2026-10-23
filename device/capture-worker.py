#!/usr/bin/env python3
"""Separate image conversion process. It never opens the camera or motor UART."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
spec = importlib.util.spec_from_file_location('capture_local', Path(__file__).with_name('capture-local.py'))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)

output_lock = threading.Lock()

def emit(event, **values):
    with output_lock:
        print(json.dumps({'event': event, **values}, ensure_ascii=False), flush=True)

WORKERS = max(1, min(4, int(os.environ.get('COLONY_PROCESSING_WORKERS', '2'))))
publish_lock = threading.Lock()

def convert(request):
    started = time.time()
    meta = {**request['meta'], 'processingPid': os.getpid(), 'processingStartedAt': started}
    # process_frame publishes latest.json; one frame at a time.
    result = local.process_frame(meta, Path(request['folder']), Path(request['destination']),
                                 request['started'], 'YUYV', publish_lock)
    emit('processed', id=request['id'], result=result)

if __name__ == '__main__':
    # Frames are converted WORKERS at a time (ffmpeg runs outside the GIL); results are
    # reported as they finish, matched by id.
    failed = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        def done(future):
            if future.exception() and not failed:
                failed.append(future.exception())
                emit('failed', error=str(future.exception()))
        for line in sys.stdin:
            if failed:
                break
            pool.submit(convert, json.loads(line)).add_done_callback(done)
    sys.exit(1 if failed else 0)
