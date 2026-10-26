#!/usr/bin/env python3
"""Change between two previews of the same well (previous run vs this run).

Usage: change_score.py PREV CUR [PREV CUR ...]
One JSON line per pair: {"shift": {"x", "y"}, "score", "seconds"}.
The frames are aligned by phase correlation (whole-image translation, so a plate that sat a
little differently does not count as change), then score = mean absolute difference of the
normalised grey levels inside the overlap, 0 (identical) .. 1. Colony growth between two
captures of the same plate scores a few hundredths; a missing / swapped plate or a lid left
off scores several tenths.
"""
import json
import sys
import time

import numpy as np
from PIL import Image

SIZE = 320


def load(path):
    with Image.open(path) as im:
        g = im.convert('L').resize((SIZE, SIZE), Image.BILINEAR)
    a = np.asarray(g, dtype=np.float32)
    a = (a - a.mean()) / (a.std() + 1e-6)
    return a


def register(a, b):
    win = np.outer(np.hanning(SIZE), np.hanning(SIZE))
    fa, fb = np.fft.fft2(a * win), np.fft.fft2(b * win)
    cross = fa * np.conj(fb)
    cross /= np.abs(cross) + 1e-9
    corr = np.fft.ifft2(cross).real
    y, x = np.unravel_index(np.argmax(corr), corr.shape)
    if y > SIZE // 2:
        y -= SIZE
    if x > SIZE // 2:
        x -= SIZE
    return int(x), int(y)


def score(prev, cur):
    started = time.monotonic()
    a, b = load(prev), load(cur)
    dx, dy = register(a, b)
    # limit to a plausible seating shift; a huge "shift" is itself a change
    dx, dy = max(-40, min(40, dx)), max(-40, min(40, dy))
    bs = np.roll(np.roll(b, dy, axis=0), dx, axis=1)
    m = 48  # ignore the border (rim / shadow) and the roll wrap
    diff = np.abs(a[m:-m, m:-m] - bs[m:-m, m:-m])
    # normalised grey difference: |z-score difference| / 4 saturates near 1 for inverted content
    s = float(np.clip(diff.mean() / 4.0, 0.0, 1.0))
    return {'shift': {'x': dx, 'y': dy}, 'score': round(s, 4), 'seconds': round(time.monotonic() - started, 3)}


def main(argv):
    for i in range(0, len(argv) - 1, 2):
        try:
            out = score(argv[i], argv[i + 1])
        except Exception as error:
            out = {'error': str(error), 'score': None}
        sys.stdout.write(json.dumps(out) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main(sys.argv[1:])
