// Procedural 3D model of the runeblade in the reference photo.
//
// Every measurement below was traced from the photo, in photo pixels (the whole
// sword is about 1869 px long). `a` runs along the sword from the pommel tip
// (a = 0) to the blade tip (a = 1869); `x` runs across it, with the serrated
// edge on +x. Model space puts the cross-guard at the origin: y = GUARD_A - a,
// x across, z through the thickness. Geometry is built in pixels and scaled to
// metres at the end, so the finished sword is about 1.12 m long.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GUARD_A = 470;
const PX = 0.0006; // metres per traced pixel
const Y = (a) => GUARD_A - a;

const TAU = Math.PI * 2;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, v) => { const t = clamp((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const sgnpow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
const gauss = (v) => Math.exp(-v * v);

// Piecewise-linear lookup in [[key, value], ...] sorted by key.
function interp(table, v) {
  if (v <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (v <= table[i][0]) {
      const [k0, v0] = table[i - 1], [k1, v1] = table[i];
      return lerp(v0, v1, (v - k0) / (k1 - k0));
    }
  }
  return table[table.length - 1][1];
}

// ---------------------------------------------------------------- noise

function hash3(i, j, k) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

function fbm(x, y, z) {
  let sum = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 4; o++) {
    sum += amp * noise3(x * f + o * 17.3, y * f - o * 9.1, z * f + o * 3.7);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum / 0.9375;
}

function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------- geometry helpers

function makeGeometry(pos, index, shade, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (shade) g.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

function flipWinding(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.index.needsUpdate = true;
}

// Signed volume of a closed mesh: positive when the faces point outward.
function signedVolume(g) {
  const p = g.attributes.position.array, idx = g.index.array;
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
       - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
       + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

function closedSolid(g) {
  if (signedVolume(g) < 0) flipWinding(g);
  g.computeVertexNormals();
  return g;
}

// Quads between consecutive rings of `radial` vertices that wrap around.
function ringIndices(rows, radial, index, offset = 0) {
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = offset + i * radial + j, b = offset + i * radial + ((j + 1) % radial);
      const c = a + radial, d = b + radial;
      index.push(a, c, b, b, c, d);
    }
  }
}

function capIndices(center, firstRow, lastRow, radial, index, endCenter) {
  for (let j = 0; j < radial; j++) index.push(center, firstRow + j, firstRow + ((j + 1) % radial));
  for (let j = 0; j < radial; j++) index.push(lastRow + j, endCenter, lastRow + ((j + 1) % radial));
}

function place(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1 } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(s, s, s),
  );
  g.applyMatrix4(m);
  return g;
}

function mirrorX(g) {
  const c = g.clone();
  c.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  flipWinding(c);
  c.computeVertexNormals();
  return c;
}

function withShade(g, value = 0) {
  g.deleteAttribute('uv');
  g.setAttribute('shade', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(value), 1));
  return g;
}

// Surface of revolution around the local y axis. `profile` is [[s, radius]],
// with s running down the axis (local y = -s).
function revolve(profile, { from, to, step = 1, radial = 48, rFn, shadeFn }) {
  const pos = [], shade = [], index = [];
  const n = Math.max(1, Math.round((to - from) / step));
  for (let i = 0; i <= n; i++) {
    const s = from + (to - from) * i / n, r0 = interp(profile, s);
    for (let j = 0; j < radial; j++) {
      const th = TAU * j / radial;
      const r = rFn ? rFn(s, th, r0) : r0;
      pos.push(r * Math.cos(th), -s, r * Math.sin(th));
      shade.push(shadeFn ? shadeFn(s, th, r0) : 0);
    }
  }
  const c0 = pos.length / 3;
  pos.push(0, -from, 0, 0, -to, 0);
  shade.push(0, 0);
  ringIndices(n + 1, radial, index);
  capIndices(c0, 0, n * radial, radial, index, c0 + 1);
  return closedSolid(makeGeometry(pos, index, shade));
}

// Tube along a smooth curve with a radius that varies along it (horns, talons).
function tube(points, { segments = 120, radial = 18, radius, shadeFn }) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [], shade = [], index = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, P);
    const N = frames.normals[i], B = frames.binormals[i], r = radius(t);
    for (let j = 0; j < radial; j++) {
      const th = TAU * j / radial, c = Math.cos(th), s = Math.sin(th);
      pos.push(P.x + r * (c * N.x + s * B.x), P.y + r * (c * N.y + s * B.y), P.z + r * (c * N.z + s * B.z));
      shade.push(shadeFn ? shadeFn(t, th) : 0);
    }
  }
  const start = curve.getPointAt(0), end = curve.getPointAt(1);
  const tip = end.clone().addScaledVector(frames.tangents[segments], radius(1) * 1.5);
  const c0 = pos.length / 3;
  pos.push(start.x, start.y, start.z, tip.x, tip.y, tip.z);
  shade.push(0, 0);
  ringIndices(segments + 1, radial, index);
  capIndices(c0, 0, segments * radial, radial, index, c0 + 1);
  return closedSolid(makeGeometry(pos, index, shade));
}

