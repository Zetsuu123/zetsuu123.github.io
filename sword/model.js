// Procedural 3D model of the runeblade.
//
// The silhouette was traced from reference images of the design; everything
// else (skulls, horns, dragon heads, engraving) is modelled here from simple
// shapes. All measurements are in "trace units": the whole sword is 1869 units
// long. `a` runs along the sword from the pommel tip (a = 0) to the blade tip
// (a = 1869) and `x` runs across it. Model space puts the cross-guard at the
// origin: y = GUARD_A - a, x across, z through the thickness (+z is the front).
// The tables are written with the serrated edge on +x; the finished model is
// mirrored so the serrations sit on the left when the sword hangs point-down,
// as in the references. Geometry is scaled to metres at the end (≈1.12 m).

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

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

function matrix({ x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1 } = {}) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s),
  );
}

function place(g, opts) {
  g.applyMatrix4(matrix(opts));
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

// Strip a primitive down to position + normal and give it a flat shade value,
// so it can be merged with the procedural meshes.
function prim(g, value = 0) {
  g.deleteAttribute('uv');
  g.setAttribute('shade', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(value), 1));
  return g;
}

const sphere = (r, w = 16, h = 12) => prim(new THREE.SphereGeometry(r, w, h));

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

// A loft along local +x: superelliptic cross-sections of half-height ry(u)
// and half-width rz(u) around a centre line (cy(u), cz(u)), with an optional
// radial displacement and shade. Used for skull-like heads and jaws.
function loftX({ from, to, step = 1, radial = 48, n = 2.4, ry, rz, cy = () => 0, cz = () => 0, disp, shade }) {
  const pos = [], shades = [], index = [];
  const rows = Math.max(1, Math.round((to - from) / step));
  for (let i = 0; i <= rows; i++) {
    const u = from + (to - from) * i / rows;
    const hy = ry(u), hz = rz(u), oy = cy(u), oz = cz(u);
    for (let j = 0; j < radial; j++) {
      const th = TAU * j / radial;
      const y0 = hy * sgnpow(Math.cos(th), 2 / n), z0 = hz * sgnpow(Math.sin(th), 2 / n);
      const len = Math.hypot(y0, z0) || 1;
      const d = disp ? disp(u, y0, z0) : 0;
      pos.push(u, oy + y0 + d * y0 / len, oz + z0 + d * z0 / len);
      shades.push(shade ? shade(u, y0, z0) : 0);
    }
  }
  const c0 = pos.length / 3;
  pos.push(from, cy(from), cz(from), to, cy(to), cz(to));
  shades.push(0, 0);
  ringIndices(rows + 1, radial, index);
  capIndices(c0, 0, rows * radial, radial, index, c0 + 1);
  return closedSolid(makeGeometry(pos, index, shades));
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
// Used for the blade, its spine, the prong, the spikes and the shield plate.
// `uv(x, y, face, t, s)` gives texture coordinates (t across, s along, 0–1).
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
            if (uv) uvs.push(...uv(x, y, face, t, i / (A.length - 1)));
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

const BONE = new THREE.Color('#87a5ab');
const BONE_DARK = new THREE.Color('#15232a');
const SILVER = new THREE.Color('#d2d9de');
const SILVER_DARK = new THREE.Color('#14191e');
const LEATHER = new THREE.Color('#25282c');
const LEATHER_DARK = new THREE.Color('#060708');

// Turn the per-vertex `shade` (0 = raised, 1 = crevice) plus mottled noise
// into vertex colours: dirt that collects in grooves and pits.
function paint(g, base, dark, { freq = 0.12, lo = 0.55, hi = 0.85, dirt = 0.35, wash = 0.95 } = {}) {
  const p = g.attributes.position, sh = g.attributes.shade;
  const col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm(x * freq, y * freq, z * freq);
    const grime = smooth(lo, hi, n) * dirt;
    const k = 1 - (1 - grime) * (1 - (sh ? sh.getX(i) : 0) * wash);
    c.copy(base).multiplyScalar(0.9 + 0.12 * noise3(x * 0.25, y * 0.25, z * 0.25)).lerp(dark, k);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.deleteAttribute('shade');
  return g;
}

function dropShade(g) { g.deleteAttribute('shade'); return g; }

// ---------------------------------------------------------- canvas textures

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function normalFromHeight(src, strength) {
  const W = src.width, H = src.height;
  const hd = src.getContext('2d').getImageData(0, 0, W, H).data;
  const out = canvas(W, H), oc = out.getContext('2d');
  const img = oc.createImageData(W, H), od = img.data;
  const h = (x, y) => hd[(clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 4] / 255;
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
  oc.putImageData(img, 0, 0);
  return out;
}

function texture(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function brushed(ctx, W, H, seed, count, along = 'y') {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const p = rand() * (along === 'y' ? W : H), q = rand() * (along === 'y' ? H : W), len = 20 + rand() * 300;
    ctx.strokeStyle = rand() < 0.55 ? `rgba(40,55,70,${0.03 + rand() * 0.05})` : `rgba(255,255,255,${0.05 + rand() * 0.09})`;
    ctx.lineWidth = 0.5 + rand() * 1.5;
    ctx.beginPath();
    if (along === 'y') { ctx.moveTo(p, q); ctx.lineTo(p + (rand() - 0.5) * 3, q + len); }
    else { ctx.moveTo(q, p); ctx.lineTo(q + len, p + (rand() - 0.5) * 3); }
    ctx.stroke();
  }
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
  const n = 14;
  const prong = lens(
    outline([[63, 782], [64, 766], [66, 754], [69, 745], [74, 738], [79, 735]], n, 0),
    outline([[85, 792], [88, 772], [89, 757], [88, 746], [84, 738], [79, 735]], n, 0),
    { thick: (i) => lerp(8.5, 1.2, i / (n - 1)), uv: bladeUV },
  );

  // A raised spine running down the middle of the lower blade.
  const spineRows = [];
  for (let a = 1196; a <= 1660; a += 6) spineRows.push(a);
  const half = (a) => lerp(9, 1.5, smooth(1196, 1660, a)) * smooth(1196, 1215, a);
  const spine = lens(
    spineRows.map((a) => [-half(a), Y(a)]),
    spineRows.map((a) => [half(a), Y(a)]),
    { thick: (i) => interp(BLADE_THICK, spineRows[i]) + 2.6 * (1 - smooth(1500, 1660, spineRows[i])), uv: bladeUV },
  );
  return mergeGeometries([blade, prong, spine]);
}

// Runes: invented glyphs built from a handful of strokes.
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
      case 0:
        ctx.moveTo(cx - 2 * flip, ca - 9); ctx.lineTo(cx - 2 * flip, ca + 5);
        ctx.quadraticCurveTo(cx - 2 * flip, ca + 9, cx + 4 * flip, ca + 8); break;
      case 1:
        ctx.moveTo(cx - 6 * flip, ca - 6); ctx.quadraticCurveTo(cx + 9 * flip, ca - 8, cx + 4 * flip, ca + 1);
        ctx.quadraticCurveTo(cx - 1 * flip, ca + 5, cx + 6 * flip, ca + 9); break;
      case 2:
        ctx.moveTo(cx - 7, ca - 2 + 3 * flip); ctx.lineTo(cx + 7, ca - 2 - 3 * flip); break;
      case 3:
        ctx.ellipse(cx + 3 * flip, ca - 3, 3.2, 4, 0, 0, TAU); break;
      case 4:
        ctx.moveTo(cx - 6, ca + 7); ctx.lineTo(cx - 1 * flip, ca - 8); ctx.lineTo(cx + 2 * flip, ca + 4); ctx.lineTo(cx + 7, ca - 6); break;
      default:
        ctx.arc(cx, ca + 2, 6, flip > 0 ? Math.PI * 0.15 : Math.PI * 1.15, flip > 0 ? Math.PI * 0.95 : Math.PI * 1.95); break;
    }
    ctx.stroke();
  }
}

