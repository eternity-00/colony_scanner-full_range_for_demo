#!/usr/bin/env python3
"""Well centre detection for camera alignment (numpy only; PIL for PNG/JPEG input and overlays).

The 6-well rim is a large circle (diameter about the frame width at the capture height).
Edge pixels vote for circle centres along their gradient direction (Hough transform with
a radius band); the candidate nearest the expected position is refined with a
fixed-radius least-squares fit, which stays well conditioned when only an arc is visible.

  python3 well_center.py FRAME.yuy2 WIDTH HEIGHT [--radius R] [--overlay OUT.jpg]
  python3 well_center.py FRAME.jpg [--radius R] [--overlay OUT.jpg]
  python3 well_center.py --self-test

Coordinates in the result are full-frame pixels (x right, y down).
"""
import argparse
import json
import math
import sys

import numpy as np

WORK_WIDTH = 960		# analysis width; a 3840 frame is block-averaged 4x4
EDGE_FRACTION = 0.10	# strongest 10 % of gradient magnitudes are edge pixels (the rim is faint)
RADIUS_BAND = 0.025	# centre refinement accepts edges within +-2.5 % of the ring radius
PEAK_FLOOR = 0.3	# centre candidates: local maxima above this fraction of the strongest
MIN_SUPPORT = 0.8	# inlier edge pixels per pixel of visible arc; a real rim gives several
MIN_COVERAGE = 0.18	# fraction of the visible arc with edge support; a faint rim seen whole can be ~0.25


class WellNotFound(RuntimeError):
    pass


def luma_from_yuy2(path, width, height):
    """Y plane of a packed YUYV frame, block-averaged to the analysis width."""
    data = np.fromfile(path, dtype=np.uint8)
    if data.size != width * height * 2:
        raise ValueError('YUY2_SIZE_MISMATCH')
    return downsample(data.reshape(height, width * 2)[:, 0::2], width)


def luma_from_image(path):
    from PIL import Image
    with Image.open(path) as image:
        gray = np.asarray(image.convert('L'))
    return downsample(gray, gray.shape[1])


