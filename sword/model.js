// Procedural 3D model of the runeblade.
//
// The outline was traced from two references of the same design: a photo of a
// replica (for the hilt and guard proportions) and a render of the original
// (for the blade outline, the shield plate behind the skull and the icy look).
// All measurements are in "trace units": the whole sword is 1869 units long.
// `a` runs along the sword from the pommel tip (a = 0) to the blade tip
// (a = 1869) and `x` runs across it. Model space puts the cross-guard at the
// origin: y = GUARD_A - a, x across, z through the thickness. The tables are
// written with the serrated edge on +x; the finished model is mirrored so the
// serrations sit on the left when the sword is viewed point-down, as in both
// references. Geometry is scaled to metres at the end (about 1.12 m long).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GUARD_A = 470;
const PX = 0.0006; // metres per trace unit
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

// Wavy contour lines: a cheap stand-in for engraved filigree.
function filigree(x, y) {
  const f = Math.sin(x * 0.33 + Math.sin(y * 0.21) * 2) * Math.sin(y * 0.29 + Math.sin(x * 0.17) * 2)
    + 0.5 * Math.sin((x - y) * 0.19);
  return 1 - smooth(0.04, 0.2, Math.abs(f));
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
function ringIndices(rows, radial, index) {
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial);
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

function mirror(g, sx, sz = 1) {
  const c = g.clone();
  c.applyMatrix4(new THREE.Matrix4().makeScale(sx, 1, sz));
  if (sx * sz < 0) flipWinding(c);
  return c;
}
const mirrorX = (g) => mirror(g, -1);
const mirrorZ = (g) => mirror(g, 1, -1);

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

// Tube along a smooth curve with a radius that varies along it (horns, claws).
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

// Trace-unit outline ([x, a] points) → smoothed, resampled model-space points.
const outline = (pts, n, cut = 2) => resample(chaikin(pts, cut), n).map(([x, a]) => [x, Y(a)]);

// A flat, double-edged plate between two outlines A and B (same point count):
// a raised ridge runs between them and each side drops to a sharpened bevel.
// Used for the blade, the prong by its notch, the wing spikes and the shield
// plate. `shade(x, y, t, s)` paints engraving (t across, s along, both 0–1).
const lensZones = (n) => [
  Array.from({ length: n + 1 }, (_, k) => 0.72 * k / n),
  Array.from({ length: n + 1 }, (_, k) => 0.72 + 0.28 * k / n),
];
const lensProfile = (u) => (u <= 0.72 ? 1 - 0.32 * u / 0.72 : 0.68 * (1 - u) / 0.28);

function lens(A, B, { thick, ridge = () => 0.5, uv, shade, cols = 2 }) {
  const parts = [];
  const zones = lensZones(cols);
  for (const side of [0, 1]) {
    for (const zone of zones) {
      for (const face of [1, -1]) {
        const pos = [], uvs = [], shades = [], index = [];
        for (let i = 0; i < A.length; i++) {
          const tr = ridge(i), T = thick(i);
          for (const u of zone) {
            const t = side === 0 ? tr * (1 - u) : tr + (1 - tr) * u;
            const x = lerp(A[i][0], B[i][0], t), y = lerp(A[i][1], B[i][1], t);
            pos.push(x, y, face * T * lensProfile(u));
            if (uv) uvs.push(...uv(x, y, face));
            if (shade) shades.push(shade(x, y, t, i / (A.length - 1)));
          }
        }
        const cols = zone.length;
        for (let i = 0; i < A.length - 1; i++) {
          for (let j = 0; j < cols - 1; j++) {
            const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
            index.push(a, c, b, b, c, d);
          }
        }
        const g = makeGeometry(pos, index, shade ? shades : null, uv ? uvs : null);
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

const STEEL = new THREE.Color('#5d7586');
const STEEL_WASH = new THREE.Color('#060d13');
const WRAP = new THREE.Color('#3a4955');
const WRAP_DARK = new THREE.Color('#0a0e12');

// Turn the per-vertex `shade` (0 = raised, 1 = crevice) plus mottled noise
// into vertex colours: the dark wash that collects in engraved, worn steel.
function paint(g, base, dark, { freq = 0.13, lo = 0.52, hi = 0.8, dirt = 0.5, wash = 0.95 } = {}) {
  const p = g.attributes.position, sh = g.attributes.shade;
  const col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm(x * freq, y * freq, z * freq);
    const grime = smooth(lo, hi, n) * dirt;
    const k = 1 - (1 - grime) * (1 - (sh ? sh.getX(i) : 0) * wash);
    c.copy(base).multiplyScalar(0.88 + 0.14 * noise3(x * 0.3, y * 0.3, z * 0.3)).lerp(dark, k);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.deleteAttribute('shade');
  return g;
}

// ------------------------------------------------------------------ blade

// Edges as [a, x]. Rows above ~740 hide under the shield plate; rows 733–750
// on +x curve round the bottom of the notch beside the prong. Below a = 1200
// the blade is symmetric about its ridge.
const BLADE_SMOOTH = [
  [660, -30], [700, -38], [729, -43.5], [746, -53], [763, -67], [779, -82], [790, -88.5], [798, -91],
  [804, -89], [809, -78], [813, -70.6], [821, -65], [838, -58], [855, -54], [880, -51.7], [914, -49.4],
  [947, -51.3], [989, -56.3], [1014, -60], [1031, -65], [1045, -72], [1052, -76], [1056, -77],
  [1064, -74], [1081, -67], [1098, -62], [1115, -59], [1140, -56], [1170, -53], [1200, -50.6],
];
const BLADE_SERRATED = [
  [660, 30], [700, 38], [725, 46], [733, 50], [737, 55], [740, 62], [742, 72], [744, 82], [750, 86],
  [763, 85], [779, 81], [796, 75], [813, 69], [830, 64], [842, 61],
  [845, 66], [850, 75], [854, 81], [858, 76], [872, 67], [888, 59], [905, 53], [922, 50], [940, 50], [946, 53],
  [949, 61], [952, 67], [955, 72], [960, 68], [972, 63], [989, 57], [997, 57],
  [1000, 63], [1003, 69], [1006, 74], [1011, 69], [1023, 64], [1039, 59], [1048, 57],
  [1051, 63], [1054, 70], [1057, 75], [1063, 70], [1073, 65], [1090, 58], [1106, 55.5], [1131, 52],
  [1157, 50], [1200, 50.6],
];
const BLADE_LOWER = [ // half-width below a = 1200
  [1200, 50.6], [1240, 49.5], [1291, 47.8], [1341, 47], [1391, 45.4], [1433, 43.3], [1483, 40.6],
  [1525, 38.8], [1567, 37], [1609, 34], [1643, 31.8], [1685, 27.8], [1718, 24.1], [1760, 19.8],
  [1802, 15.2], [1844, 9], [1869, 0.6],
];
const BLADE_THICK = [[660, 9], [800, 9], [1100, 7.5], [1500, 5], [1800, 2.2], [1869, 0.7]];

const bladeEdge = (table, sign) => (a) => (a <= 1200 ? interp(table, a) : sign * interp(BLADE_LOWER, a));

// Blade texture window: x in [-130, 130], a in [640, 1870]. The traced
// outline is mirrored at the end, so u runs against x here and the
// engravings read the right way round on the finished model.
const TEX = { x0: -130, x1: 130, a0: 640, a1: 1870 };
function bladeUV(x, y, face) {
  const u = (TEX.x1 - x) / (TEX.x1 - TEX.x0);
  return [face > 0 ? u : 1 - u, (GUARD_A - y - TEX.a0) / (TEX.a1 - TEX.a0)];
}

function bladeGeometry() {
  const rows = new Set();
  for (const [a] of [...BLADE_SMOOTH, ...BLADE_SERRATED, ...BLADE_LOWER]) rows.add(a);
  for (let a = 660; a < 1869; a += 5) rows.add(a);
  const as = [...rows].sort((p, q) => p - q);
  const left = bladeEdge(BLADE_SMOOTH, -1), right = bladeEdge(BLADE_SERRATED, 1);
  const A = as.map((a) => [left(a), Y(a)]);
  const B = as.map((a) => [right(a), Y(a)]);
  const blade = lens(A, B, {
    thick: (i) => interp(BLADE_THICK, as[i]),
    ridge: (i) => clamp(-A[i][0] / (B[i][0] - A[i][0]), 0.15, 0.85),
    uv: bladeUV,
  });

  // The hooked prong beside the notch at the top of the serrated edge.
  const inner = [[63, 782], [64, 766], [66, 754], [69, 745], [74, 738], [79, 735]];
  const outer = [[85, 792], [88, 772], [89, 757], [88, 746], [84, 738], [79, 735]];
  const n = 14;
  const prong = lens(outline(inner, n, 0), outline(outer, n, 0), {
    thick: (i) => lerp(8.5, 1.2, i / (n - 1)),
    uv: bladeUV,
  });
  return mergeGeometries([blade, prong]);
}

// Canvas textures for the blade: icy steel, the dark rune band inlaid down
// its centre, a matching normal map and a glow mask.
function drawRune(ctx, rand, cx, ca) {
  const strokes = 2 + Math.floor(rand() * 2);
  const used = new Set();
  for (let s = 0; s < strokes; s++) {
    let k = Math.floor(rand() * 6);
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

// The band: wide under the shield plate, narrowing through the runes and
// ending in a diamond around the emblem.
function bandPath(ctx, inset = 0) {
  const k = inset;
  ctx.beginPath();
  ctx.moveTo(0, 752 + k * 2);
  ctx.lineTo(26 - k, 790); ctx.lineTo(22 - k, 830); ctx.lineTo(21 - k, 1090);
  ctx.lineTo(27 - k, 1130); ctx.lineTo(18 - k, 1170); ctx.lineTo(0, 1214 - k * 2);
  ctx.lineTo(-18 + k, 1170); ctx.lineTo(-27 + k, 1130); ctx.lineTo(-21 + k, 1090);
  ctx.lineTo(-22 + k, 830); ctx.lineTo(-26 + k, 790);
  ctx.closePath();
}

function emblemPath(ctx) {
  // A clawed crest inside the lower diamond of the band.
  ctx.beginPath();
  ctx.moveTo(0, 1104); ctx.lineTo(0, 1190);
  ctx.moveTo(0, 1112); ctx.quadraticCurveTo(-16, 1120, -14, 1142); ctx.quadraticCurveTo(-7, 1134, 0, 1148);
  ctx.quadraticCurveTo(7, 1134, 14, 1142); ctx.quadraticCurveTo(16, 1120, 0, 1112);
  ctx.moveTo(-7, 1156); ctx.lineTo(0, 1172); ctx.lineTo(7, 1156);
}

function drawRunes(ctx, width = 1) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.4 * width;
  const rand = rng(1869);
  for (let i = 0; i < 8; i++) drawRune(ctx, rand, 0, 858 + i * 28);
  ctx.lineWidth = 1.8 * width;
  emblemPath(ctx); ctx.stroke();
}

function bladeTextures() {
  const W = 512, H = 2048;
  const sx = W / (TEX.x1 - TEX.x0), sy = H / (TEX.a1 - TEX.a0);
  const canvas = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const toUnits = (ctx) => ctx.setTransform(sx, 0, 0, sy, -TEX.x0 * sx, -TEX.a0 * sy);

  // Colour: frost-white near the hilt deepening to glacier blue at the tip,
  // with brushed streaks and the dark inlaid band.
  const color = canvas(), cc = color.getContext('2d');
  const grad = cc.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#d9f0fc');
  grad.addColorStop((1050 - TEX.a0) / (TEX.a1 - TEX.a0), '#b4dbf2');
  grad.addColorStop((1450 - TEX.a0) / (TEX.a1 - TEX.a0), '#86bde4');
  grad.addColorStop(1, '#6aa6d6');
  cc.fillStyle = grad; cc.fillRect(0, 0, W, H);
  toUnits(cc);
  const rand = rng(7);
  for (let i = 0; i < 1600; i++) {
    const x = lerp(TEX.x0, TEX.x1, rand()), a = lerp(TEX.a0, TEX.a1, rand()), len = 30 + rand() * 360;
    cc.strokeStyle = rand() < 0.55 ? `rgba(30,70,110,${0.03 + rand() * 0.06})` : `rgba(255,255,255,${0.06 + rand() * 0.1})`;
    cc.lineWidth = 0.3 + rand() * 1.1;
    cc.beginPath(); cc.moveTo(x, a); cc.lineTo(x + (rand() - 0.5) * 2, a + len); cc.stroke();
  }
  // Dark fuller line continuing below the band.
  const fuller = cc.createLinearGradient(0, 1210, 0, 1600);
  fuller.addColorStop(0, 'rgba(20,45,70,0.7)'); fuller.addColorStop(1, 'rgba(20,45,70,0)');
  cc.strokeStyle = fuller; cc.lineWidth = 1.6;
  cc.beginPath(); cc.moveTo(0, 1210); cc.lineTo(0, 1600); cc.stroke();
  bandPath(cc); cc.fillStyle = '#1d3144'; cc.fill();
  cc.strokeStyle = '#e4f3fc'; cc.lineWidth = 2.6; bandPath(cc); cc.stroke();
  cc.strokeStyle = '#5d7d96'; cc.lineWidth = 0.8; bandPath(cc, 4); cc.stroke();
  cc.strokeStyle = '#b9e2fa'; drawRunes(cc);

  // Height: the band sits below the blade face; frame and runes stand proud.
  const height = canvas(), hc = height.getContext('2d');
  hc.fillStyle = '#808080'; hc.fillRect(0, 0, W, H);
  if ('filter' in hc) hc.filter = 'blur(1.2px)';
  toUnits(hc);
  hc.strokeStyle = '#5a5a5a'; hc.lineWidth = 1.4; hc.beginPath(); hc.moveTo(0, 1210); hc.lineTo(0, 1580); hc.stroke();
  bandPath(hc); hc.fillStyle = '#5c5c5c'; hc.fill();
  hc.strokeStyle = '#b0b0b0'; hc.lineWidth = 2.6; bandPath(hc); hc.stroke();
  hc.strokeStyle = '#8a8a8a'; drawRunes(hc);

  const hd = hc.getImageData(0, 0, W, H).data;
  const normal = canvas(), nc = normal.getContext('2d');
  const out = nc.createImageData(W, H), od = out.data;
  const h = (x, y) => hd[(clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 4] / 255;
  const strength = 4;
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

  // Glow mask: a faint frost over the whole blade, strong runes and frame.
  const glow = canvas(), gc = glow.getContext('2d');
  gc.fillStyle = '#0b2131'; gc.fillRect(0, 0, W, H);
  if ('filter' in gc) gc.filter = 'blur(3px)';
  toUnits(gc);
  gc.strokeStyle = '#3f86b0'; drawRunes(gc, 2.4);
  gc.setTransform(1, 0, 0, 1, 0, 0);
  if ('filter' in gc) gc.filter = 'none';
  toUnits(gc);
  gc.strokeStyle = '#ffffff'; drawRunes(gc);
  gc.strokeStyle = '#2d6a90'; gc.lineWidth = 1.6; bandPath(gc); gc.stroke();

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

const SKULL_W = [[396, 4], [408, 18], [425, 30], [450, 40], [480, 46], [510, 50], [535, 56], [555, 62],
  [575, 64], [600, 58], [625, 50], [650, 40], [672, 28], [690, 15], [702, 3]];
const SKULL_D = [[396, 6], [412, 16], [440, 24], [480, 30], [540, 34], [590, 32], [630, 28], [670, 22],
  [695, 15], [702, 9]];
const SKULL_CREST = [[430, 0], [470, 5], [540, 9], [620, 9], [680, 6], [702, 3]];
const SKULL_N = 2.6;
const EYE = { x: 30, a: 553 };

function skullRelief(x, a, w) {
  const ax = Math.abs(x);
  let z = interp(SKULL_CREST, a) * gauss(x / (0.13 * w + 3));
  z += 7 * gauss((ax - 30) / 16) * gauss((a - 536) / 8); // brow ridge
  z += 4 * gauss((ax - 48) / 10) * gauss((a - 580) / 14); // cheekbone
  z -= 12 * gauss((ax - EYE.x) / 12) * gauss((a - EYE.a) / 9); // eye socket
  // Overlapping scale plates down the snout, in chevrons pointing at the blade.
  const plates = smooth(585, 605, a) * (1 - smooth(0.7, 0.95, ax / w));
  const q = (a - 1.4 * ax - 585) / 20;
  z += plates * 2.2 * (q - Math.floor(q));
  // Ridged brow plates on the forehead between the horns.
  const brow = smooth(430, 455, a) * (1 - smooth(505, 525, a)) * (1 - smooth(0.55, 0.85, ax / w));
  const r = (a + 0.9 * ax - 430) / 13;
  z += brow * 1.8 * (1 - (r - Math.floor(r)));
  return z;
}

function skullShade(x, a, w) {
  const ax = Math.abs(x);
  let s = gauss((ax - EYE.x) / 13) * gauss((a - EYE.a) / 11);
  const plates = smooth(585, 605, a) * (1 - smooth(0.7, 0.95, ax / w));
  const q = (a - 1.4 * ax - 585) / 20, f = q - Math.floor(q);
  s = Math.max(s, plates * (1 - smooth(0, 0.22, f)) * 0.9);
  const brow = smooth(430, 455, a) * (1 - smooth(505, 525, a)) * (1 - smooth(0.55, 0.85, ax / w));
  const r = (a + 0.9 * ax - 430) / 13, fr = r - Math.floor(r);
  s = Math.max(s, brow * smooth(0.78, 1, fr) * 0.85);
  s = Math.max(s, 0.85 * gauss((ax - 0.13 * w - 5) / 2.2) * smooth(470, 520, a)); // grooves beside the crest
  return s;
}

function skullSurfaceZ(x, a) {
  const w = interp(SKULL_W, a), d = interp(SKULL_D, a);
  return d * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / w), SKULL_N)), 1 / SKULL_N) + skullRelief(x, a, w);
}

function skullGeometry() {
  const radial = 88, a0 = 396, a1 = 702, step = 2;
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

// Ram horns curling out of the top of the skull, ridged along their length:
// a flattened relief coil on each face of the guard.
function hornGeometry() {
  const pts = [];
  const C = [-80, 10];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const phi = (40 + 390 * t) * Math.PI / 180, R = 62 - 38 * t;
    pts.push([C[0] + R * Math.cos(phi), C[1] + R * Math.sin(phi), 6 + 30 * Math.pow(t, 0.8)]);
  }
  const groove = (t, th) => (1 - smooth(0, 0.45, Math.abs(Math.sin(Math.PI * (t * 44 + 0.08 * Math.sin(th * 2)))))) * smooth(0.98, 0.9, t);
  const front = tube(pts, {
    segments: 380,
    radial: 20,
    radius: (t) => (19 * Math.pow(1 - t, 0.6) + 4.5) * (1 - 0.06 * groove(t, 0)),
    shadeFn: (t, th) => groove(t, th) * 0.8,
  });
  const back = mirrorZ(front);
  return [front, back, mirrorX(front), mirrorX(back)];
}

// Crescent wing spikes sweeping out and down from behind the skull, each
// with an engraved strip along its length.
function spikeGeometry() {
  const upper = [[40, 600], [80, 604], [105, 612], [127, 620], [146, 630], [163, 640], [178, 650], [190, 660],
    [204, 670], [215, 680], [224, 690], [234, 700], [239, 710], [244, 720], [247, 729]];
  const lower = [[25, 702], [60, 705], [75, 697], [90, 688], [110, 684], [130, 686], [150, 692], [177, 700],
    [200, 710], [219, 720], [236, 726], [247, 729]];
  const N = 96;
  const right = lens(outline(upper, N), outline(lower, N), {
    thick: (i) => 8.5 * Math.pow(1 - i / (N - 1), 0.6) + 0.5,
    ridge: () => 0.42,
    cols: 6,
    shade: (x, y, t, s) => {
      const strip = smooth(0.1, 0.18, s) * (1 - smooth(0.68, 0.8, s));
      const lines = Math.max(gauss((t - 0.2) / 0.035), gauss((t - 0.58) / 0.035));
      const inside = smooth(0.2, 0.25, t) * (1 - smooth(0.53, 0.58, t));
      return strip * Math.max(0.85 * lines, inside * (0.35 + 0.5 * filigree(x * 1.6, y * 1.6)));
    },
  });
  return [right, mirrorX(right)];
}

// The engraved shield plate behind the skull: pointed shoulders above the
// spikes, narrowing to a V that runs onto the blade.
function plateGeometry() {
  const top = [[106, 592], [92, 574], [76, 555], [60, 541], [38, 536], [12, 545], [4, 640], [0, 768]];
  const side = [[106, 592], [101, 620], [89, 652], [70, 690], [45, 725], [20, 752], [0, 768]];
  const N = 140;
  const right = lens(outline(top, N), outline(side, N), {
    thick: (i) => 7 * Math.pow(Math.sin(Math.PI * i / (N - 1)), 0.35) + 0.5,
    ridge: () => 0.45,
    cols: 12,
    shade: (x, y, t) => Math.max(
      0.85 * gauss((t - 0.86) / 0.03),
      smooth(0.1, 0.2, t) * (1 - smooth(0.8, 0.84, t)) * 0.8 * filigree(x, y),
    ),
  });
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
    steel: mergeGeometries([withShade(cranium, 0.15), withShade(jaw, 0.3)]),
    glow: mergeGeometries([...eyes, withShade(nose)]),
  };
}

// The cross-guard arms, ending in clawed heads.
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
  // Jaw-like claws: a big hook curling up and out, one reaching out, one down.
  const groove = (t) => 0.8 * Math.max(gauss((t - 0.3) / 0.03), gauss((t - 0.6) / 0.03));
  const claw = (pts, r0 = 10) => tube(pts, {
    segments: 56, radial: 14,
    radius: (t) => r0 * Math.pow(1 - t, 0.85) + 0.5,
    shadeFn: groove,
  });
  const claws = [
    claw([[184, 2, 0], [192, 20, 4], [206, 38, 5], [224, 50, 3], [240, 52, 0], [249, 44, 0]], 12),
    claw([[205, -6, 0], [222, -12, 3], [236, -22, 3], [244, -34, 0]], 9),
    claw([[192, -24, 0], [202, -42, 4], [216, -58, 4], [230, -68, 2], [240, -72, 0]], 12),
  ];
  const skull = miniSkull(11);
  const steel = [right, ...claws];
  const glow = [];
  for (const side of [1, -1]) {
    const at = { x: 192, y: Y(480), z: 30 * side, ry: side > 0 ? 0 : Math.PI };
    steel.push(place(skull.steel.clone(), at));
    glow.push(place(skull.glow.clone(), at));
  }
  const steelRight = mergeGeometries(steel);
  const glowRight = mergeGeometries(glow);
  return { steel: [steelRight, mirrorX(steelRight)], glow: [glowRight, mirrorX(glowRight)] };
}

// Narrow, slanted glowing eyes in the skull, plus the gems at the foot of the
// shield plate, on both faces.
function glowingBits() {
  const out = [];
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const e = new THREE.SphereGeometry(1, 18, 10);
      e.scale(12, 4.2, 4);
      e.rotateZ(sx * 0.38);
      const z = skullSurfaceZ(EYE.x, EYE.a) - 2;
      e.translate(sx * EYE.x, Y(EYE.a), sz * z);
      out.push(withShade(e));
    }
    const gem = new THREE.SphereGeometry(5, 14, 10);
    gem.scale(1, 1.3, 0.7);
    gem.translate(0, Y(756), sz * 8);
    out.push(withShade(gem));
  }
  return out;
}