// Resample a 2D polyline to n points evenly spaced by arc length.
function resample(poly, n) {
  const d = [0];
  for (let i = 1; i < poly.length; i++) d.push(d[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  const total = d[d.length - 1], out = [];
  let k = 1;
  for (let i = 0; i < n; i++) {
    const target = total * i / (n - 1);
    while (k < poly.length - 1 && d[k] < target) k++;
    const t = (target - d[k - 1]) / (d[k] - d[k - 1] || 1);
    out.push([lerp(poly[k - 1][0], poly[k][0], t), lerp(poly[k - 1][1], poly[k][1], t)]);
  }
  return out;
}

// Chaikin corner cutting, keeping both end points.
function chaikin(poly, iterations = 2) {
  let p = poly;
  for (let it = 0; it < iterations; it++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[i + 1];
      q.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

// A flat, double-edged plate between two outlines A and B (same point count):
// a raised ridge runs between them and each side drops to a sharpened bevel.
// Used for the blade, the prong by its notch, the wing spikes and cheek lobes.
const lensZones = (n) => [
  Array.from({ length: n + 1 }, (_, k) => 0.72 * k / n),
  Array.from({ length: n + 1 }, (_, k) => 0.72 + 0.28 * k / n),
];
const lensProfile = (u) => (u <= 0.72 ? 1 - 0.32 * u / 0.72 : 0.68 * (1 - u) / 0.28);

function lens(A, B, { thick, ridge = () => 0.5, uv, cols = 2 }) {
  const parts = [];
  const zones = lensZones(cols);
  for (const side of [0, 1]) {
    for (const zone of zones) {
      for (const face of [1, -1]) {
        const pos = [], uvs = [], index = [];
        for (let i = 0; i < A.length; i++) {
          const tr = ridge(i), T = thick(i);
          for (const u of zone) {
            const t = side === 0 ? tr * (1 - u) : tr + (1 - tr) * u;
            const x = lerp(A[i][0], B[i][0], t), y = lerp(A[i][1], B[i][1], t);
            pos.push(x, y, face * T * lensProfile(u));
            if (uv) uvs.push(...uv(x, y, face));
          }
        }
        const cols = zone.length;
        for (let i = 0; i < A.length - 1; i++) {
          for (let j = 0; j < cols - 1; j++) {
            const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
            index.push(a, c, b, b, c, d);
          }
        }
        const g = makeGeometry(pos, index, null, uv ? uvs : null);
        // Point every strip away from the middle plane.
        let nz = 0;
        for (let k = 0; k < index.length; k += 3) {
          const p0 = index[k] * 3, p1 = index[k + 1] * 3, p2 = index[k + 2] * 3;
          nz += (pos[p1] - pos[p0]) * (pos[p2 + 1] - pos[p0 + 1]) - (pos[p1 + 1] - pos[p0 + 1]) * (pos[p2] - pos[p0]);
        }
        if (Math.sign(nz) !== face) flipWinding(g);
        g.computeVertexNormals();
        parts.push(g);
      }
    }
  }
  return mergeGeometries(parts);
}

// --------------------------------------------------------------- colouring

const SILVER = new THREE.Color('#c3c7cd');
const WASH = new THREE.Color('#1b1c20');
const LEATHER = new THREE.Color('#5f5139');
const LEATHER_DARK = new THREE.Color('#1f1810');

// Turn the per-vertex `shade` (0 = raised, 1 = crevice) plus mottled noise
// into vertex colours: the dark wash that collects in an antiqued casting.
function paint(g, base, dark, { freq = 0.11, lo = 0.52, hi = 0.75, dirt = 0.7, wash = 0.95 } = {}) {
  const p = g.attributes.position, sh = g.attributes.shade;
  const col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm(x * freq, y * freq, z * freq);
    const grime = smooth(lo, hi, n) * dirt;
    const k = 1 - (1 - grime) * (1 - (sh ? sh.getX(i) : 0) * wash);
    c.copy(base).multiplyScalar(0.9 + 0.12 * noise3(x * 0.3, y * 0.3, z * 0.3)).lerp(dark, k);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.deleteAttribute('shade');
  return g;
}

// ------------------------------------------------------------------ blade

// Edges traced from the photo as [a, x]. The top rows hide under the skull;
// rows 736–748 on +x curve round the bottom of the notch beside the prong.
const BLADE_LEFT = [
  [660, -30], [700, -42], [736, -63], [777, -92], [791, -94], [808, -65], [813, -66], [832, -59],
  [864, -54], [869, -55], [903, -52], [915, -54], [951, -53], [989, -56], [1012, -61], [1037, -71],
  [1046, -79], [1053, -79], [1065, -73], [1098, -64], [1132, -58], [1162, -55], [1188, -53],
  [1300, -53], [1380, -51], [1440, -48], [1530, -41], [1620, -36], [1700, -29], [1760, -22],
  [1810, -15], [1845, -8], [1869, -0.6],
];
const BLADE_RIGHT = [
  [660, 30], [700, 40], [728, 47], [736, 50], [739, 54], [741, 60], [743, 68], [745, 80], [748, 92],
  [767, 86], [814, 69], [829, 67], [832, 68], [841, 80], [854, 83], [859, 78], [876, 68], [896, 61],
  [916, 58], [936, 60], [940, 69], [949, 77], [956, 77], [959, 74], [965, 73], [979, 66], [986, 66],
  [995, 78], [1001, 79], [1026, 69], [1040, 66], [1049, 77], [1057, 78], [1079, 71], [1086, 67],
  [1129, 60], [1163, 59], [1174, 57], [1209, 57], [1240, 55], [1380, 52], [1450, 48], [1530, 43],
  [1620, 37], [1700, 30], [1770, 23], [1810, 16], [1845, 8], [1869, 0.6],
];
const BLADE_THICK = [[660, 10], [800, 10], [1100, 8.5], [1500, 5.5], [1800, 2.4], [1869, 0.8]];

// Blade texture window: x in [-130, 130], a in [640, 1870].
const TEX = { x0: -130, x1: 130, a0: 640, a1: 1870 };
// The traced outline is mirrored (see buildRuneblade), so u runs against x
// here and the engravings read the right way round on the finished model.
function bladeUV(x, y, face) {
  const u = (TEX.x1 - x) / (TEX.x1 - TEX.x0);
  return [face > 0 ? u : 1 - u, (GUARD_A - y - TEX.a0) / (TEX.a1 - TEX.a0)];
}

function bladeGeometry() {
  const rows = new Set();
  for (const [a] of BLADE_LEFT) rows.add(a);
  for (const [a] of BLADE_RIGHT) rows.add(a);
  for (let a = 660; a < 1869; a += 5) rows.add(a);
  const as = [...rows].sort((p, q) => p - q);
  const A = as.map((a) => [interp(BLADE_LEFT, a), Y(a)]);
  const B = as.map((a) => [interp(BLADE_RIGHT, a), Y(a)]);
  const blade = lens(A, B, {
    thick: (i) => interp(BLADE_THICK, as[i]),
    ridge: (i) => clamp(-A[i][0] / (B[i][0] - A[i][0]), 0.15, 0.85),
    uv: bladeUV,
  });

  // The hooked prong on the serrated side of the blade root.
  const inner = [[66, 764], [67, 750], [69, 738], [72, 726], [76, 717], [81, 712]];
  const outer = [[91, 764], [94, 748], [95, 734], [94, 724], [89, 716], [81, 712]];
  const PA = resample(inner, 14).map(([x, a]) => [x, Y(a)]);
  const PB = resample(outer, 14).map(([x, a]) => [x, Y(a)]);
  const prong = lens(PA, PB, { thick: (i) => lerp(9.5, 1.2, i / 13), uv: bladeUV });
  return mergeGeometries([blade, prong]);
}

// Canvas textures for the blade: brushed steel, the engraved rune panel and
// the emblem below it, plus a matching normal map and a glow mask.
function drawRune(ctx, rand, cx, ca) {
  const pick = () => Math.floor(rand() * 6);
  const strokes = 2 + Math.floor(rand() * 2);
  const used = new Set();
  for (let s = 0; s < strokes; s++) {
    let k = pick();
    while (used.has(k)) k = (k + 1) % 6;
    used.add(k);
    const flip = rand() < 0.5 ? -1 : 1;
    ctx.beginPath();
    switch (k) {
      case 0: // stem with a hooked foot
        ctx.moveTo(cx - 2 * flip, ca - 9); ctx.lineTo(cx - 2 * flip, ca + 5);
        ctx.quadraticCurveTo(cx - 2 * flip, ca + 9, cx + 4 * flip, ca + 8); break;
      case 1: // open bowl
        ctx.moveTo(cx - 6 * flip, ca - 6); ctx.quadraticCurveTo(cx + 9 * flip, ca - 8, cx + 4 * flip, ca + 1);
        ctx.quadraticCurveTo(cx - 1 * flip, ca + 5, cx + 6 * flip, ca + 9); break;
      case 2: // slanted bar
        ctx.moveTo(cx - 7, ca - 2 + 3 * flip); ctx.lineTo(cx + 7, ca - 2 - 3 * flip); break;
      case 3: // small loop
        ctx.ellipse(cx + 3 * flip, ca - 3, 3.2, 4, 0, 0, TAU); break;
      case 4: // zig-zag
        ctx.moveTo(cx - 6, ca + 7); ctx.lineTo(cx - 1 * flip, ca - 8); ctx.lineTo(cx + 2 * flip, ca + 4); ctx.lineTo(cx + 7, ca - 6); break;
      default: // crescent
        ctx.arc(cx, ca + 2, 6, flip > 0 ? Math.PI * 0.15 : Math.PI * 1.15, flip > 0 ? Math.PI * 0.95 : Math.PI * 1.95); break;
    }
    ctx.stroke();
  }
}

function panelPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, 806); ctx.lineTo(12, 824); ctx.lineTo(16, 846); ctx.lineTo(16, 1040);
  ctx.lineTo(23, 1068); ctx.lineTo(15, 1100); ctx.lineTo(0, 1140); ctx.lineTo(-15, 1100);
  ctx.lineTo(-23, 1068); ctx.lineTo(-16, 1040); ctx.lineTo(-16, 846); ctx.lineTo(-12, 824);
  ctx.closePath();
}

function emblemPath(ctx) {
  // A clawed crest inside the lower diamond of the panel.
  ctx.beginPath();
  ctx.moveTo(0, 1050); ctx.lineTo(0, 1118);
  ctx.moveTo(0, 1060); ctx.quadraticCurveTo(-14, 1066, -12, 1084); ctx.quadraticCurveTo(-6, 1078, 0, 1090);
  ctx.quadraticCurveTo(6, 1078, 12, 1084); ctx.quadraticCurveTo(14, 1066, 0, 1060);
  ctx.moveTo(-6, 1096); ctx.lineTo(0, 1108); ctx.lineTo(6, 1096);
}

function drawMarks(ctx, { panelFill, line, width = 1 }) {
  if (panelFill) { panelPath(ctx); ctx.fillStyle = panelFill; ctx.fill(); }
  ctx.strokeStyle = line;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.5 * width;
  panelPath(ctx); ctx.stroke();
  ctx.lineWidth = 2.2 * width;
  const rand = rng(1869);
  for (let i = 0; i < 7; i++) drawRune(ctx, rand, 0, 858 + i * 27);
  ctx.lineWidth = 1.8 * width;
  emblemPath(ctx); ctx.stroke();
}

function bladeTextures() {
  const W = 512, H = 2048;
  const sx = W / (TEX.x1 - TEX.x0), sy = H / (TEX.a1 - TEX.a0);
  const canvas = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const toUnits = (ctx) => ctx.setTransform(sx, 0, 0, sy, -TEX.x0 * sx, -TEX.a0 * sy);

  // Colour: brushed steel streaks running along the blade, dark engravings.
  const color = canvas(), cc = color.getContext('2d');
  cc.fillStyle = '#ffffff'; cc.fillRect(0, 0, W, H);
  toUnits(cc);
  const rand = rng(7);
  for (let i = 0; i < 1400; i++) {
    const x = lerp(TEX.x0, TEX.x1, rand()), a = lerp(TEX.a0, TEX.a1, rand()), len = 30 + rand() * 360;
    cc.strokeStyle = rand() < 0.6 ? `rgba(40,44,52,${0.025 + rand() * 0.05})` : `rgba(255,255,255,${0.05 + rand() * 0.08})`;
    cc.lineWidth = 0.3 + rand() * 1.1;
    cc.beginPath(); cc.moveTo(x, a); cc.lineTo(x + (rand() - 0.5) * 2, a + len); cc.stroke();
  }
  drawMarks(cc, { panelFill: 'rgba(120,124,132,0.16)', line: '#202227' });

  // Height: engravings cut into a very slightly raised panel.
  const height = canvas(), hc = height.getContext('2d');
  hc.fillStyle = '#808080'; hc.fillRect(0, 0, W, H);
  if ('filter' in hc) hc.filter = 'blur(1.2px)';
  toUnits(hc);
  drawMarks(hc, { panelFill: '#8e8e8e', line: '#262626' });

  const hd = hc.getImageData(0, 0, W, H).data;
  const normal = canvas(), nc = normal.getContext('2d');
  const out = nc.createImageData(W, H), od = out.data;
  const h = (x, y) => hd[(clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 4] / 255;
  const strength = 5;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * W + x) * 4;
      od[o] = (-dx / len * 0.5 + 0.5) * 255;
      od[o + 1] = (dy / len * 0.5 + 0.5) * 255;
      od[o + 2] = (1 / len * 0.5 + 0.5) * 255;
      od[o + 3] = 255;
    }
  }
  nc.putImageData(out, 0, 0);

  // Glow mask for the optional frost-glow look.
  const glow = canvas(), gc = glow.getContext('2d');
  gc.fillStyle = '#000'; gc.fillRect(0, 0, W, H);
  if ('filter' in gc) gc.filter = 'blur(3px)';
  toUnits(gc);
  drawMarks(gc, { line: '#5fa8c8', width: 2.2 });
  gc.setTransform(1, 0, 0, 1, 0, 0);
  if ('filter' in gc) gc.filter = 'none';
  toUnits(gc);
  drawMarks(gc, { line: '#ffffff' });

  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: tex(color, true), normalMap: tex(normal, false), emissiveMap: tex(glow, true) };
}

