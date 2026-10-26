#!/usr/bin/env python3
"""Whole-image translation between two frames (phase correlation), in pixels of the input images.

Usage: shift_measure.py REF IMG [REF IMG ...]
       shift_measure.py --json          one JSON object per line on stdin: {"ref","img","dx","dy"}
                                        dx, dy = expected content displacement in input pixels (optional)
One JSON line per pair: {"dx", "dy", "strength", "method"} — how far IMG's content moved relative to
REF (positive dx = content moved right). Works on previews; the caller scales to full-resolution pixels.

Phase correlation on whole frames is ambiguous once a shift approaches half the frame (a shift d and
d - N give the same peak), which happens at the 17.5 mm cross offset (about 51 % of the frame height).
With an expected shift the two frames are first cropped to the region they should share and only the
residual is measured (method "crop"); without one, or when that residual is implausibly large, the
whole-frame peak is used and its wrap-around candidate closest to the expectation is chosen
(method "full").
"""
import json
import sys

import numpy as np
from PIL import Image

SIZE = 640
MIN_OVERLAP = 0.25     # of each frame dimension
MAX_RESIDUAL = 0.3     # of the crop size: a larger residual means the expectation was wrong


def load(path):
    im = Image.open(path).convert('L')
    w, h = im.size
    im = im.resize((SIZE, max(1, int(SIZE * h / w))), Image.BILINEAR)
    return np.asarray(im, dtype=np.float32), w / SIZE


def norm(a):
    return (a - a.mean()) / (a.std() + 1e-6)


def peak(a, b):
    """Raw phase-correlation peak (x, y in 0..N-1) of (ref=a, img=b) and its strength."""
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    fa, fb = np.fft.fft2(norm(a) * win), np.fft.fft2(norm(b) * win)
    cross = fa * np.conj(fb)
    cross /= np.abs(cross) + 1e-9
    corr = np.fft.ifft2(cross).real
    y, x = np.unravel_index(np.argmax(corr), corr.shape)
    strength = float(corr[y, x] / (np.abs(corr).mean() + 1e-9))
    return int(x), int(y), strength


def unwrap(v, n, expect=None):
    """Shift candidates v and v - n: the one closest to `expect`, else the smaller one."""
    cands = (v, v - n)
    if expect is None:
        return v - n if v > n // 2 else v
    return min(cands, key=lambda c: abs(c - expect))


def shift_full(a, b, ex=None, ey=None):
    x, y, strength = peak(a, b)
    # phase correlation of (ref, img) peaks at the shift that maps img onto ref: negate for "content moved by"
    dx = -unwrap(x, a.shape[1], None if ex is None else -ex)
    dy = -unwrap(y, a.shape[0], None if ey is None else -ey)
    return dx, dy, strength


def shift_crop(a, b, ex, ey):
    """Content at ref (x, y) is expected at img (x + ex, y + ey): compare the shared region only."""
    h, w = a.shape
    x0, x1 = max(0, -ex), min(w, w - ex)
    y0, y1 = max(0, -ey), min(h, h - ey)
    if x1 - x0 < w * MIN_OVERLAP or y1 - y0 < h * MIN_OVERLAP:
        return None
    ra, rb = a[y0:y1, x0:x1], b[y0 + ey:y1 + ey, x0 + ex:x1 + ex]
    rx, ry, strength = shift_full(ra, rb, 0, 0)
    if abs(rx) > (x1 - x0) * MAX_RESIDUAL or abs(ry) > (y1 - y0) * MAX_RESIDUAL:
        return None
    return ex + rx, ey + ry, strength


def measure(ref, img, ex=None, ey=None):
    a, scale = load(ref)
    b, _ = load(img)
    if ex is not None and ey is not None:
        e = (int(round(ex / scale)), int(round(ey / scale)))
        r = shift_crop(a, b, *e)
        if r is not None:
            dx, dy, strength = r
            return {'dx': round(dx * scale, 1), 'dy': round(dy * scale, 1), 'strength': round(strength, 1), 'method': 'crop'}
        dx, dy, strength = shift_full(a, b, *e)
    else:
        dx, dy, strength = shift_full(a, b)
    return {'dx': round(dx * scale, 1), 'dy': round(dy * scale, 1), 'strength': round(strength, 1), 'method': 'full'}


def emit(out):
    sys.stdout.write(json.dumps(out) + '\n')
    sys.stdout.flush()


def main(argv):
    if argv[:1] == ['--json']:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                q = json.loads(line)
                ex, ey = q.get('dx'), q.get('dy')
                if ex is None or ey is None:
                    ex = ey = None
                emit(measure(q['ref'], q['img'], ex, ey))
            except Exception as error:
                emit({'dx': None, 'dy': None, 'error': str(error)})
        return
    for i in range(0, len(argv) - 1, 2):
        try:
            emit(measure(argv[i], argv[i + 1]))
        except Exception as error:
            emit({'dx': None, 'dy': None, 'error': str(error)})


if __name__ == '__main__':
    main(sys.argv[1:])