// The dark inlaid band down the upper blade, ending in a diamond.
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

// Engraved edge lines that follow both blade edges a little way in.
function drawEdgeLines(ctx) {
  const left = bladeEdge(BLADE_SMOOTH, -1), right = bladeEdge(BLADE_SERRATED, 1);
  for (const [edge, k] of [[left, 0.8], [right, 0.8]]) {
    ctx.beginPath();
    for (let a = 830; a <= 1820; a += 4) {
      const x = edge(a) * k;
      if (a === 830) ctx.moveTo(x, a); else ctx.lineTo(x, a);
    }
    ctx.stroke();
  }
}

function bladeTextures() {
  const W = 512, H = 2048;
  const sx = W / (TEX.x1 - TEX.x0), sy = H / (TEX.a1 - TEX.a0);
  const toUnits = (ctx) => ctx.setTransform(sx, 0, 0, sy, -TEX.x0 * sx, -TEX.a0 * sy);

  // Colour: polished steel with a cold tint, brushed along the blade.
  const color = canvas(W, H), cc = color.getContext('2d');
  const grad = cc.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#e4ecf1');
  grad.addColorStop(0.5, '#d2dee7');
  grad.addColorStop(1, '#bccfdd');
  cc.fillStyle = grad; cc.fillRect(0, 0, W, H);
  brushed(cc, W, H, 7, 1800);
  toUnits(cc);
  cc.strokeStyle = 'rgba(40,58,74,0.55)'; cc.lineWidth = 0.9; drawEdgeLines(cc);
  bandPath(cc); cc.fillStyle = '#1f2a33'; cc.fill();
  cc.strokeStyle = '#f5fbff'; cc.lineWidth = 2.6; bandPath(cc); cc.stroke();
  cc.strokeStyle = '#64798a'; cc.lineWidth = 0.8; bandPath(cc, 4); cc.stroke();
  cc.strokeStyle = '#9fe6ff'; drawRunes(cc);

  // Height: the band sits below the blade face; frame and runes stand proud.
  const height = canvas(W, H), hc = height.getContext('2d');
  hc.fillStyle = '#808080'; hc.fillRect(0, 0, W, H);
  if ('filter' in hc) hc.filter = 'blur(1.2px)';
  toUnits(hc);
  hc.strokeStyle = '#646464'; hc.lineWidth = 1; drawEdgeLines(hc);
  bandPath(hc); hc.fillStyle = '#5c5c5c'; hc.fill();
  hc.strokeStyle = '#b0b0b0'; hc.lineWidth = 2.6; bandPath(hc); hc.stroke();
  hc.strokeStyle = '#8a8a8a'; drawRunes(hc);

  // Glow mask: runes and emblem with a soft halo.
  const glow = canvas(W, H), gc = glow.getContext('2d');
  gc.fillStyle = '#000'; gc.fillRect(0, 0, W, H);
  if ('filter' in gc) gc.filter = 'blur(3px)';
  toUnits(gc);
  gc.strokeStyle = '#3f86b0'; drawRunes(gc, 2.4);
  gc.setTransform(1, 0, 0, 1, 0, 0);
  if ('filter' in gc) gc.filter = 'none';
  toUnits(gc);
  gc.strokeStyle = '#ffffff'; drawRunes(gc);

  return {
    map: texture(color, true),
    normalMap: texture(normalFromHeight(height, 4), false),
    emissiveMap: texture(glow, true),
  };
}

