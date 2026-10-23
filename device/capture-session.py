#!/usr/bin/env python3
"""Buffered native acquisition with an independent conversion process.
JSONL stdin: capture(id,readyMonotonic[,fromAlign]), align(id,readyMonotonic[,radius,polarity,expected,maxOffset,
             reference,detect,minShift,overlay]), end.
JSONL stdout: ready, scheduled, acquired, aligned, acquisition-ended, processed, closed, failed.

align: a fresh frame (exposed after readyMonotonic) goes to RAM (COLONY_ALIGN_DIR, default /dev/shm);
the well centre is located with well_center.py and reported as "aligned". The frame is kept so the
next capture may use it (fromAlign = that id) instead of waiting for another exposure. Alignment
frames do not count towards COLONY_CAPTURE_COUNT.
"""
import fcntl
import json
import os
from pathlib import Path
import queue
import re
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from local_agent import CAMERA_LOCK, DEVICE, formats, run
try:
    import well_center	# numpy; checked once at start so a missing dependency never fails a job mid-plate
    ALIGNMENT_ERROR = None
except ImportError as error:
    well_center, ALIGNMENT_ERROR = None, 'ALIGNMENT_UNAVAILABLE: ' + str(error)

output_lock = threading.Lock()


def align_directory(fallback):
    configured = os.environ.get('COLONY_ALIGN_DIR')
    for candidate in ([configured] if configured else []) + ['/dev/shm']:
        path = Path(candidate)
        if path.is_dir() and os.access(path, os.W_OK):
            return path
    return fallback