// ------------------------------------------------------- hilt and pommel

// Onion-domed pommel on a narrow neck, then the first grip ring.
const POMMEL = [[0, 0.5], [3, 5], [13, 16], [25, 28], [38, 39], [50, 45], [62, 48], [74, 46], [86, 40],
  [96, 33], [104, 28], [112, 25.5], [124, 25], [130, 26.5], [136, 31], [142, 36], [150, 38], [156, 36],
  [162, 31], [166, 27]];

function pommelGeometry() {
  const cage = (s) => smooth(8, 16, s) * (1 - smooth(92, 102, s));
  const beads = (s) => gauss((s - 150) / 4);
  const g = revolve(POMMEL, {
    from: 0, to: 166, step: 0.8, radial: 64,
    rFn: (s, th, r0) => r0 * (1 + 0.06 * cage(s) * Math.cos(8 * th))
      + 1.2 * beads(s) * Math.max(0, Math.cos(24 * th)),
    shadeFn: (s, th) => Math.max(
      0.85 * cage(s) * smooth(0.3, 1, (1 - Math.cos(8 * th)) / 2),
      0.8 * gauss((s - 104) / 2), 0.7 * gauss((s - 134) / 2), 0.7 * gauss((s - 163) / 2),
      0.6 * beads(s) * (1 - Math.max(0, Math.cos(24 * th))),
    ),
  });
  g.translate(0, GUARD_A, 0);
  const skull = miniSkull(13);
  const steel = [g], glow = [];
  for (const side of [1, -1]) {
    const at = { y: Y(64), z: 44 * side, ry: side > 0 ? 0 : Math.PI };
    steel.push(place(skull.steel.clone(), at));
    glow.push(place(skull.glow.clone(), at));
  }
  return { steel, glow };
}