// Tribal scrollwork for the spikes and shield plate. Texture space: u runs
// along a piece (0 at its root), v across it (0 at its upper edge).
function ornamentTextures() {
  const W = 1024, H = 256;
  const drawScroll = (ctx, fill) => {
    ctx.fillStyle = fill; ctx.strokeStyle = fill;
    ctx.lineCap = 'round';
    // A tapering vine along the strip...
    const vine = (u) => [u * W, H * (0.44 + 0.05 * Math.sin(u * 18))];
    const thick = (u) => H * 0.05 * smooth(0.12, 0.2, u) * (1 - smooth(0.55, 0.72, u)) + 1;
    ctx.beginPath();
    for (let u = 0.12; u <= 0.72; u += 0.004) { const [x, y] = vine(u); ctx.lineTo(x, y - thick(u)); }
    for (let u = 0.72; u >= 0.12; u -= 0.004) { const [x, y] = vine(u); ctx.lineTo(x, y + thick(u)); }
    ctx.fill();
    // ...with curling tendrils that alternate above and below it.
    [0.2, 0.3, 0.4, 0.5, 0.6].forEach((u0, k) => {
      const dir = k % 2 ? 1 : -1;
      const [x0, y0] = vine(u0);
      const size = H * (0.2 - k * 0.022);
      for (let i = 0; i < 70; i++) {
        const t = i / 70, ang = t * Math.PI * 2.2;
        const r = size * (1 - t * 0.85);
        const cx = x0 + size * 0.9, cy = y0 + dir * size * 0.55;
        const x = cx - r * Math.cos(ang) * 1.6, y = cy - dir * r * Math.sin(ang) * 0.9;
        ctx.lineWidth = H * 0.04 * (1 - t) + 1.2;
        if (i === 0) { ctx.beginPath(); ctx.moveTo(x0, y0); }
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y);
      }
    });
    // A diamond stud where the vine starts.
    const [dx, dy] = vine(0.12);
    ctx.beginPath(); ctx.moveTo(dx - 26, dy); ctx.lineTo(dx, dy - 20); ctx.lineTo(dx + 26, dy); ctx.lineTo(dx, dy + 20); ctx.closePath(); ctx.fill();
  };

  const color = canvas(W, H), cc = color.getContext('2d');
  cc.fillStyle = '#e9eff3'; cc.fillRect(0, 0, W, H);
  brushed(cc, W, H, 11, 900, 'x');
  cc.strokeStyle = 'rgba(30,40,50,0.5)'; cc.lineWidth = 3;
  cc.beginPath(); cc.moveTo(W * 0.08, H * 0.16); cc.lineTo(W * 0.8, H * 0.2); cc.stroke();
  drawScroll(cc, '#252d35');

  const height = canvas(W, H), hc = height.getContext('2d');
  hc.fillStyle = '#909090'; hc.fillRect(0, 0, W, H);
  if ('filter' in hc) hc.filter = 'blur(1.5px)';
  hc.strokeStyle = '#606060'; hc.lineWidth = 3;
  hc.beginPath(); hc.moveTo(W * 0.08, H * 0.16); hc.lineTo(W * 0.8, H * 0.2); hc.stroke();
  drawScroll(hc, '#4a4a4a');

  return { map: texture(color, true), normalMap: texture(normalFromHeight(height, 3), false) };
}

