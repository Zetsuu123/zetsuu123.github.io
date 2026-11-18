"""Builds icons.html: every Void icon as an inline SVG, ready for render.mjs to screenshot.

usage: python3 build_icons.py <node_modules dir> <out.html>
"""
import hashlib
import math
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from icons import ICONS, PALETTE as P  # noqa: E402

NM = Path(sys.argv[1])
OUT = Path(sys.argv[2])
S = 512  # canvas
C = S / 2


def squircle(a=250.0, n=3.9, steps=240):
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        x = C + a * math.copysign(abs(ct) ** (2 / n), ct)
        y = C + a * math.copysign(abs(st) ** (2 / n), st)
        pts.append(f"{x:.2f},{y:.2f}")
    return "M" + " L".join(pts) + " Z"


SQ = squircle()


def glyph_svg(spec):
    kind, name = spec.split(":", 1)
    if kind == "lucide":
        src = (NM / "lucide-static/icons" / f"{name}.svg").read_text()
        inner = re.search(r"<svg[^>]*>(.*)</svg>", src, re.S).group(1)
        size = 212
        k = size / 24
        return (f'<g transform="translate({C - size / 2},{C - size / 2}) scale({k})" fill="none" '
                f'stroke="{P["starlight"]}" stroke-width="1.65" stroke-linecap="round" '
                f'stroke-linejoin="round">{inner}</g>')
    src = (NM / "simple-icons/icons" / f"{name}.svg").read_text()
    d = re.search(r'<path d="([^"]+)"', src).group(1)
    size = 178
    k = size / 24
    return (f'<g transform="translate({C - size / 2},{C - size / 2}) scale({k})">'
            f'<path d="{d}" fill="{P["starlight"]}"/></g>')


def layers(seed, glyph, dim=False):
    rnd = random.Random(seed)
    out = []
    # nebula wisps
    for _ in range(4):
        cx, cy = rnd.uniform(60, 452), rnd.uniform(60, 452)
        rx, ry = rnd.uniform(90, 190), rnd.uniform(40, 110)
        col = rnd.choice([P["indigo"], P["twilight"], P["arcane"], P["deep"]])
        op = rnd.uniform(0.18, 0.38)
        out.append(f'<ellipse cx="{cx:.0f}" cy="{cy:.0f}" rx="{rx:.0f}" ry="{ry:.0f}" fill="{col}" '
                   f'opacity="{op:.2f}" filter="url(#neb)" transform="rotate({rnd.uniform(0, 180):.0f} {cx:.0f} {cy:.0f})"/>')
    # stars
    for _ in range(46):
        x, y = rnd.uniform(14, 498), rnd.uniform(14, 498)
        r = rnd.choice([0.7, 0.9, 1.1, 1.4, 1.9])
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{P["starlight"]}" opacity="{rnd.uniform(0.25, 0.85):.2f}"/>')
    # portal (like the orbs either side of the wallpaper figure)
    R = 170
    rot = rnd.uniform(0, 360)
    out.append(f'<g transform="rotate({rot:.0f} {C} {C})">')
    out.append(f'<circle cx="{C}" cy="{C}" r="{R}" fill="none" stroke="url(#ring)" stroke-width="30" opacity="0.55" filter="url(#halo)"/>')
    out.append(f'<circle cx="{C}" cy="{C}" r="{R}" fill="url(#hole)"/>')
    # sparkling rim: particles bunched into two bright arcs
    for _ in range(260):
        arc = rnd.choice([0, 180]) + rnd.gauss(0, 55)
        a = math.radians(arc)
        rr = R + rnd.gauss(0, 7)
        x, y = C + rr * math.cos(a), C + rr * math.sin(a)
        b = math.exp(-((((arc % 180) + 90) % 180 - 90) / 70) ** 2)
        col = P["starlight"] if rnd.random() < 0.35 else rnd.choice([P["haze"], P["glow"], "#8fa6ff"])
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rnd.uniform(0.6, 2.0):.1f}" fill="{col}" opacity="{0.25 + 0.7 * b:.2f}"/>')
    out.append(f'<circle cx="{C}" cy="{C}" r="{R}" fill="none" stroke="url(#ring)" stroke-width="2.4" opacity="0.9"/>')
    out.append("</g>")
    body = "\n".join(out)
    g = f'<g filter="url(#glow)">{glyph}</g>' if glyph else ""
    return f'''<g clip-path="url(#sq)">
<rect width="{S}" height="{S}" fill="url(#bg)"/>
<g opacity="{0.6 if dim else 1}">{body}</g>
</g>
<path d="{SQ}" fill="none" stroke="url(#rim)" stroke-width="3"/>
{g}'''