def downsample(gray, width):
    factor = max(1, round(width / WORK_WIDTH))
    h, w = gray.shape[0] // factor * factor, gray.shape[1] // factor * factor
    if factor == 1:
        return np.asarray(gray, dtype=np.float32), 1
    if gray.dtype == np.uint8 and factor <= 16:
        # Exact block mean from factor^2 strided gathers summed in uint16: 3x faster than the
        # reshape/mean pass over the whole frame on a Pi 4 (70 ms instead of 220 ms).
        g = gray[:h, :w]
        acc = np.zeros((h // factor, w // factor), dtype=np.uint16)
        for r in range(factor):
            for c in range(factor):
                acc += g[r::factor, c::factor]
        return acc.astype(np.float32) * np.float32(1.0 / (factor * factor)), factor
    blocks = gray[:h, :w].reshape(h // factor, factor, w // factor, factor)
    return blocks.mean(axis=(1, 3), dtype=np.float32), factor


def box_blur(a, k):
    """Separable k x k mean (float32 running sums; values are at most a few thousand)."""
    pad = k // 2
    c = np.cumsum(np.pad(a, ((0, 0), (pad + 1, pad)), mode='edge'), axis=1, dtype=np.float32)
    a = (c[:, k:] - c[:, :-k]) * np.float32(1.0 / k)
    c = np.cumsum(np.pad(a, ((pad + 1, pad), (0, 0)), mode='edge'), axis=0, dtype=np.float32)
    return (c[k:, :] - c[:-k, :]) * np.float32(1.0 / k)


def edges(gray):
    g = box_blur(gray, 5)
    gy, gx = np.gradient(g)
    mag = np.hypot(gx, gy)
    flat = mag.ravel()
    threshold = np.partition(flat, int(flat.size * (1 - EDGE_FRACTION)))[int(flat.size * (1 - EDGE_FRACTION))]
    ys, xs = np.nonzero(mag > threshold)
    m = mag[ys, xs]
    return xs.astype(np.float32), ys.astype(np.float32), gx[ys, xs] / m, gy[ys, xs] / m


def vote(xs, ys, ux, uy, radii, shape, cell, reach, polarity=None):
    """Centre accumulator over the frame extended by `reach` pixels on every side.

    An edge brightening outward (polarity +1) has its centre against the gradient; with the
    calibrated polarity only that direction votes, so the other side of the wall cannot
    form a competing peak at a shifted centre.
    """
    h, w = shape
    aw, ah = int((w + 2 * reach) // cell) + 1, int((h + 2 * reach) // cell) + 1
    acc = np.zeros(ah * aw, dtype=np.float32)
    for r in radii:
        for sign in ((-polarity,) if polarity else (1.0, -1.0)):
            cx = (xs + sign * r * ux + reach) / cell
            cy = (ys + sign * r * uy + reach) / cell
            ok = (cx >= 0) & (cx < aw) & (cy >= 0) & (cy < ah)
            acc += np.bincount(cy[ok].astype(np.int64) * aw + cx[ok].astype(np.int64), minlength=ah * aw)
    acc = box_blur(acc.reshape(ah, aw), 3)
    return acc


def peaks(acc, cell, reach, floor=0.5):
    """Local maxima (5 x 5 neighbourhood) of the accumulator above `floor` of its maximum."""
    strong = (acc >= floor * acc.max()) & (acc > 0)
    padded = np.pad(acc, 2, mode='constant')
    local = np.ones_like(strong)
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            if dy or dx:
                local &= acc >= padded[2 + dy:2 + dy + acc.shape[0], 2 + dx:2 + dx + acc.shape[1]]
    found = np.argwhere(strong & local)
    result = [(float(acc[y, x]), (x + 0.5) * cell - reach, (y + 0.5) * cell - reach) for y, x in found]
    result.sort(reverse=True)
    return result


def radial_sign(xs, ys, ux, uy, cx, cy):
    """Cosine between the gradient (dark to bright) and the outward radial direction."""
    dx, dy = xs - cx, ys - cy
    d = np.hypot(dx, dy)
    return d, (dx * ux + dy * uy) / np.maximum(d, 1e-6)


def visible_fraction(cx, cy, radius, shape):
    """Fraction of a circle that lies inside the frame (72 sample angles)."""
    h, w = shape
    t = np.linspace(-math.pi, math.pi, 72, endpoint=False) + math.pi / 72
    px, py = cx + radius * np.cos(t), cy + radius * np.sin(t)
    return float(((px >= 0) & (px < w) & (py >= 0) & (py < h)).mean())


def ring_radius(xs, ys, ux, uy, cx, cy, lo, hi, shape, prefer=None, tolerance=0.05, polarity=None):
    """Ring radius and edge polarity around a centre from the radial edge histograms.

    Edges brightening outward and edges darkening outward are counted separately so the
    two sides of a wall (opposite polarity) cannot be mistaken for one ring at a shifted
    centre. With `prefer` (the calibrated radius) the strongest ring near it wins. Without,
    rings are ranked by edge density per visible arc length, so a strong rim seen only at
    the frame sides beats a faint meniscus ring that happens to lie fully in view.
    Concentric rings share the centre; the choice only affects the convergence off centre.
    """
    from numpy.lib.stride_tricks import sliding_window_view
    d, cosine = radial_sign(xs, ys, ux, uy, cx, cy)
    bins = np.arange(lo, hi + 2, 2)
    centres = bins[:-1] + 1
    best = None
    for sign in ((polarity,) if polarity else (1.0, -1.0)):
        sel = (cosine * sign > 0.9) & (d >= lo) & (d <= hi)
        if sel.sum() < 30:
            continue
        hist = np.convolve(np.histogram(d[sel], bins=bins)[0], np.ones(3), 'same')
        if hist.max() < 30:
            continue
        window = sliding_window_view(np.pad(hist, 4, mode='constant'), 9).max(axis=1)
        local = (hist >= window) & (hist >= 30)
        if prefer:
            near = local & (hist >= 0.5 * hist.max()) & (np.abs(centres - prefer) <= tolerance * prefer)
            pick = int(np.argmax(np.where(near, hist, -1))) if near.any() else int(np.argmax(hist))
            score = hist[pick] * (2.0 if near.any() else 1.0)
        else:
            candidates = [k for k in np.nonzero(local & (hist >= 0.3 * hist.max()))[0]]
            density = {k: hist[k] / (2 * math.pi * centres[k] * max(visible_fraction(cx, cy, centres[k], shape), 0.1)) for k in candidates}
            best_density = max(density.values())
            # The well wall is the physical reference: inner rings (agar meniscus, shadows) are
            # not concentric with it. Take the outermost ring that is still clearly a ring
            # (at least half the edge density of the strongest one).
            pick = max((k for k in candidates if density[k] >= 0.5 * best_density), key=lambda k: centres[k])
            score = density[pick] + centres[pick] * 1e-6
        if best is None or score > best[0]:
            best = (score, float(centres[pick]), sign)
    if best is None:
        raise WellNotFound('WELL_EDGE_TOO_SHORT')
    return best[1], best[2]


def refine(xs, ys, ux, uy, cx, cy, radius, polarity):
    """Gauss-Newton centre fit with the ring radius fixed (well conditioned for short arcs).

    Only edges within 12 % of the radius around the starting centre take part; the centre
    moves by a few cells at most, so the wider band keeps every possible inlier."""
    d0 = np.hypot(xs - cx, ys - cy)
    near = np.abs(d0 - radius) <= max(12.0, 0.12 * radius)
    px, py, pux, puy = xs[near], ys[near], ux[near], uy[near]
    band = max(3.0, RADIUS_BAND * radius)
    inliers = None
    for _ in range(8):
        d, cosine = radial_sign(px, py, pux, puy, cx, cy)
        inliers = (cosine * polarity > 0.9) & (np.abs(d - radius) <= band)
        if inliers.sum() < 30:
            raise WellNotFound('WELL_EDGE_TOO_SHORT')
        nx, ny = (px[inliers] - cx) / d[inliers], (py[inliers] - cy) / d[inliers]
        residual = d[inliers] - radius
        jtj = np.array([[np.sum(nx * nx), np.sum(nx * ny)], [np.sum(nx * ny), np.sum(ny * ny)]], dtype=np.float64)
        step = np.linalg.solve(jtj + 1e-6 * np.eye(2), np.array([np.sum(nx * residual), np.sum(ny * residual)], dtype=np.float64))
        cx, cy = cx + step[0], cy + step[1]
        if abs(step[0]) < 0.05 and abs(step[1]) < 0.05:
            break
    d, cosine = radial_sign(px, py, pux, puy, cx, cy)
    inliers = (cosine * polarity > 0.9) & (np.abs(d - radius) <= band)
    full = np.zeros(xs.shape, dtype=bool)
    full[np.nonzero(near)[0][inliers]] = True
    return cx, cy, full


def coverage(xs, ys, cx, cy, radius, inliers, shape):
    """Arc coverage (fraction of visible 5-degree bins with edges), visible fraction of the
    circle, and support (inlier edge pixels per pixel of visible arc; noise stays below ~0.3)."""
    h, w = shape
    bins = np.zeros(72, dtype=bool)
    angle = np.arctan2(ys[inliers] - cy, xs[inliers] - cx)
    bins[((angle + math.pi) / (2 * math.pi) * 72).astype(int) % 72] = True
    t = np.linspace(-math.pi, math.pi, 72, endpoint=False) + math.pi / 72
    px, py = cx + radius * np.cos(t), cy + radius * np.sin(t)
    visible = (px >= 0) & (px < w) & (py >= 0) & (py < h)
    if not visible.any():
        return 0.0, 0.0, 0.0
    arc_length = 2 * math.pi * radius * visible.mean()
    return float(bins[visible].mean()), float(visible.mean()), float(inliers.sum() / max(arc_length, 1.0))


def detect(gray, factor, radius=None, polarity=None, radius_range=(0.45, 0.80), expected=None, max_offset=None):
    """Find the well centre in the analysis image. Returns full-frame pixel values.

    radius: known ring radius in full-frame pixels (from calibration); None = search.
    polarity: calibrated ring edge polarity (+1 brightening outward, -1 darkening), or None.
    radius_range: search band as a fraction of the frame height when radius is None.
    expected: expected centre in full-frame pixels (default: frame centre).
    max_offset: reject a centre farther than this (full-frame pixels) from `expected`.
    """
    h, w = gray.shape
    xs, ys, ux, uy = edges(gray)
    if radius:
        r = radius / factor
        radii = np.linspace(r * 0.96, r * 1.04, 5)
    else:
        # A ring taller than the frame leaves it once the well is centred (the wall's top rim,
        # magnified by its height), so the search stops at about the half frame height: the
        # outermost ring left is the wall foot at the agar level, concentric with the well.
        lo, hi = radius_range[0] * h, min(radius_range[1] * h, 0.56 * h)
        radii = np.linspace(lo, hi, 24)
    cell, reach = 4, int(0.7 * h)
    acc = vote(xs, ys, ux, uy, radii, gray.shape, cell, reach, polarity if radius else None)
    candidates = peaks(acc, cell, reach, PEAK_FLOOR)
    if not candidates:
        raise WellNotFound('WELL_NOT_FOUND')
    ex, ey = (w / 2, h / 2) if expected is None else (expected[0] / factor, expected[1] / factor)
    limit = (max_offset / factor) if max_offset else 1.2 * h
    near = [c for c in candidates if math.hypot(c[1] - ex, c[2] - ey) <= limit]
    if not near:
        raise WellNotFound('WELL_NOT_NEAR_EXPECTED')
    # Neighbouring wells are at least a well pitch away: the nearest strong candidate is the target.
    votes, cx, cy = min(near, key=lambda c: math.hypot(c[1] - ex, c[2] - ey))
    if radius:
        # The calibrated ring: its radius is trusted (same plate type and capture height), the
        # histogram only confirms the ring and settles the polarity when none was calibrated.
        r = radius / factor
        _, ring_polarity = ring_radius(xs, ys, ux, uy, cx, cy, r * 0.9, r * 1.1, gray.shape, prefer=r, polarity=polarity)
        cx, cy, inliers = refine(xs, ys, ux, uy, cx, cy, r, ring_polarity)
    else:
        # ring radius and centre alternately: the coarse Hough centre smears the radial histogram
        for _ in range(2):
            r, ring_polarity = ring_radius(xs, ys, ux, uy, cx, cy, radii[0], radii[-1], gray.shape)
            cx, cy, inliers = refine(xs, ys, ux, uy, cx, cy, r, ring_polarity)
    arc, visible, support = coverage(xs, ys, cx, cy, r, inliers, gray.shape)
    if arc < MIN_COVERAGE or support < MIN_SUPPORT:
        raise WellNotFound('WELL_EDGE_WEAK')
    return {'x': float(cx * factor), 'y': float(cy * factor), 'radius': float(r * factor), 'polarity': int(ring_polarity), 'inliers': int(inliers.sum()),
            'coverage': round(arc, 3), 'visibleArc': round(visible, 3), 'support': round(support, 2), 'votes': round(float(votes), 1),
            'offset': {'x': float((cx - w / 2) * factor), 'y': float((cy - h / 2) * factor)},
            'candidates': [{'x': float(x * factor), 'y': float(y * factor), 'votes': round(float(v), 1)} for v, x, y in candidates[:4]],
            'image': {'width': w * factor, 'height': h * factor}}


def overlay(gray, factor, result, path, size=640):
    from PIL import Image, ImageDraw
    image = Image.fromarray(np.clip(gray, 0, 255).astype(np.uint8)).convert('RGB')
    s = size / image.width
    image = image.resize((size, int(image.height * s)))
    draw = ImageDraw.Draw(image)
    w, h = image.size
    draw.line([(w / 2, 0), (w / 2, h)], fill=(255, 0, 0))
    draw.line([(0, h / 2), (w, h / 2)], fill=(255, 0, 0))
    if result:
        k = s / factor
        cx, cy, r = result['x'] * k, result['y'] * k, result['radius'] * k
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(0, 255, 0), width=2)
        draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(0, 255, 0))
        draw.text((6, 6), 'off=(%+.0f,%+.0f) r=%.0f cov=%.2f' % (result['offset']['x'], result['offset']['y'], result['radius'], result['coverage']), fill=(255, 255, 0))
    image.save(path, quality=80)


def shift_between(reference, gray, factor, min_shift=0.0):
    """Translation (dx, dy, full-frame px) that moves `reference` onto `gray`: phase
    correlation of the whole frame. Plate texture, colonies and rims all contribute, so this
    is far more robust than the rim fit for measuring how far a probe move shifted the image.
    Vignetting and dust are the same in both frames and would vote for "no shift": the frames
    are high-pass filtered first, and with `min_shift` (full-frame px, for probe moves whose
    shift is known to be large) the peak search excludes that radius around zero.
    Returns (dx, dy, peak) where peak is the normalised correlation peak (0..1)."""
    a = reference - box_blur(reference, 31)
    b = gray - box_blur(gray, 31)
    h, w = a.shape
    win = np.outer(np.hanning(h), np.hanning(w)).astype(np.float32)
    fa, fb = np.fft.rfft2(a * win), np.fft.rfft2(b * win)
    cross = fa * np.conj(fb)
    cross /= np.maximum(np.abs(cross), 1e-9)
    corr = np.fft.irfft2(cross, s=a.shape)
    if min_shift > 0:
        r = int(min_shift / factor)
        yy, xx = np.mgrid[0:h, 0:w]
        dy_wrap = np.minimum(yy, h - yy)
        dx_wrap = np.minimum(xx, w - xx)
        corr = np.where(dx_wrap * dx_wrap + dy_wrap * dy_wrap < r * r, -np.inf, corr)
    peak = int(np.argmax(corr))
    py, px = divmod(peak, w)
    # sub-pixel refinement around the peak (parabolic), with wrap-around
    def refine(axis_len, idx, minus, plus):
        centre = corr.flat[peak]
        denominator = minus - 2 * centre + plus
        offset = 0.5 * (minus - plus) / denominator if np.isfinite(denominator) and denominator < 0 else 0.0
        value = idx + offset
        return value - axis_len if value > axis_len / 2 else value
    dy = refine(h, py, corr[(py - 1) % h, px], corr[(py + 1) % h, px])
    dx = refine(w, px, corr[py, (px - 1) % w], corr[py, (px + 1) % w])
    finite = corr[np.isfinite(corr)]
    strength = float(corr.flat[peak]) / max(float(np.abs(finite).sum()) / finite.size * 50, 1e-9)
    return float(-dx * factor), float(-dy * factor), float(min(strength, 1.0))


def synthetic(width, height, cx, cy, r, seed=0):
    """Light background, translucent ring wall, agar disk; noise and a dark colony."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    d = np.hypot(xx - cx, yy - cy)
    img = np.full((height, width), 200, dtype=np.float32)
    img[d < r * 1.07] = 150				# wall
    img[d < r] = 175					# agar
    img[np.hypot(xx - cx + r * 0.3, yy - cy - r * 0.1) < r * 0.04] = 40	# colony
    img += rng.normal(0, 4, img.shape).astype(np.float32)
    img += (xx / width) * 20				# illumination ramp
    return np.clip(img, 0, 255)


def self_test():
    # half the real frame (1920x1520, analysis factor 2): tolerances below are in these pixels.
    # The ring is half the frame height, like the wall foot of a 6-well plate at the capture height.
    w, h = 1920, 1520
    cases = [(960, 760, 700), (1250, 650, 700), (600, 950, 700), (1100, 1450, 700), (750, -100, 700)]
    for cx, cy, r in cases:
        small, factor = downsample(synthetic(w, h, cx, cy, r), w)
        found = detect(small, factor)
        error = math.hypot(found['x'] - cx, found['y'] - cy)
        assert error < 30 and abs(found['radius'] - r) < 0.1 * r, (cx, cy, found, error)
        for ring, pol in ((r * 1.07, 1), (r, -1)):	# outer wall edge brightens outward, inner edge darkens
            fixed = detect(small, factor, radius=ring, polarity=pol)
            assert math.hypot(fixed['x'] - cx, fixed['y'] - cy) < 15 and fixed['polarity'] == pol, (cx, cy, ring, fixed)
    # two wells at the row junction: the one nearest the expected position wins
    img = np.minimum(synthetic(w, h, 960, -300, 850), synthetic(w, h, 960, 1850, 850))
    small, factor = downsample(img, w)
    found = detect(small, factor, radius=850, polarity=-1, expected=(960, 600))
    assert abs(found['y'] + 300) < 6, found
    found = detect(small, factor, radius=850, polarity=-1, expected=(960, 1000))
    assert abs(found['y'] - 1850) < 6, found
    # registration: the same scene shifted by (+37, -22) px is recovered within a pixel
    scene = synthetic(w, h, 900, 700, 850, seed=3)
    rng = np.random.default_rng(2)
    scene += rng.normal(0, 12, scene.shape).astype(np.float32)	# texture to lock on to
    moved = np.roll(np.roll(scene, 37, axis=1), -22, axis=0)
    a, factor = downsample(scene, w)
    b, _ = downsample(moved, w)
    dx, dy, strength = shift_between(a, b, factor)
    assert abs(dx - 37) < 1.5 and abs(dy + 22) < 1.5 and strength > 0.3, (dx, dy, strength)
    # the same with a fixed pattern (vignetting, dust) that does not move with the scene
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    fixed = -40 * ((xx - w / 2) ** 2 + (yy - h / 2) ** 2) / (w * w) + rng.normal(0, 25, (h, w)).astype(np.float32) * (rng.random((h, w)) < 0.002)
    a2, _ = downsample(np.clip(scene + fixed, 0, 255), w)
    b2, _ = downsample(np.clip(moved + fixed, 0, 255), w)
    dx, dy, strength = shift_between(a2, b2, factor, min_shift=10)
    assert abs(dx - 37) < 2 and abs(dy + 22) < 2, (dx, dy, strength)
    # no well: plain noise
    rng = np.random.default_rng(1)
    small, factor = downsample(np.clip(rng.normal(180, 6, (h, w)), 0, 255).astype(np.float32), w)
    try:
        detect(small, factor, radius=850, polarity=-1, max_offset=750)
    except WellNotFound:
        pass
    else:
        raise AssertionError('noise must not yield a well')
    print('well_center self-test ok')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('frame', nargs='?')
    parser.add_argument('width', nargs='?', type=int)
    parser.add_argument('height', nargs='?', type=int)
    parser.add_argument('--radius', type=float, help='calibrated ring radius in frame pixels')
    parser.add_argument('--polarity', type=int, choices=(1, -1), help='calibrated ring edge polarity')
    parser.add_argument('--expected', help='expected centre "x,y" in frame pixels')
    parser.add_argument('--max-offset', type=float)
    parser.add_argument('--overlay')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if not args.frame:
        parser.error('frame required')
    if args.frame.endswith('.yuy2'):
        if not args.width or not args.height:
            parser.error('WIDTH HEIGHT required for .yuy2')
        gray, factor = luma_from_yuy2(args.frame, args.width, args.height)
    else:
        gray, factor = luma_from_image(args.frame)
    expected = tuple(float(v) for v in args.expected.split(',')) if args.expected else None
    try:
        result = detect(gray, factor, radius=args.radius, polarity=args.polarity, expected=expected, max_offset=args.max_offset)
        output = {'ok': True, **result}
    except WellNotFound as error:
        result, output = None, {'ok': False, 'error': str(error)}
    if args.overlay:
        overlay(gray, factor, result, args.overlay)
    print(json.dumps(output))
    return 0 if output['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