// ------------------------------------------------------------ the ram skull

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
  z += 8 * gauss((ax - 30) / 16) * gauss((a - 535) / 8); // brow ridge
  z += 5 * gauss((ax - 48) / 10) * gauss((a - 582) / 14); // cheekbone
  z -= 14 * gauss((ax - EYE.x) / 12) * gauss((a - EYE.a) / 9); // eye socket
  z -= 4 * gauss((ax - 9) / 4) * gauss((a - 688) / 6); // nostrils
  // Overlapping plates down the snout, in chevrons pointing at the blade.
  const plates = smooth(585, 605, a) * (1 - smooth(0.7, 0.95, ax / w));
  const q = (a - 1.4 * ax - 585) / 20;
  z += plates * 2.2 * (q - Math.floor(q));
  // Ridged brow plates on the forehead.
  const brow = smooth(430, 455, a) * (1 - smooth(505, 520, a)) * (1 - smooth(0.55, 0.85, ax / w));
  const r = (a + 0.9 * ax - 430) / 13;
  z += brow * 1.8 * (1 - (r - Math.floor(r)));
  return z;
}

function skullShade(x, a, w) {
  const ax = Math.abs(x);
  let s = gauss((ax - EYE.x) / 13) * gauss((a - EYE.a) / 11);
  s = Math.max(s, gauss((ax - 9) / 4) * gauss((a - 688) / 6));
  const plates = smooth(585, 605, a) * (1 - smooth(0.7, 0.95, ax / w));
  const q = (a - 1.4 * ax - 585) / 20, f = q - Math.floor(q);
  s = Math.max(s, plates * (1 - smooth(0, 0.22, f)) * 0.8);
  const brow = smooth(430, 455, a) * (1 - smooth(505, 520, a)) * (1 - smooth(0.55, 0.85, ax / w));
  const r = (a + 0.9 * ax - 430) / 13, fr = r - Math.floor(r);
  s = Math.max(s, brow * smooth(0.78, 1, fr) * 0.8);
  return s;
}

function skullSurfaceZ(x, a) {
  const w = interp(SKULL_W, a), d = interp(SKULL_D, a);
  return d * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / w), SKULL_N)), 1 / SKULL_N) + skullRelief(x, a, w);
}

function ramSkull() {
  const radial = 96, a0 = 396, a1 = 702, step = 1.6;
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
  const skull = closedSolid(makeGeometry(pos, index, shade));

  // Glowing eyes, inlaid glowing lines down the snout and cheeks, and the
  // gem at the foot of the shield plate — on both faces.
  const glow = [];
  const onSurface = (pts, face, r) => tube(
    pts.map(([x, a]) => [x, Y(a), face * (skullSurfaceZ(x, a) - r * 0.4)]),
    { segments: 48, radial: 8, radius: (t) => r * (0.35 + 0.65 * Math.sin(Math.PI * clamp(t * 1.1, 0, 1)) ** 0.5) },
  );
  for (const face of [1, -1]) {
    for (const sx of [-1, 1]) {
      const e = new THREE.SphereGeometry(1, 20, 12);
      e.scale(13, 5, 4.5);
      e.rotateZ(sx * 0.42);
      e.translate(sx * EYE.x, Y(EYE.a), face * (skullSurfaceZ(EYE.x, EYE.a) - 1.5));
      glow.push(prim(e));
      glow.push(prim(onSurface([[sx * 7, 580], [sx * 8.5, 610], [sx * 8, 640], [sx * 6.5, 668]], face, 1.2)));
      glow.push(prim(onSurface([[sx * 40, 566], [sx * 47, 590], [sx * 45, 612], [sx * 38, 630]], face, 1.1)));
    }
    const gem = new THREE.SphereGeometry(5.5, 16, 12);
    gem.scale(1, 1.35, 0.7);
    gem.translate(0, Y(756), face * 8);
    glow.push(prim(gem));
  }
  return { bone: [skull], glow };
}

// Ram horns: true 3D coils that leave the top of the skull, sweep back over
// and around the cross-guard arms, and come forward again at the sides.
function ramHorns() {
  // Up and out of the top of the skull, back over, then round the bracer
  // (whose axis is at y = Y(480), z = 0) and forward again at the front.
  const ay = Y(480);
  const pts = [
    [10, ay + 28, 2], [30, ay + 50, 6], [55, ay + 68, 4], [80, ay + 66, -12], [98, ay + 42, -38],
    [104, ay, -46], [100, ay - 38, -30], [92, ay - 50, 4], [86, ay - 32, 32], [84, ay - 2, 40], [86, ay + 22, 30],
  ];
  const groove = (t, th) => (1 - smooth(0, 0.42, Math.abs(Math.sin(Math.PI * (t * 46 + 0.1 * Math.sin(th * 2)))))) * smooth(0.98, 0.9, t);
  const right = tube(pts, {
    segments: 420,
    radial: 22,
    radius: (t) => (19 * Math.pow(1 - t, 0.7) + 4) * smooth(-0.04, 0.08, t) * (1 - 0.08 * groove(t, 0)) * (1 + 0.06 * Math.sin(t * 9)),
    shadeFn: (t, th) => groove(t, th) * 0.9,
  });
  return [right, mirrorX(right)];
}

