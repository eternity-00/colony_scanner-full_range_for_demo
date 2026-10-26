#!/usr/bin/env python3
"""Barcode / QR decoding of captured frames (zxing-cpp).

Usage: barcode.py FILE [FILE ...]
One JSON line per file: {"file", "barcodes": [{"text", "format", "x", "y", "w", "h"}], "seconds"}
and a final {"done": true, "decoder": "zxing-cpp"|null}. Without zxing-cpp every file reports
{"error": "NO_DECODER"} so the app can show that recognition is unavailable rather than "none".
"""
import json
import sys
import time

try:
    import zxingcpp
    DECODER = 'zxing-cpp'
except Exception:  # pragma: no cover - depends on the Pi's packages
    zxingcpp = None
    DECODER = None
from PIL import Image


def decode(path):
    started = time.monotonic()
    out = {'file': path, 'barcodes': [], 'seconds': 0.0}
    if zxingcpp is None:
        out['error'] = 'NO_DECODER'
        return out
    try:
        with Image.open(path) as im:
            im.load()
            gray = im.convert('L')
    except Exception as error:
        out['error'] = f'UNREADABLE: {error}'
        return out
    try:
        results = zxingcpp.read_barcodes(gray, try_rotate=True, try_downscale=True)
    except TypeError:
        results = zxingcpp.read_barcodes(gray)
    for r in results:
        if not r.valid:
            continue
        p = r.position
        xs = [p.top_left.x, p.top_right.x, p.bottom_left.x, p.bottom_right.x]
        ys = [p.top_left.y, p.top_right.y, p.bottom_left.y, p.bottom_right.y]
        out['barcodes'].append({'text': r.text, 'format': str(r.format).split('.')[-1],
                                'x': min(xs), 'y': min(ys), 'w': max(xs) - min(xs), 'h': max(ys) - min(ys)})
    out['seconds'] = round(time.monotonic() - started, 3)
    return out


def main(argv):
    for path in argv:
        sys.stdout.write(json.dumps(decode(path), ensure_ascii=False) + '\n')
        sys.stdout.flush()
    sys.stdout.write(json.dumps({'done': True, 'decoder': DECODER}) + '\n')


if __name__ == '__main__':
    main(sys.argv[1:])