// A grip ring with beaded rims; optionally medallions on the faces and small
// spikes on the sides.
function ringGeometry(profile, from, to, ornate) {
  const mid = (from + to) / 2;
  const rimA = from + 5, rimB = to - 5;
  const angle = (th, at) => Math.atan2(Math.sin(th - at), Math.cos(th - at));
  const g = revolve(profile, {
    from, to, step: 0.6, radial: 72,
    rFn: (s, th, r0) => {
      let r = r0 + 0.9 * (gauss((s - rimA) / 1.6) + gauss((s - rimB) / 1.6)) * Math.max(0, Math.cos(30 * th));
      if (ornate) {
        for (const at of [Math.PI / 2, -Math.PI / 2]) r += 4.5 * gauss(Math.hypot((s - mid) / 8, angle(th, at) * r0 / 8));
        for (const at of [0, Math.PI]) {
          const d = Math.hypot((s - mid) / 6, angle(th, at) * r0 / 6);
          r += 14 * Math.max(0, 1 - d) ** 1.6;
        }
      }
      return r;
    },
    shadeFn: (s, th) => Math.max(
      0.7 * (gauss((s - rimA) / 1.6) + gauss((s - rimB) / 1.6)) * (1 - Math.max(0, Math.cos(30 * th))),
      0.85 * gauss((s - from - 1.5) / 1.5), 0.85 * gauss((s - to + 1.5) / 1.5),
      ornate ? 0.8 * Math.max(...[Math.PI / 2, -Math.PI / 2].map((at) =>
        gauss((Math.hypot((s - mid) / 8, angle(th, at) * 40 / 8) - 0.75) / 0.12))) : 0,
    ),
  });
  g.translate(0, GUARD_A, 0);
  return g;
}