// ------------------------------------------------------- spikes and plate

// UVs for engraved pieces: u along the piece, v across it.
const pieceUV = (x, y, face, t, s) => [s, t];

// Crescent wing spikes sweeping out and down from behind the skull, and a
// smaller inner pair fanning down beside the blade.
function spikes() {
  const wingUpper = [[40, 600], [80, 604], [105, 612], [127, 620], [146, 630], [163, 640], [178, 650], [190, 660],
    [204, 670], [215, 680], [224, 690], [234, 700], [239, 710], [244, 720], [247, 729]];
  const wingLower = [[25, 702], [60, 705], [75, 697], [90, 688], [110, 684], [130, 686], [150, 692], [177, 700],
    [200, 710], [219, 720], [236, 726], [247, 729]];
  const N = 120;
  const wing = lens(outline(wingUpper, N), outline(wingLower, N), {
    thick: (i) => 9 * Math.pow(1 - i / (N - 1), 0.6) + 0.5,
    ridge: () => 0.42,
    cols: 4,
    uv: pieceUV,
  });
  const innerUpper = [[20, 640], [55, 652], [85, 672], [110, 700], [128, 730], [140, 760], [146, 792]];
  const innerLower = [[14, 704], [45, 712], [72, 724], [95, 742], [115, 762], [132, 778], [146, 792]];
  const M = 80;
  const inner = lens(outline(innerUpper, M), outline(innerLower, M), {
    thick: (i) => 4.5 * Math.pow(1 - i / (M - 1), 0.6) + 0.4,
    ridge: () => 0.45,
    cols: 3,
    uv: pieceUV,
  });
  // The inner pair is thinner, so the wings sit on top where they overlap.
  const pair = mergeGeometries([wing, inner]);
  return [pair, mirrorX(pair)];
}

// The engraved shield plate behind the skull: pointed shoulders above the
// spikes, narrowing to a V that runs onto the blade.
function shieldPlate() {
  const top = [[106, 592], [92, 574], [76, 555], [60, 541], [38, 536], [12, 545], [4, 640], [0, 768]];
  const side = [[106, 592], [101, 620], [89, 652], [70, 690], [45, 725], [20, 752], [0, 768]];
  const N = 120;
  const right = lens(outline(top, N), outline(side, N), {
    thick: (i) => 7 * Math.pow(Math.sin(Math.PI * i / (N - 1)), 0.35) + 0.5,
    ridge: () => 0.45,
    cols: 6,
    uv: (x, y, face, t, s) => [0.1 + 0.75 * s, 0.15 + 0.7 * t],
  });
  return [right, mirrorX(right)];
}

// ------------------------------------------------------- arms and heads

// Studs evenly spaced round a ring of radius r at local depth s (revolve frame).
function studRing(s, r, count, size, phase = 0) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const th = phase + TAU * k / count;
    const g = sphere(size, 10, 8);
    g.translate(r * Math.cos(th), -s, r * Math.sin(th));
    out.push(g);
  }
  return out;
}

