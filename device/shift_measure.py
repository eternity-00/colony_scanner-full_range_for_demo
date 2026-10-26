#!/usr/bin/env python3
"""Whole-image translation between two frames (phase correlation), in pixels of the input images.

Usage: shift_measure.py REF IMG [REF IMG ...]
One JSON line per pair: {"dx", "dy", "strength"} — how far IMG's content moved relative to REF
(positive dx = content moved right). Works on previews; the caller scales to full-resolution pixels.
"""
import json
import sys

import numpy as np
from PIL import Image

SIZE = 640


def load(path):
    im = Image.open(path).convert('L')
    w, h = im.size
    im = im.resize((SIZE, max(1, int(SIZE * h / w))), Image.BILINEAR)
    a = np.asarray(im, dtype=np.float32)
    return (a - a.mean()) / (a.std() + 1e-6), w / SIZE


def shift(a, b):
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    fa, fb = np.fft.fft2(a * win), np.fft.fft2(b * win)
    cross = fa * np.conj(fb)
    cross /= np.abs(cross) + 1e-9
    corr = np.fft.ifft2(cross).real
    y, x = np.unravel_index(np.argmax(corr), corr.shape)
    strength = float(corr[y, x] / (np.abs(corr).mean() + 1e-9))
    if y > corr.shape[0] // 2:
        y -= corr.shape[0]
    if x > corr.shape[1] // 2:
        x -= corr.shape[1]
    # phase correlation of (ref, img) gives the shift that maps img onto ref: negate for "content moved by"
    return -int(x), -int(y), strength


def main(argv):
    for i in range(0, len(argv) - 1, 2):
        try:
            a, scale = load(argv[i])
            b, _ = load(argv[i + 1])
            dx, dy, strength = shift(a, b)
            out = {'dx': round(dx * scale, 1), 'dy': round(dy * scale, 1), 'strength': round(strength, 1)}
        except Exception as error:
            out = {'dx': None, 'dy': None, 'error': str(error)}
        sys.stdout.write(json.dumps(out) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main(sys.argv[1:])
