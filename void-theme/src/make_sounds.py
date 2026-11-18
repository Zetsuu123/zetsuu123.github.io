"""Void notification chime + ringtone, synthesised (inharmonic bells, sub swell, long dark reverb).

usage: python3 make_sounds.py <out dir>   -> void-whisper.wav, void-call.wav (encode to .ogg in build.sh)
"""
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(3)


def hz(n):  # MIDI note -> Hz
    return 440.0 * 2 ** ((n - 69) / 12)


def bell(f, dur, amp=1.0, bright=1.0):
    t = np.arange(int(dur * SR)) / SR
    parts = [(1.0, 1.0, 1.6), (2.0, 0.42, 1.1), (2.76, 0.30 * bright, 0.7), (5.40, 0.16 * bright, 0.35), (8.93, 0.07 * bright, 0.18)]
    s = np.zeros_like(t)
    for ratio, a, dec in parts:
        vib = 1 + 0.0015 * np.sin(2 * np.pi * 5.2 * t)
        s += a * np.sin(2 * np.pi * f * ratio * vib * t + rng.uniform(0, 6.28)) * np.exp(-t / dec)
    atk = np.clip(t / 0.004, 0, 1)
    return amp * s * atk


def pad(f, dur, amp=0.2):
    t = np.arange(int(dur * SR)) / SR
    s = sum(np.sin(2 * np.pi * f * d * t) for d in (1.0, 1.003, 0.997, 2.0005))
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5
    return amp * s / 4 * env * (0.8 + 0.2 * np.sin(2 * np.pi * 0.35 * t))


def reverb(x, length=2.8, mix=0.42):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-t / (length / 5))
    # darken the tail: one-pole low-pass
    a = 0.82
    for i in range(1, n):
        ir[i] = a * ir[i - 1] + (1 - a) * ir[i]
    ir /= np.sqrt((ir ** 2).sum())
    wet = np.fft.irfft(np.fft.rfft(x, len(x) + n) * np.fft.rfft(ir, len(x) + n))[: len(x) + n]
    dry = np.concatenate([x, np.zeros(n)])
    return (1 - mix) * dry + mix * wet * 3


def place(buf, sig, at):
    i = int(at * SR)
    end = min(len(buf), i + len(sig))
    buf[i:end] += sig[: end - i]


def save(name, x, peak=0.89):
    x = x / np.abs(x).max() * peak
    fade = int(0.08 * SR)
    x[-fade:] *= np.linspace(1, 0, fade)
    with wave.open(str(OUT / name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    print(name, f"{len(x) / SR:.1f}s")


# Notification: B4 then E5+B5 shimmer over a low E swell
buf = np.zeros(int(2.0 * SR))
place(buf, pad(hz(40), 1.6, 0.35), 0.0)
place(buf, bell(hz(71), 1.8, 0.55, 0.8), 0.02)
place(buf, bell(hz(76), 1.8, 0.75), 0.17)
place(buf, bell(hz(83), 1.6, 0.35, 1.3), 0.19)
save("void-whisper.wav", reverb(buf, 2.4, 0.45)[: int(3.2 * SR)])

# Ringtone: E minor arpeggios (i - VI - iv - V) over a pad, twice through
prog = [
    (40, [64, 67, 71, 74, 71, 67, 64, 59]),
    (36, [60, 64, 67, 71, 67, 64, 60, 55]),
    (33, [57, 60, 64, 67, 64, 60, 57, 52]),
    (35, [59, 63, 66, 69, 66, 63, 59, 54]),
]
step = 0.27
bar = step * 8
total = bar * len(prog) * 2
buf = np.zeros(int((total + 1.5) * SR))
for rep in range(2):
    for b, (root, notes) in enumerate(prog):
        t0 = (rep * len(prog) + b) * bar
        place(buf, pad(hz(root), bar + 0.6, 0.5), t0)
        place(buf, pad(hz(root + 12), bar + 0.6, 0.18), t0)
        for k, n in enumerate(notes):
            accent = 0.75 if k % 4 == 0 else 0.5
            place(buf, bell(hz(n), 1.6, accent, 0.9), t0 + k * step)
            if k == 0:
                place(buf, bell(hz(n + 12), 1.2, 0.18, 1.2), t0 + 0.01)
save("void-call.wav", reverb(buf, 3.0, 0.4)[: int((total + 2.0) * SR)])