// A demon/dragon head facing local +x with its jaw dropped open.
function dragonHead() {
  const RY = [[0, 17], [10, 23], [26, 25], [40, 21], [54, 15], [70, 12], [86, 9], [96, 3]];
  const RZ = [[0, 18], [10, 23], [26, 25], [40, 21], [54, 14], [70, 12], [86, 10], [96, 3]];
  const CY = [[0, 0], [26, 4], [54, 3], [96, -3]];
  const eye = { u: 40, y: 9 };
  const side = (y, z) => Math.abs(z) / (Math.hypot(y, z) || 1);
  const head = loftX({
    from: 0, to: 96, step: 1, radial: 48, n: 2.3,
    ry: (u) => interp(RY, u), rz: (u) => interp(RZ, u), cy: (u) => interp(CY, u),
    disp: (u, y, z) => {
      let d = -8 * gauss((u - eye.u) / 6) * gauss((y - eye.y) / 6) * smooth(0.45, 0.85, side(y, z));
      d += 4 * gauss((u - 33) / 6) * gauss((y - 18) / 5); // brow
      d -= 3 * gauss((u - 90) / 3) * gauss((y - 3) / 3) * smooth(0.2, 0.7, side(y, z)); // nostrils
      d += y > 0 ? 1.2 * Math.max(0, Math.sin(u * 0.75)) * smooth(0.1, 0.4, 1 - side(y, z)) : 0; // scaly ridges
      return d;
    },
    shade: (u, y, z) => Math.max(
      gauss((u - eye.u) / 7) * gauss((y - eye.y) / 7) * smooth(0.45, 0.85, side(y, z)),
      gauss((u - 90) / 3) * gauss((y - 3) / 3),
      y > 0 ? 0.6 * smooth(0.85, 1, Math.cos(u * 0.75)) * smooth(0.1, 0.4, 1 - side(y, z)) : 0,
      y < 0 ? 0.5 * smooth(0.3, 0.9, -y / interp(RY, u)) * smooth(40, 60, u) : 0,
    ),
  });
  const jawCY = (u) => -12 - (u - 14) * 0.34;
  const jaw = loftX({
    from: 14, to: 86, step: 1.2, radial: 28, n: 2.2,
    ry: (u) => lerp(7, 3, (u - 14) / 72), rz: (u) => lerp(17, 6, (u - 14) / 72) , cy: jawCY,
    shade: (u, y) => (y > 0 ? 0.4 : 0),
  });
  const bone = [head, jaw];
  // Fangs on the upper jaw pointing down, smaller ones on the lower jaw.
  for (let u = 52; u <= 88; u += 7) {
    for (const sz of [-1, 1]) {
      const up = new THREE.ConeGeometry(2.3, 8, 7);
      up.rotateX(Math.PI);
      up.translate(u, interp(CY, u) - interp(RY, u) * 0.8 - 3, sz * interp(RZ, u) * 0.6);
      bone.push(prim(up, 0.05));
      const low = new THREE.ConeGeometry(1.8, 6, 7);
      low.translate(u - 3, jawCY(u - 3) + lerp(7, 3, (u - 17) / 72) + 2, sz * lerp(17, 6, (u - 17) / 72) * 0.6);
      bone.push(prim(low, 0.05));
    }
  }
  // Swept-back horns.
  for (const sz of [-1, 1]) {
    bone.push(tube([[30, 18, sz * 10], [16, 30, sz * 16], [-2, 40, sz * 22], [-22, 46, sz * 24]], {
      segments: 40, radial: 12,
      radius: (t) => 7 * Math.pow(1 - t, 0.8) + 0.6,
      shadeFn: (t) => 0.6 * (1 - smooth(0, 0.4, Math.abs(Math.sin(Math.PI * t * 7)))),
    }));
  }
  const glow = [-1, 1].map((sz) => {
    const e = new THREE.SphereGeometry(1, 14, 10);
    e.scale(6, 3, 2.5);
    e.translate(eye.u, interp(CY, eye.u) + eye.y, sz * (interp(RZ, eye.u) - 5));
    return prim(e);
  });
  return { bone, glow };
}

// Silver bracers with gold studs along the cross-guard, each ending in a head.
function arms() {
  const profile = [[40, 21], [56, 21], [60, 25], [66, 27], [72, 27], [76, 24], [100, 24], [104, 26],
    [118, 26], [122, 24], [146, 24], [150, 27], [160, 29], [166, 29], [170, 26], [174, 22]];
  const rings = [60, 76, 104, 122, 150, 170];
  const bracer = revolve(profile, {
    from: 40, to: 174, step: 0.8, radial: 48,
    rFn: (s, th, r0) => r0 + 0.8 * smooth(80, 84, s) * (1 - smooth(96, 100, s)) * Math.max(0, Math.cos(10 * th))
      + 0.8 * smooth(126, 130, s) * (1 - smooth(142, 146, s)) * Math.max(0, Math.cos(10 * th + Math.PI / 10)),
    shadeFn: (s, th) => Math.max(
      ...rings.map((k) => 0.85 * gauss((s - k) / 1.6)),
      0.6 * smooth(80, 84, s) * (1 - smooth(96, 100, s)) * (1 - Math.max(0, Math.cos(10 * th))),
      0.6 * smooth(126, 130, s) * (1 - smooth(142, 146, s)) * (1 - Math.max(0, Math.cos(10 * th + Math.PI / 10))),
    ),
  });
  const gold = [...studRing(69, 27.2, 12, 2.6), ...studRing(111, 26.2, 12, 2.4, TAU / 24), ...studRing(163, 29.2, 12, 2.6)];
  const toArm = matrix({ y: Y(480), rz: Math.PI / 2 });
  bracer.applyMatrix4(toArm);
  for (const g of gold) g.applyMatrix4(toArm);

  const head = dragonHead();
  const toHead = matrix({ x: 166, y: Y(480) - 2, rz: -0.12 });
  for (const g of [...head.bone, ...head.glow]) g.applyMatrix4(toHead);

  const silverR = bracer, goldR = mergeGeometries(gold);
  const boneR = mergeGeometries(head.bone), glowR = mergeGeometries(head.glow);
  return {
    silver: [silverR, mirrorX(silverR)],
    gold: [goldR, mirrorX(goldR)],
    bone: [boneR, mirrorX(boneR)],
    glow: [glowR, mirrorX(glowR)],
  };
}

// ------------------------------------------------------- hilt and pommel