// ------------------------------------------------------------- the skull

const SKULL_W = [[396, 4], [408, 18], [425, 30], [450, 40], [480, 46], [510, 50], [535, 56], [555, 64],
  [580, 72], [600, 72], [620, 62], [645, 50], [665, 43], [690, 33], [715, 24], [740, 16], [765, 10],
  [790, 5], [806, 1.5]];
const SKULL_D = [[396, 6], [412, 16], [440, 24], [480, 30], [540, 34], [590, 32], [630, 27], [670, 22],
  [710, 17], [750, 13], [790, 10], [806, 7]];
const SKULL_CREST = [[430, 0], [470, 5], [540, 9], [620, 9], [720, 6], [806, 2]];
const SKULL_N = 2.6;
const EYE = { x: 34, a: 562 };

function skullRelief(x, a, w) {
  const ax = Math.abs(x);
  let z = interp(SKULL_CREST, a) * gauss(x / (0.13 * w + 3));
  z += 7 * gauss((ax - 33) / 16) * gauss((a - 544) / 8); // brow ridge
  z += 4 * gauss((ax - 52) / 10) * gauss((a - 585) / 14); // cheekbone
  z -= 12 * gauss((ax - EYE.x) / 11) * gauss((a - EYE.a) / 10); // eye socket
  // Overlapping scale plates down the snout, in chevrons pointing at the blade.
  const plates = smooth(590, 625, a) * (1 - smooth(0.7, 0.95, ax / w));
  const q = (a - 1.4 * ax - 590) / 24;
  z += plates * 2.4 * (q - Math.floor(q));
  // Ridged brow plates on the forehead between the horns.
  const brow = smooth(430, 455, a) * (1 - smooth(515, 535, a)) * (1 - smooth(0.55, 0.85, ax / w));
  const r = (a + 0.9 * ax - 430) / 13;
  z += brow * 1.8 * (1 - (r - Math.floor(r)));
  return z;
}