def focus_snapshot(source, gray, factor, width, height, dest, name, radius=None):
    """Focus aid: the whole frame (analysis scale) and a 1:1 crop as JPEGs written atomically
    under fixed names, plus a sharpness figure (variance of the Laplacian of the crop; higher =
    sharper, only comparable on the same scene). The focus plane is the agar surface, so the
    crop is chosen inside the well (within 75 % of the rim radius around the frame centre, the
    well being centred first): a colony there if any, otherwise the agar texture near the
    centre. The rim and wall top lie in other planes and are excluded."""
    import numpy as np
    from PIL import Image
    data = np.fromfile(source, dtype=np.uint8).reshape(height, width * 2)[:, 0::2]
    ch, cw = 760, 960
    g = well_center.box_blur(gray, 5)
    gy, gx = np.gradient(g)
    energy = well_center.box_blur(np.hypot(gx, gy), 61)
    h, w = gray.shape
    limit = 0.75 * (radius / factor if radius else 0.45 * h)
    yy, xx = np.mgrid[0:h, 0:w]
    inside = np.hypot(xx - w / 2, yy - h / 2) <= limit
    energy = np.where(inside, energy, -1.0)
    margin_y, margin_x = ch // (2 * factor) + 2, cw // (2 * factor) + 2
    inner = energy[margin_y:-margin_y, margin_x:-margin_x]
    py, px = np.unravel_index(int(np.argmax(inner)), inner.shape)
    cy, cx = (py + margin_y) * factor, (px + margin_x) * factor
    y0 = int(min(max(cy - ch // 2, 0), height - ch))
    x0 = int(min(max(cx - cw // 2, 0), width - cw))
    crop = data[y0:y0 + ch, x0:x0 + cw]
    c = crop.astype(np.float32)
    lap = c[1:-1, 1:-1] * 4 - c[:-2, 1:-1] - c[2:, 1:-1] - c[1:-1, :-2] - c[1:-1, 2:]
    sharpness = float(lap.var())
    for suffix, image in (('full', Image.fromarray(np.clip(gray, 0, 255).astype(np.uint8))), ('crop', Image.fromarray(crop))):
        target = dest / f'{name}-{suffix}.jpg'
        temporary = dest / f'.{name}-{suffix}.tmp.jpg'
        image.save(temporary, quality=88)
        temporary.replace(target)
    return {'full': f'{name}-full.jpg', 'crop': f'{name}-crop.jpg', 'sharpness': round(sharpness, 1),
            'crop_box': [x0, y0, cw, ch]}


def locate_well(gray, factor, request, reference=None):
    """Well centre of a decoded frame; a missing well is a result, not a session failure.
    With a reference frame (its decoded luma) the whole-image shift since it is reported as
    well. `detect: false` returns the shift only (calibration probes)."""
    shift = None
    if reference is not None:
        dx, dy, strength = well_center.shift_between(reference, gray, factor, float(request.get('minShift') or 0))
        shift = {'x': dx, 'y': dy, 'strength': strength, 'reference': request.get('reference')}
    if request.get('detect') is False:
        return {'ok': False, 'error': 'DETECTION_SKIPPED', 'shift': shift}
    expected = request.get('expected')
    try:
        result = well_center.detect(gray, factor, radius=request.get('radius'), polarity=request.get('polarity'),
                                    expected=tuple(expected) if expected else None, max_offset=request.get('maxOffset'))
        outcome = {'ok': True, **result}
    except well_center.WellNotFound as error:
        result, outcome = None, {'ok': False, 'error': str(error)}
    if shift is not None:
        outcome['shift'] = shift
    overlay = request.get('overlay')
    if overlay and re.fullmatch(r'[0-9a-f-]{36}-align\.jpg', Path(overlay).name):
        try:
            well_center.overlay(gray, factor, result, overlay)
        except Exception as error:  # diagnostics only
            outcome['overlayError'] = str(error)
    return outcome

def emit(event, **values):
    with output_lock:
        print(json.dumps({'event': event, **values}, ensure_ascii=False), flush=True)

def reply(child, expected):
    if not select.select([child.stdout], [], [], 35)[0]:
        raise RuntimeError('CAMERA_STREAM_TIMEOUT')
    line = child.stdout.readline()
    if not line:
        raise RuntimeError('CAMERA_STREAM_EXITED')
    value = json.loads(line)
    if value.get('event') != expected:
        raise RuntimeError('INVALID_STREAM_REPLY')
    return value

def stop(child):
    if child and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()

def session():
    dest = Path(os.environ.get('COLONY_RECEIVE_DIR', str(Path.home() / 'Pictures' / 'colony-pi')))
    dest.mkdir(parents=True, exist_ok=True)
    CAMERA_LOCK.parent.mkdir(parents=True, exist_ok=True)
    expected = int(os.environ.get('COLONY_CAPTURE_COUNT', '6'))
    capacity = int(os.environ.get('COLONY_CAPTURE_QUEUE_FRAMES', '24'))
    buffers = int(os.environ.get('COLONY_CAMERA_BUFFER_FRAMES', '3'))
    settle = float(os.environ.get('COLONY_CAMERA_SETTLE_MS', '0'))
    # Exposure window after the frame timestamp, "start,end" in ms (measured 2026-10-16:
    # exposure about 500-600 ms after the timestamp; 400,700 keeps margin). "" = legacy.
    window = os.environ.get('COLONY_CAMERA_EXPOSURE_MS', '400,700').strip()
    exposure = tuple(float(x) for x in window.split(',')) if window else None
    if exposure and (len(exposure) != 2 or not 0 <= exposure[0] <= exposure[1] <= 2000):
        raise ValueError('INVALID_EXPOSURE_WINDOW')
    if not 1 <= expected <= capacity <= 96 or not 1 <= buffers <= 8 or not 0 <= settle <= 10000:
        raise ValueError('INVALID_BUFFER_CONFIGURATION')
    with (dest / '.receive.lock').open('a') as receive_lock, CAMERA_LOCK.open('a') as camera_lock:
        for lock in (receive_lock, camera_lock):
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('CAMERA_BUSY')
        sizes = formats().get('YUYV', [])
        if not sizes:
            raise RuntimeError('FORMAT_UNAVAILABLE: YUYV')
        width, height = max(sizes, key=lambda s: s[0] * s[1])
        # Reserve enough disk for the entire plate instead of stalling on conversion.
        if shutil.disk_usage(dest).free < max(256 * 1024 * 1024, width * height * 2 * expected * 3):
            raise RuntimeError('INSUFFICIENT_STORAGE')
        run([f'--set-fmt-video=width={width},height={height},pixelformat=YUYV', '--set-parm=1'])
        actual = run(['--get-fmt-video', '--get-parm'])
        binary = os.environ.get('COLONY_CAMERA_STREAM_BIN', str(Path(__file__).with_name('camera-stream')))
        worker_script = os.environ.get('COLONY_CAPTURE_WORKER_SCRIPT', str(Path(__file__).with_name('capture-worker.py')))
        child = worker = None
        with tempfile.TemporaryDirectory(prefix='.capture-session-', dir=dest) as temporary:
            try:
                worker = subprocess.Popen([sys.executable, worker_script], stdin=subprocess.PIPE,
                                          stdout=subprocess.PIPE, text=True, bufsize=1)
                tasks = queue.Queue(maxsize=capacity + 1)
                worker_errors = []
                def write_tasks():
                    try:
                        while True:
                            task = tasks.get()
                            if task is None:
                                worker.stdin.close()
                                return
                            worker.stdin.write(json.dumps(task) + '\n')
                            worker.stdin.flush()
                    except Exception as error:
                        worker_errors.append(str(error))
                        emit('failed', error='PROCESSING_QUEUE_FAILED: ' + str(error))
                def read_results():
                    try:
                        for line in worker.stdout:
                            event = json.loads(line)
                            if event.get('event') == 'failed':
                                worker_errors.append(event.get('error', 'PROCESSING_FAILED'))
                            emit(event.pop('event'), **event)
                    except Exception as error:
                        worker_errors.append(str(error))
                        emit('failed', error='PROCESSING_REPLY_FAILED: ' + str(error))
                writer = threading.Thread(target=write_tasks, daemon=True)
                reader = threading.Thread(target=read_results, daemon=True)
                writer.start()
                reader.start()
                stream_args = [binary, DEVICE, str(width), str(height), str(buffers), str(settle)]
                if exposure:
                    stream_args += [str(exposure[0]), str(exposure[1])]
                child = subprocess.Popen(stream_args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
                reply(child, 'ready')
                emit('ready', width=width, height=height, bufferCapacity=buffers, processingPid=worker.pid,
                     acquisitionPid=os.getpid(), queueCapacity=capacity,
                     exposureWindowMs=list(exposure) if exposure else None)
                # Requests are pipelined: the stream answers each with "scheduled" at once (when
                # the axis may move again) and later with "frame"; both come back in request order.
                lock = threading.Condition()
                awaiting_schedule, awaiting_frame, stream_errors, ending = [], [], [], []
                def read_stream():
                    try:
                        for line in child.stdout:
                            event = json.loads(line)
                            kind = event.pop('event', None)
                            with lock:
                                if kind == 'scheduled':
                                    request = awaiting_schedule.pop(0)
                                    emit('scheduled', id=request['id'], **event)
                                    continue
                                if kind != 'frame':
                                    raise RuntimeError('INVALID_STREAM_REPLY')
                                request = awaiting_frame.pop(0)
                            source = request['source']
                            if source.stat().st_size != width * height * 2:
                                raise RuntimeError('INCOMPLETE_YUY2_FRAME')
                            if request.get('align'):
                                started = time.monotonic()
                                with lock:
                                    reference = request['request'].get('reference')
                                    ref_gray = aligned[reference][2] if reference in aligned else None
                                if ALIGNMENT_ERROR:
                                    outcome, gray, factor = {'ok': False, 'error': ALIGNMENT_ERROR}, None, None
                                else:
                                    gray, factor = well_center.luma_from_yuy2(source, width, height)
                                    outcome = locate_well(gray, factor, request['request'], ref_gray)
                                    snapshot = request['request'].get('snapshot')
                                    if snapshot and re.fullmatch(r'[a-z][a-z0-9-]{0,30}', str(snapshot)):
                                        outcome['snapshot'] = focus_snapshot(source, gray, factor, width, height, dest, snapshot, request['request'].get('radius'))
                                with lock:
                                    aligned[request['id']] = (source, event, gray, factor)
                                    lock.notify_all()
                                emit('aligned', id=request['id'], frame=event, seconds=round(time.monotonic() - started, 3), **outcome)
                                continue
                            # SHA-256 is computed by the processing process, off the camera path.
                            meta = {'name': source.name, 'bytes': source.stat().st_size,
                                    'width': width, 'height': height, 'sourceFormat': 'YUYV', 'nativeYuy2': True,
                                    'capturedAt': time.time(), 'captureSeconds': round(time.monotonic() - request['started'], 3),
                                    'device': DEVICE, 'v4l2Format': actual, 'continuousStream': True,
                                    'acquisitionPid': os.getpid(), 'processingPid': worker.pid, **event}
                            # This queue is sized for the entire plate; acquisition never waits on conversion.
                            tasks.put_nowait({'id': request['id'], 'meta': meta, 'folder': str(request['folder']),
                                              'destination': str(dest), 'started': request['started']})
                            emit('acquired', id=request['id'], meta=meta)
                            with lock:
                                lock.notify_all()
                    except Exception as error:
                        stream_errors.append(str(error))
                    with lock:
                        stream_errors.append('CAMERA_STREAM_EXITED')
                        lock.notify_all()
                    if not ending:	# the stream died mid-plate: fail the session (main thread cleans up)
                        emit('failed', error='; '.join(stream_errors))
                        os.kill(os.getpid(), signal.SIGTERM)
                stream_reader = threading.Thread(target=read_stream, daemon=True)
                stream_reader.start()
                ids = set()
                aligned = {}	# align id -> (RAM path, frame event, decoded luma, factor); at most the reference and the latest
                align_dir = align_directory(Path(temporary))
                def drop_aligned(keep=None):
                    for key in [k for k in aligned if k != keep]:
                        aligned.pop(key)[0].unlink(missing_ok=True)
                for line in sys.stdin:
                    request = json.loads(line)
                    command = request.get('command')
                    if command == 'align':
                        token = request.get('id', '')
                        reference = request.get('reference')
                        with lock:
                            if stream_errors:
                                raise RuntimeError('CAMERA_STREAM_FAILED: ' + '; '.join(stream_errors))
                            if not re.fullmatch(r'[0-9a-f-]{36}', token) or token in aligned or token in ids:
                                raise ValueError('INVALID_ALIGN_REQUEST')
                            if reference is not None and reference not in aligned:
                                raise ValueError('ALIGN_REFERENCE_UNAVAILABLE')
                            # an alignment frame still crossing USB must not be dropped underneath the reader
                            while any(e.get('align') for e in awaiting_frame) and not stream_errors:
                                if not lock.wait(timeout=35):
                                    raise RuntimeError('CAMERA_STREAM_TIMEOUT')
                            drop_aligned(keep=reference)
                            path = align_dir / ('colony-align-' + token + '.yuy2')
                            path.unlink(missing_ok=True)
                            started = time.monotonic()
                            ready_at = float(request.get('readyMonotonic', started))
                            entry = {'id': token, 'align': True, 'request': request, 'source': path, 'started': started}
                            awaiting_schedule.append(entry)
                            awaiting_frame.append(entry)
                            child.stdin.write(f'{ready_at:.9f} {path}\n')
                            child.stdin.flush()
                        continue
                    if command == 'end':
                        with lock:
                            drop_aligned()
                        ending.append(True)
                        with lock:	# frames still crossing USB belong to this plate
                            while awaiting_frame and not stream_errors:
                                if not lock.wait(timeout=35):
                                    raise RuntimeError('CAMERA_STREAM_TIMEOUT')
                            if awaiting_frame:
                                raise RuntimeError('CAMERA_STREAM_FAILED: ' + '; '.join(stream_errors))
                        child.stdin.close()
                        if child.wait(timeout=5) != 0:
                            raise RuntimeError('CAMERA_STREAM_STOP_FAILED')
                        stream_reader.join(timeout=2)
                        fcntl.flock(camera_lock, fcntl.LOCK_UN)
                        emit('acquisition-ended', at=time.time())
                        tasks.put_nowait(None)
                        code = worker.wait(timeout=360)
                        writer.join(timeout=2)
                        reader.join(timeout=2)
                        if code != 0 or worker_errors or reader.is_alive() or writer.is_alive():
                            raise RuntimeError('PROCESSING_FAILED: ' + '; '.join(worker_errors))
                        emit('closed')
                        return
                    token = request.get('id', '')
                    if command != 'capture' or not re.fullmatch(r'[0-9a-f-]{36}', token) or token in ids or len(ids) >= expected:
                        raise ValueError('INVALID_CAPTURE_REQUEST')
                    ids.add(token)
                    if shutil.disk_usage(dest).free < max(128 * 1024 * 1024, width * height * 2 * 3):
                        raise RuntimeError('INSUFFICIENT_STORAGE')
                    folder = Path(temporary) / token
                    folder.mkdir()
                    source = folder / (token + '.yuy2')
                    started = time.monotonic()
                    ready_at = float(request.get('readyMonotonic', started))
                    reuse = request.get('fromAlign')
                    if reuse:
                        # The frame already judged centred becomes the capture: no further exposure.
                        with lock:
                            if reuse not in aligned:
                                raise ValueError('ALIGN_FRAME_UNAVAILABLE')
                            path, frame = aligned.pop(reuse)[:2]
                        shutil.move(str(path), str(source))
                        if source.stat().st_size != width * height * 2:
                            raise RuntimeError('INCOMPLETE_YUY2_FRAME')
                        meta = {'name': source.name, 'bytes': source.stat().st_size,
                                'width': width, 'height': height, 'sourceFormat': 'YUYV', 'nativeYuy2': True,
                                'capturedAt': time.time(), 'captureSeconds': round(time.monotonic() - started, 3),
                                'device': DEVICE, 'v4l2Format': actual, 'continuousStream': True,
                                'acquisitionPid': os.getpid(), 'processingPid': worker.pid, **frame, 'fromAlign': reuse}
                        tasks.put_nowait({'id': token, 'meta': meta, 'folder': str(folder),
                                          'destination': str(dest), 'started': started})
                        emit('acquired', id=token, meta=meta)
                        continue
                    with lock:
                        if stream_errors:
                            raise RuntimeError('CAMERA_STREAM_FAILED: ' + '; '.join(stream_errors))
                        entry = {'id': token, 'folder': folder, 'source': source, 'started': started}
                        awaiting_schedule.append(entry)
                        awaiting_frame.append(entry)
                        child.stdin.write(f'{ready_at:.9f} {source}\n')
                        child.stdin.flush()
                raise RuntimeError('SESSION_CLOSED_WITHOUT_END')
            finally:
                stop(child)
                stop(worker)
                for stale in Path(align_directory(Path(temporary))).glob('colony-align-*.yuy2'):
                    try:
                        stale.unlink()
                    except OSError:
                        pass

if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))
    try:
        session()
    except Exception as error:
        emit('failed', error=str(error))
        sys.exit(1)