// A human skull, deformed from a sphere: cranium, deep eye sockets, nasal
// cavity, cheekbones, teeth and a separate jaw. Unit size, facing +z.
function humanSkull() {
  let g = new THREE.SphereGeometry(1, 120, 90);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const shade = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(x);
    const front = smooth(0.25, 0.75, z);
    const low = smooth(-0.05, -0.85, y);
    // Base proportions: a rounded cranium narrowing into the face.
    let X = x * 0.8 * (1 - 0.24 * low), Yp = y * (y > 0 ? 0.86 : 0.98), Z = z * (z > 0 ? 1.0 : 1.08);
    if (z < 0) Z *= 1 - 0.4 * smooth(-0.1, -0.9, y); // tuck the back of the skull under
    if (z > 0) Z *= 1 - 0.12 * low;
    let d = 0, s = 0;
    const eye = gauss(Math.hypot(ax - 0.36, (y + 0.06) * 1.15) / 0.2) * front;
    d -= 0.34 * eye; s = Math.max(s, smooth(0.15, 0.7, eye));
    const nose = gauss(Math.hypot(x * 1.5, (y + 0.44) * 0.9) / 0.12) * front;
    d -= 0.2 * nose; s = Math.max(s, nose);
    d += 0.08 * gauss(Math.hypot(ax - 0.55, y + 0.3) / 0.16) * smooth(0, 0.5, z); // cheekbones
    d += 0.05 * gauss((y - 0.16) / 0.06) * front * (1 - smooth(0.45, 0.7, ax)); // brow
    d -= 0.07 * gauss(Math.hypot(ax - 0.8, y - 0.02) / 0.22) * (1 - front); // temples
    const seam = gauss((y + 0.74) / 0.035) * front;
    s = Math.max(s, 0.85 * seam);
    s = Math.max(s, 0.6 * gauss(x / 0.02) * smooth(0.2, 0.6, y)); // sagittal suture
    p.setXYZ(i, X * (1 + d), Yp * (1 + d), Z * (1 + d));
    shade[i] = s;
  }
  g.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
  g.computeVertexNormals();

  const parts = [g];
  // Jaw: a flattened, U-shaped lower piece.
  let jaw = new THREE.SphereGeometry(1, 48, 24);
  jaw.deleteAttribute('uv');
  jaw = mergeVertices(jaw);
  const jp = jaw.attributes.position;
  for (let i = 0; i < jp.count; i++) {
    const x = jp.getX(i), y = jp.getY(i), z = jp.getZ(i);
    jp.setXYZ(i, x * 0.5 * (1 - 0.25 * smooth(0, 1, z)), y * 0.16 - (z > 0 ? 0.05 * z : 0), z * 0.5);
  }
  jaw.computeVertexNormals();
  jaw.translate(0, -0.98, 0.13);
  parts.push(prim(jaw, 0.1));
  // Teeth along the upper and lower jaw lines.
  for (let k = -3.5; k <= 3.5; k++) {
    const ang = k * 0.2;
    const tooth = new THREE.SphereGeometry(0.075, 10, 8);
    tooth.scale(0.8, 1.4, 0.7);
    tooth.translate(Math.sin(ang) * 0.5, -0.8, 0.12 + Math.cos(ang) * 0.5);
    parts.push(prim(tooth, 0.1));
  }
  const skull = mergeGeometries(parts);
  const glow = [-1, 1].map((sx) => {
    const e = new THREE.SphereGeometry(0.11, 16, 12);
    e.scale(1, 0.8, 0.7);
    e.translate(sx * 0.34, -0.08, 0.6);
    return prim(e);
  });
  return { skull, glow };
}

function pommel() {
  const R = 44, centre = Y(78);
  const head = humanSkull();
  const bone = head.skull.applyMatrix4(matrix({ y: centre, s: R }));
  const glow = head.glow.map((g) => g.applyMatrix4(matrix({ y: centre, s: R })));
  // A gold flame-shaped finial on the crown.
  const finial = revolve([[0, 0.5], [6, 3], [14, 7], [22, 10.5], [28, 10], [32, 7], [36, 4]], {
    from: 0, to: 36, step: 0.5, radial: 32,
    rFn: (s, th, r0) => r0 * (1 + 0.18 * Math.cos(5 * th + s * 0.18) * smooth(4, 12, s)),
  });
  finial.translate(0, Y(4), 0);
  // Silver collar under the jaw, joining the skull to the grip.
  const collar = revolve([[118, 14], [124, 24], [132, 30], [140, 33], [148, 33], [154, 30], [160, 26], [164, 24]], {
    from: 118, to: 164, step: 0.5, radial: 56,
    shadeFn: (s) => Math.max(0.85 * gauss((s - 140) / 1.4), 0.85 * gauss((s - 154) / 1.4)),
  });
  collar.translate(0, GUARD_A, 0);
  const gold = [finial, ...studRing(147, 33.2, 12, 2.7).map((g) => g.translate(0, GUARD_A, 0))];
  return { bone: [bone], glow, silver: [collar], gold };
}