function skullShade(x, a, w) {
  const ax = Math.abs(x);
  let s = gauss((ax - EYE.x) / 12) * gauss((a - EYE.a) / 10);
  const plates = smooth(590, 625, a) * (1 - smooth(0.7, 0.95, ax / w));
  const q = (a - 1.4 * ax - 590) / 24, f = q - Math.floor(q);
  s = Math.max(s, plates * (1 - smooth(0, 0.22, f)) * 0.9);
  const brow = smooth(430, 455, a) * (1 - smooth(515, 535, a)) * (1 - smooth(0.55, 0.85, ax / w));
  const r = (a + 0.9 * ax - 430) / 13, fr = r - Math.floor(r);
  s = Math.max(s, brow * smooth(0.78, 1, fr) * 0.85);
  s = Math.max(s, 0.85 * gauss((ax - 0.13 * w - 5) / 2.2) * smooth(470, 520, a)); // grooves beside the crest
  s = Math.max(s, 0.7 * gauss((ax - 0.62 * w) / 2.5) * smooth(600, 640, a)); // snout edge lines
  return s;
}

function skullSurfaceZ(x, a) {
  const w = interp(SKULL_W, a), d = interp(SKULL_D, a);
  return d * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / w), SKULL_N)), 1 / SKULL_N) + skullRelief(x, a, w);
}