function gripGeometry() {
  const pitch = 5.5;
  const cord = (s, th) => {
    const f = s / pitch + th / TAU;
    const u = 2 * (f - Math.floor(f)) - 1;
    return Math.sqrt(Math.max(0, 1 - u * u));
  };
  const g = revolve([[160, 25], [402, 25]], {
    from: 160, to: 402, step: 0.8, radial: 56,
    rFn: (s, th, r0) => r0 + 1.7 * cord(s, th),
    shadeFn: (s, th) => 1 - cord(s, th),
  });
  g.translate(0, GUARD_A, 0);
  return g;
}

// ------------------------------------------------------------ assembly

export function buildRuneblade() {
  const steel = [], glow = [];

  steel.push(skullGeometry(), ...hornGeometry(), ...spikeGeometry(), ...plateGeometry());
  glow.push(...glowingBits());

  const arms = armGeometry();
  steel.push(...arms.steel); glow.push(...arms.glow);

  const pommel = pommelGeometry();
  steel.push(...pommel.steel); glow.push(...pommel.glow);

  steel.push(
    ringGeometry([[222, 25], [225, 33], [230, 36], [236, 38.5], [242, 40.5], [247, 42], [252, 40.5],
      [258, 38.5], [264, 36], [269, 33], [272, 25]], 222, 272, true),
    ringGeometry([[334, 25], [338, 31], [344, 34.5], [350, 36], [356, 34.5], [362, 31], [366, 25]], 334, 366, false),
  );

  const steelGeo = paint(mergeGeometries(steel), STEEL, STEEL_WASH);
  const gripGeo = paint(gripGeometry(), WRAP, WRAP_DARK, { freq: 0.09, lo: 0.4, hi: 0.8, dirt: 0.3, wash: 0.85 });
  const glowGeo = mergeGeometries(glow);
  glowGeo.deleteAttribute('shade');
  const bladeGeo = bladeGeometry();

  // Mirror so the serrated edge sits on the left (as in the references),
  // then scale to metres.
  for (const g of [steelGeo, gripGeo, glowGeo, bladeGeo]) {
    g.applyMatrix4(new THREE.Matrix4().makeScale(-PX, PX, PX));
    flipWinding(g);
  }

  const tex = bladeTextures();
  const frost = new THREE.Color('#8fd8ff');
  const materials = {
    steel: new THREE.MeshStandardMaterial({ name: 'Frost steel', vertexColors: true, metalness: 0.85, roughness: 0.34 }),
    wrap: new THREE.MeshStandardMaterial({ name: 'Grip wrap', vertexColors: true, metalness: 0.35, roughness: 0.55 }),
    blade: new THREE.MeshStandardMaterial({
      name: 'Rune steel', color: 0xffffff, metalness: 0.72, roughness: 0.22,
      map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
      emissive: frost, emissiveMap: tex.emissiveMap, emissiveIntensity: 0.9,
      side: THREE.DoubleSide,
    }),
    glow: new THREE.MeshStandardMaterial({ name: 'Frost glow', color: 0x16303f, metalness: 0.1, roughness: 0.4, emissive: frost, emissiveIntensity: 2.2 }),
  };

  const model = new THREE.Group();
  model.name = 'Runeblade';
  const add = (name, geo, mat) => { const m = new THREE.Mesh(geo, mat); m.name = name; model.add(m); return m; };
  add('Blade', bladeGeo, materials.blade);
  add('Guard and pommel', steelGeo, materials.steel);
  add('Grip', gripGeo, materials.wrap);
  add('Eyes and gems', glowGeo, materials.glow);

  return {
    model,
    setGlow(on) {
      materials.blade.emissiveIntensity = on ? 3.2 : 0.9;
      materials.glow.emissiveIntensity = on ? 5 : 2.2;
    },
  };
}