// Black wrapped grip with silver bands, each band set with gold studs.
function grip() {
  const pitch = 6;
  const cord = (s, th) => {
    const f = s / pitch + th / TAU;
    const u = 2 * (f - Math.floor(f)) - 1;
    return Math.sqrt(Math.max(0, 1 - u * u));
  };
  const wrap = revolve([[160, 24], [402, 24]], {
    from: 160, to: 402, step: 0.8, radial: 56,
    rFn: (s, th, r0) => r0 + 1.6 * cord(s, th),
    shadeFn: (s, th) => 1 - cord(s, th),
  });
  wrap.translate(0, GUARD_A, 0);
  const silver = [], gold = [];
  for (const c of [220, 282, 344]) {
    const ring = revolve([[c - 10, 22], [c - 8, 27], [c - 6, 29.5], [c + 6, 29.5], [c + 8, 27], [c + 10, 22]], {
      from: c - 10, to: c + 10, step: 0.4, radial: 56,
      shadeFn: (s) => Math.max(0.8 * gauss((s - c + 6) / 1.1), 0.8 * gauss((s - c - 6) / 1.1)),
    });
    ring.translate(0, GUARD_A, 0);
    silver.push(ring);
    gold.push(...studRing(c, 29.6, 12, 2.5, (c / 62) % 1).map((g) => g.translate(0, GUARD_A, 0)));
  }
  return { leather: [wrap], silver, gold };
}

// ------------------------------------------------------------ assembly

export function buildRuneblade() {
  const bone = [], glow = [], silver = [], gold = [], leather = [], engraved = [];
  const add = (part) => {
    bone.push(...(part.bone || [])); glow.push(...(part.glow || []));
    silver.push(...(part.silver || [])); gold.push(...(part.gold || []));
    leather.push(...(part.leather || []));
  };
  add(ramSkull());
  bone.push(...ramHorns());
  add(arms());
  add(pommel());
  add(grip());
  engraved.push(...spikes(), ...shieldPlate());

  const geos = {
    blade: bladeGeometry(),
    engraved: mergeGeometries(engraved),
    bone: paint(mergeGeometries(bone), BONE, BONE_DARK, { dirt: 0.45, lo: 0.5 }),
    silver: paint(mergeGeometries(silver), SILVER, SILVER_DARK, { dirt: 0.2 }),
    gold: dropShade(mergeGeometries(gold)),
    leather: paint(mergeGeometries(leather), LEATHER, LEATHER_DARK, { freq: 0.09, lo: 0.4, hi: 0.8, dirt: 0.2, wash: 0.8 }),
    glow: dropShade(mergeGeometries(glow)),
  };

  // Mirror so the serrated edge sits on the left (as in the references),
  // then scale to metres.
  for (const g of Object.values(geos)) {
    g.applyMatrix4(new THREE.Matrix4().makeScale(-PX, PX, PX));
    flipWinding(g);
  }

  const bladeTex = bladeTextures();
  const ornament = ornamentTextures();
  const frost = new THREE.Color('#38c4ff');
  const materials = {
    blade: new THREE.MeshStandardMaterial({
      name: 'Blade steel', color: 0xffffff, metalness: 1, roughness: 0.16,
      map: bladeTex.map, normalMap: bladeTex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
      emissive: frost, emissiveMap: bladeTex.emissiveMap, emissiveIntensity: 2,
      side: THREE.DoubleSide,
    }),
    engraved: new THREE.MeshStandardMaterial({
      name: 'Engraved steel', color: 0xffffff, metalness: 1, roughness: 0.2,
      map: ornament.map, normalMap: ornament.normalMap, side: THREE.DoubleSide,
    }),
    bone: new THREE.MeshStandardMaterial({ name: 'Frost bone', vertexColors: true, metalness: 0.1, roughness: 0.55 }),
    silver: new THREE.MeshStandardMaterial({ name: 'Silver', vertexColors: true, metalness: 1, roughness: 0.26 }),
    gold: new THREE.MeshStandardMaterial({ name: 'Gold', color: 0xd9a441, metalness: 1, roughness: 0.3 }),
    leather: new THREE.MeshStandardMaterial({ name: 'Grip wrap', vertexColors: true, metalness: 0.1, roughness: 0.62 }),
    glow: new THREE.MeshStandardMaterial({ name: 'Frost glow', color: 0x0d2533, metalness: 0, roughness: 0.4, emissive: frost, emissiveIntensity: 1.8 }),
  };

  const model = new THREE.Group();
  model.name = 'Runeblade';
  const names = {
    blade: 'Blade', engraved: 'Spikes and shield plate', bone: 'Skulls and horns', silver: 'Silver fittings',
    gold: 'Gold studs', leather: 'Grip', glow: 'Glowing eyes and inlays',
  };
  for (const [key, geo] of Object.entries(geos)) {
    const mesh = new THREE.Mesh(geo, materials[key]);
    mesh.name = names[key];
    model.add(mesh);
  }

  return {
    model,
    setGlow(on) {
      materials.blade.emissiveIntensity = on ? 2 : 0;
      materials.glow.emissiveIntensity = on ? 1.8 : 0.1;
    },
  };
}