function skullGeometry() {
  const radial = 88, a0 = 396, a1 = 806, step = 2.5;
  const n = Math.round((a1 - a0) / step);
  const pos = [], shade = [], index = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    const w = interp(SKULL_W, a), d = interp(SKULL_D, a);
    for (let j = 0; j < radial; j++) {
      const th = TAU * j / radial, c = Math.cos(th), s = Math.sin(th);
      const x = w * sgnpow(c, 2 / SKULL_N);
      const fade = smooth(0.05, 0.45, Math.abs(s));
      const z = d * sgnpow(s, 2 / SKULL_N) + Math.sign(s) * skullRelief(x, a, w) * fade;
      pos.push(x, Y(a), z);
      shade.push(skullShade(x, a, w) * fade);
    }
  }
  const c0 = pos.length / 3;
  pos.push(0, Y(a0 - 2), 0, 0, Y(a1 + 3), 0);
  shade.push(0, 0);
  ringIndices(n + 1, radial, index);
  capIndices(c0, 0, n * radial, radial, index, c0 + 1);
  return closedSolid(makeGeometry(pos, index, shade));
}

// Ram horns curling out of the top of the skull, ridged along their length.
function hornGeometry() {
  // A flattened relief coil (as on the casting), on both faces of the guard.
  const pts = [];
  const C = [-75, 10];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const phi = (40 + 390 * t) * Math.PI / 180, R = 60 - 38 * t;
    pts.push([C[0] + R * Math.cos(phi), C[1] + R * Math.sin(phi), 6 + 30 * Math.pow(t, 0.8)]);
  }
  const groove = (t, th) => (1 - smooth(0, 0.45, Math.abs(Math.sin(Math.PI * (t * 44 + 0.08 * Math.sin(th * 2)))))) * smooth(0.98, 0.9, t);
  const front = tube(pts, {
    segments: 380,
    radial: 20,
    radius: (t) => (19 * Math.pow(1 - t, 0.6) + 4.5) * (1 - 0.06 * groove(t, 0)),
    shadeFn: (t, th) => groove(t, th) * 0.75,
  });
  const back = front.clone();
  back.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1));
  flipWinding(back);
  return [front, back, mirrorX(front), mirrorX(back)];
}