DEFS = f'''<svg width="0" height="0" style="position:absolute"><defs>
<clipPath id="sq"><path d="{SQ}"/></clipPath>
<radialGradient id="bg" cx="50%" cy="42%" r="70%">
  <stop offset="0" stop-color="{P["deep"]}"/><stop offset=".55" stop-color="{P["void"]}"/><stop offset="1" stop-color="{P["abyss"]}"/>
</radialGradient>
<radialGradient id="hole" r="50%">
  <stop offset="0" stop-color="#000"/><stop offset=".78" stop-color="#03020a"/><stop offset=".94" stop-color="#0d0b2c"/><stop offset="1" stop-color="#1c1a52"/>
</radialGradient>
<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="{P["starlight"]}"/><stop offset=".3" stop-color="{P["glow"]}"/>
  <stop offset=".55" stop-color="{P["indigo"]}" stop-opacity=".4"/><stop offset=".8" stop-color="{P["arcane"]}"/><stop offset="1" stop-color="#8fa6ff"/>
</linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="{P["haze"]}" stop-opacity=".9"/><stop offset=".45" stop-color="{P["twilight"]}" stop-opacity=".25"/>
  <stop offset=".8" stop-color="{P["indigo"]}" stop-opacity=".2"/><stop offset="1" stop-color="{P["glow"]}" stop-opacity=".55"/>
</linearGradient>
<filter id="neb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="34"/></filter>
<filter id="halo" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
<filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width="{S}" height="{S}">
  <feGaussianBlur in="SourceAlpha" stdDeviation="16" result="b1"/>
  <feFlood flood-color="{P["arcane"]}" flood-opacity=".95"/><feComposite in2="b1" operator="in" result="g1"/>
  <feGaussianBlur in="SourceAlpha" stdDeviation="4.5" result="b2"/>
  <feFlood flood-color="{P["glow"]}"/><feComposite in2="b2" operator="in" result="g2"/>
  <feMerge><feMergeNode in="g1"/><feMergeNode in="g1"/><feMergeNode in="g2"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
</defs></svg>'''


def seed(name):
    return int(hashlib.sha1(name.encode()).hexdigest()[:8], 16)


items = []
for row in ICONS:
    name, label, spec = row[0], row[1], row[2]
    items.append(f'<div class="icon" id="{name}" title="{label}"><svg width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
                 f'{layers(seed(name), glyph_svg(spec))}</svg></div>')
# the icon pack app's own launcher icon
items.append(f'<div class="icon" id="ic_launcher"><svg width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
             f'{layers(seed("ic_launcher"), glyph_svg("lucide:moon-star"))}</svg></div>')
items.append(f'<div class="icon" id="iconback"><svg width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
             f'{layers(seed("iconback"), "", dim=True)}</svg></div>')
items.append(f'<div class="icon" id="iconmask"><svg width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
             f'<path d="{SQ}" fill="#fff"/></svg></div>')

OUT.write_text(f'''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;background:transparent}} .icon{{width:{S}px;height:{S}px;display:inline-block;vertical-align:top}}
</style></head><body>{DEFS}{"".join(items)}</body></html>''')
print(f"{len(items)} icons -> {OUT}")
