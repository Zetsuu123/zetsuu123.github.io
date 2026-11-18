"""Always On Display animation: a slowly turning void portal on pure black (seamless loop).

usage: python3 make_aod.py <frames dir>   then encode with ffmpeg (see build.sh)
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
N = 480          # px
FRAMES = 48      # 4 s at 12 fps
R0 = 118         # event horizon radius
ARMS = 3

y, x = np.mgrid[0:N, 0:N].astype(np.float32)
x -= N / 2
y -= N / 2
r = np.hypot(x, y) + 1e-3
th = np.arctan2(y, x)

# colour ramp: black -> indigo -> arcane -> glow -> starlight
stops = np.array([0, .18, .45, .7, 1.0])
cols = np.array([[0, 0, 0], [0x29, 0x28, 0x5e], [0x7b, 0x61, 0xff], [0xa5, 0x97, 0xff], [0xe2, 0xe0, 0xff]], np.float32)


def ramp(v):
    v = np.clip(v, 0, 1)
    out = np.empty(v.shape + (3,), np.float32)
    for c in range(3):
        out[..., c] = np.interp(v, stops, cols[:, c])
    return out


def blur(a, s):
    k = int(s * 3) | 1
    g = np.exp(-((np.arange(k) - k // 2) ** 2) / (2 * s * s))
    g /= g.sum()
    a = np.apply_along_axis(lambda m: np.convolve(m, g, mode="same"), 0, a)
    return np.apply_along_axis(lambda m: np.convolve(m, g, mode="same"), 1, a)


rng = np.random.default_rng(7)
P = 900
pr = R0 + np.abs(rng.normal(0, 20, P)) * rng.choice([1, 1, 1, 2.2], P)
pa = rng.uniform(0, 2 * np.pi, P)
pturns = rng.choice([1, 1, 2], P)                  # whole turns per loop -> seamless
pb = rng.uniform(0.3, 1.0, P) * np.exp(-(pr - R0) / 70)
ptw = rng.integers(1, 4, P)
pph = rng.uniform(0, 2 * np.pi, P)

ring = np.exp(-((r - R0) / 7) ** 2) + 0.5 * np.exp(-((r - R0) / 24) ** 2)
outer = np.exp(-np.clip(r - R0, 0, None) / 55) * (r > R0)
# fade to pure black well before the frame edge so no square shows on the AOD
edge = np.clip((N / 2 - 12 - r) / 70, 0, 1) ** 2
inner_lip = np.exp(-((r - R0 + 6) / 4) ** 2)

for f in range(FRAMES):
    t = f / FRAMES
    # arms turn 1/ARMS of a revolution per loop, so the pattern lines up again seamlessly
    spiral = 0.5 + 0.5 * np.cos(ARMS * th - 2 * np.pi * t + 5.5 * np.log(r / R0))
    swirl = outer * (0.18 + 0.55 * spiral ** 2)
    # one bright side that travels round once per loop, like the lit edge of the wallpaper's orbs
    lit = 0.45 + 0.55 * (0.5 + 0.5 * np.cos(th - 2 * np.pi * t - 0.8))
    v = (0.5 * ring * (0.6 + 0.4 * spiral) + swirl * 0.45) * lit + 0.22 * inner_lip
    # particles
    sp = np.zeros((N, N), np.float32)
    ang = pa + 2 * np.pi * pturns * t
    px = (N / 2 + pr * np.cos(ang)).astype(int)
    py = (N / 2 + pr * np.sin(ang)).astype(int)
    tw = 0.55 + 0.45 * np.sin(2 * np.pi * ptw * t + pph)
    ok = (px >= 1) & (px < N - 1) & (py >= 1) & (py < N - 1)
    np.add.at(sp, (py[ok], px[ok]), pb[ok] * tw[ok])
    sp = blur(sp, 0.9) * 4.5
    v = v + sp
    v = v + 0.45 * blur(v, 6)                     # bloom
    v[r < R0 - 6] *= 0.0                          # the void itself stays black
    img = ramp(v * 0.8 * edge)
    Image.fromarray(img.astype(np.uint8)).save(OUT / f"f{f:03d}.png")
print(f"{FRAMES} frames -> {OUT}")