// Crescent wing spikes sweeping out and down from the skull's cheeks.
function spikeGeometry() {
  const upper = [[40, 600], [80, 604], [105, 612], [127, 620], [146, 630], [163, 640], [178, 650], [190, 660],
    [204, 670], [215, 680], [224, 690], [234, 700], [239, 710], [244, 720], [247, 729]];
  const lower = [[25, 702], [60, 705], [75, 697], [90, 688], [110, 684], [130, 686], [150, 692], [177, 700],
    [200, 710], [219, 720], [236, 726], [247, 729]];
  const N = 96;
  const A = resample(chaikin(upper), N).map(([x, a]) => [x, Y(a)]);
  const B = resample(chaikin(lower), N).map(([x, a]) => [x, Y(a)]);
  const right = lens(A, B, { thick: (i) => 8.5 * Math.pow(1 - i / (N - 1), 0.6) + 0.5, ridge: () => 0.42, cols: 6 });
  withShade(right);
  return [right, mirrorX(right)];
}

function cheekGeometry() {
  const outer = [[45, 540], [80, 552], [100, 566], [110, 585], [112, 603], [108, 618]];
  const inner = [[40, 590], [65, 598], [85, 604], [100, 611], [108, 618]];
  const N = 24;
  const A = resample(chaikin(outer), N).map(([x, a]) => [x, Y(a)]);
  const B = resample(chaikin(inner), N).map(([x, a]) => [x, Y(a)]);
  const right = lens(A, B, { thick: (i) => 10 * Math.pow(1 - i / (N - 1), 0.5) + 0.6, ridge: () => 0.4, cols: 5 });
  withShade(right);
  return [right, mirrorX(right)];
}

// Tiny skull ornaments (pommel and guard ends), facing +z.
function miniSkull(size) {
  const cranium = new THREE.SphereGeometry(size, 22, 16);
  cranium.scale(1, 0.92, 0.78);
  const jaw = new THREE.SphereGeometry(size * 0.62, 16, 12);
  jaw.scale(1, 0.7, 0.8);
  jaw.translate(0, -size * 0.78, size * 0.12);
  const eyes = [-1, 1].map((sx) => {
    const e = new THREE.SphereGeometry(size * 0.27, 12, 10);
    e.translate(sx * size * 0.38, -size * 0.12, size * 0.56);
    return withShade(e);
  });
  const nose = new THREE.SphereGeometry(size * 0.13, 10, 8);
  nose.translate(0, -size * 0.45, size * 0.66);
  return {
    silver: mergeGeometries([withShade(cranium, 0.15), withShade(jaw, 0.3)]),
    dark: mergeGeometries([...eyes, withShade(nose)]),
  };
}

// The cross-guard arms with clawed ends.
function armGeometry() {
  const profile = [[30, 21], [100, 21], [106, 24], [112, 26], [118, 24], [124, 21], [140, 21], [146, 25],
    [154, 27], [160, 24], [166, 24], [172, 29], [182, 32], [194, 33], [204, 31], [212, 26], [218, 18],
    [222, 8], [224, 0.5]];
  const rings = [106, 124, 146, 160, 171];
  const right = revolve(profile, {
    from: 30, to: 224, step: 1, radial: 40,
    rFn: (s, th, r0) => r0 * (1 + 0.07 * Math.cos(6 * th) * smooth(172, 182, s)),
    shadeFn: (s, th) => Math.max(
      ...rings.map((k) => 0.8 * gauss((s - k) / 2.2)),
      0.6 * (1 - Math.cos(6 * th)) / 2 * smooth(172, 182, s) * (1 - smooth(214, 222, s)),
    ),
  });
  place(right, { rz: Math.PI / 2 });
  right.translate(0, Y(480), 0);
  // Three talons gripping each end.
  const groove = (t) => 0.8 * Math.max(gauss((t - 0.34) / 0.03), gauss((t - 0.66) / 0.03));
  const talon = (pts) => tube(pts, {
    segments: 48, radial: 14,
    radius: (t) => 10 * Math.pow(1 - t, 0.9) + 0.5,
    shadeFn: groove,
  });
  const talons = [
    talon([[182, 2, 0], [188, 16, 3], [194, 32, 5], [202, 46, 3], [208, 54, 0]]),
    talon([[205, -6, 0], [222, -14, 3], [234, -28, 3], [240, -44, 0]]),
    talon([[192, -26, 0], [200, -42, 4], [212, -58, 4], [228, -71, 0]]),
  ];
  const skull = miniSkull(11);
  const silver = [right, ...talons];
  const dark = [];
  for (const side of [1, -1]) {
    const s = skull.silver.clone(), d = skull.dark.clone();
    place(s, { x: 192, y: Y(480), z: 30 * side, ry: side > 0 ? 0 : Math.PI });
    place(d, { x: 192, y: Y(480), z: 30 * side, ry: side > 0 ? 0 : Math.PI });
    silver.push(s); dark.push(d);
  }
  const silverRight = mergeGeometries(silver);
  const darkRight = mergeGeometries(dark);
  return { silver: [silverRight, mirrorX(silverRight)], dark: [darkRight, mirrorX(darkRight)] };
}

function skullEyes() {
  const out = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const e = new THREE.SphereGeometry(1, 16, 12);
      e.scale(10, 7, 5);
      const z = skullSurfaceZ(EYE.x, EYE.a) - 2.5;
      e.translate(sx * EYE.x, Y(EYE.a), sz * z);
      out.push(withShade(e));
    }
  }
  return out;
}

// ------------------------------------------------------- hilt and pommel

const POMMEL = [[0, 0.5], [2, 6], [6, 11], [10, 14], [16, 20], [22, 26], [28, 32], [34, 37.5], [40, 42.5],
  [44, 45], [48, 47], [56, 47.5], [64, 49], [70, 47.5], [76, 46], [84, 42], [92, 37], [98, 33], [104, 31],
  [110, 29], [118, 29.5], [122, 30], [126, 32.5], [132, 35], [138, 36.5], [142, 37], [146, 35], [152, 30]];

function pommelGeometry() {
  const crown = (s) => smooth(5, 10, s) * (1 - smooth(34, 40, s));
  const beads = (s) => gauss((s - 137) / 4);
  const g = revolve(POMMEL, {
    from: 0, to: 152, step: 0.8, radial: 64,
    rFn: (s, th, r0) => r0 * (1 + 0.07 * crown(s) * Math.cos(10 * th))
      + 1.2 * beads(s) * Math.max(0, Math.cos(24 * th)),
    shadeFn: (s, th) => Math.max(
      0.75 * crown(s) * (1 - Math.cos(10 * th)) / 2,
      0.8 * gauss((s - 44) / 1.6), 0.8 * gauss((s - 73) / 1.6),
      0.8 * gauss((s - 102) / 2), 0.7 * gauss((s - 124) / 2), 0.6 * beads(s) * (1 - Math.max(0, Math.cos(24 * th))),
    ),
  });
  g.translate(0, GUARD_A, 0);
  const skull = miniSkull(14);
  const silver = [g], dark = [];
  for (const side of [1, -1]) {
    const s = skull.silver.clone(), d = skull.dark.clone();
    const at = { y: Y(58), z: 44 * side, ry: side > 0 ? 0 : Math.PI };
    silver.push(place(s, at)); dark.push(place(d, at));
  }
  return { silver, dark };
}

function ringGeometry(profile, from, to, bosses) {
  const mid = (from + to) / 2;
  const rimA = from + 5, rimB = to - 5;
  const g = revolve(profile, {
    from, to, step: 0.6, radial: 72,
    rFn: (s, th, r0) => {
      let r = r0 + 0.9 * (gauss((s - rimA) / 1.6) + gauss((s - rimB) / 1.6)) * Math.max(0, Math.cos(30 * th));
      if (bosses) {
        for (let k = 0; k < 4; k++) {
          const dth = Math.atan2(Math.sin(th - k * Math.PI / 2 - Math.PI / 2), Math.cos(th - k * Math.PI / 2 - Math.PI / 2));
          r += 4.5 * gauss(Math.hypot((s - mid) / 8, dth * r0 / 8));
        }
      }
      return r;
    },
    shadeFn: (s, th) => Math.max(
      0.7 * (gauss((s - rimA) / 1.6) + gauss((s - rimB) / 1.6)) * (1 - Math.max(0, Math.cos(30 * th))),
      0.85 * gauss((s - from - 1.5) / 1.5), 0.85 * gauss((s - to + 1.5) / 1.5),
    ),
  });
  g.translate(0, GUARD_A, 0);
  return g;
}

function gripGeometry() {
  const pitch = 6.5;
  const cord = (s, th) => {
    const f = s / pitch + th / TAU;
    const u = 2 * (f - Math.floor(f)) - 1;
    return Math.sqrt(Math.max(0, 1 - u * u));
  };
  const g = revolve([[148, 29], [402, 29]], {
    from: 148, to: 402, step: 0.9, radial: 56,
    rFn: (s, th, r0) => r0 + 1.9 * cord(s, th),
    shadeFn: (s, th) => 1 - cord(s, th),
  });
  g.translate(0, GUARD_A, 0);
  return g;
}

// ------------------------------------------------------------ assembly

export function buildRuneblade() {
  const silver = [], dark = [];

  silver.push(skullGeometry(), ...hornGeometry(), ...spikeGeometry(), ...cheekGeometry());
  dark.push(...skullEyes());

  const arms = armGeometry();
  silver.push(...arms.silver); dark.push(...arms.dark);

  const pommel = pommelGeometry();
  silver.push(...pommel.silver); dark.push(...pommel.dark);

  silver.push(
    ringGeometry([[218, 29], [221, 35], [226, 36.5], [232, 38.5], [240, 40.5], [246, 42.5], [250, 42.5],
      [256, 40.5], [262, 38.5], [268, 36.5], [272, 29]], 218, 272, true),
    ringGeometry([[330, 29], [334, 33], [340, 35.5], [346, 37], [352, 36.5], [356, 34.5], [360, 29]], 330, 360, false),
  );

  const silverGeo = paint(mergeGeometries(silver), SILVER, WASH);
  const gripGeo = paint(gripGeometry(), LEATHER, LEATHER_DARK, { freq: 0.09, lo: 0.4, hi: 0.8, dirt: 0.35, wash: 0.85 });
  const darkGeo = mergeGeometries(dark);
  darkGeo.deleteAttribute('shade');
  const bladeGeo = bladeGeometry();

  // The trace was taken looking at the far face of the sword; mirror it so the
  // model's front matches the photo (serrated edge on the left), then scale.
  for (const g of [silverGeo, gripGeo, darkGeo, bladeGeo]) {
    g.applyMatrix4(new THREE.Matrix4().makeScale(-PX, PX, PX));
    flipWinding(g);
  }

  const tex = bladeTextures();
  const glowColor = new THREE.Color('#7fdcff');
  const materials = {
    silver: new THREE.MeshStandardMaterial({ name: 'Antique silver', vertexColors: true, metalness: 0.9, roughness: 0.36 }),
    leather: new THREE.MeshStandardMaterial({ name: 'Leather wrap', vertexColors: true, metalness: 0, roughness: 0.82 }),
    blade: new THREE.MeshStandardMaterial({
      name: 'Blade steel', color: 0x757a81, metalness: 0.88, roughness: 0.44,
      map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
      emissive: glowColor, emissiveMap: tex.emissiveMap, emissiveIntensity: 0,
      side: THREE.DoubleSide,
    }),
    eyes: new THREE.MeshStandardMaterial({ name: 'Eye sockets', color: 0x0b0c0f, metalness: 0.2, roughness: 0.7, emissive: glowColor, emissiveIntensity: 0 }),
  };

  const model = new THREE.Group();
  model.name = 'Runeblade';
  const add = (name, geo, mat) => { const m = new THREE.Mesh(geo, mat); m.name = name; model.add(m); return m; };
  add('Blade', bladeGeo, materials.blade);
  add('Guard and pommel', silverGeo, materials.silver);
  add('Grip', gripGeo, materials.leather);
  add('Eyes', darkGeo, materials.eyes);

  return {
    model,
    setGlow(on) {
      materials.blade.emissiveIntensity = on ? 2.4 : 0;
      materials.eyes.emissiveIntensity = on ? 4 : 0;
    },
  };
}
