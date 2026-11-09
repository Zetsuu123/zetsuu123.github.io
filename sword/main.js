import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildRuneblade } from './model.js';

const stage = document.getElementById('stage');
const status = document.getElementById('status');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (err) {
  status.textContent = 'This browser cannot show 3D graphics (WebGL is unavailable).';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(studio(), 0.02).texture;

// A dark studio with a few soft-box strips, so polished metal shows crisp
// highlights against deep reflections instead of a flat grey room.
function studio() {
  const room = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x1b2230, side: THREE.BackSide }));
  room.add(box);
  const light = (w, h, intensity, color, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(...look);
    room.add(m);
  };
  light(6, 2.2, 3.2, 0xffffff, [0, 4.6, 1], [0, 0, 0]); // overhead soft box
  light(1.1, 7, 4.5, 0xffffff, [-4.6, 0.5, 2.2], [0, 0, 0]); // left strip
  light(0.8, 7, 3.2, 0xdfefff, [4.6, 0.2, 1.4], [0, 0, 0]); // right strip
  light(5, 1.6, 2.6, 0x9fd4ff, [0, -1.2, -4.6], [0, 0, 0]); // cool rim from behind
  light(3, 0.6, 1.4, 0xffffff, [0, -4.6, 2], [0, 0, 0]); // faint floor bounce
  light(7, 3.2, 1.25, 0xe8f2ff, [0.6, 0.9, 4.95], [0, 0, 0]); // broad front fill behind the viewer
  return room;
}

const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(-2, 3, 4);
const rim = new THREE.DirectionalLight(0x8fd0ff, 2.2);
rim.position.set(3, 1, -3);
scene.add(key, rim);

const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.15;
controls.maxDistance = 8;

const { model, setGlow } = buildRuneblade();
const tilt = new THREE.Group(); // leans the sword like the photo on wide screens
tilt.add(model);
scene.add(tilt);

let userMoved = false;
controls.addEventListener('start', () => { userMoved = true; });

function frame(lean) {
  const w = stage.clientWidth, h = stage.clientHeight;
  camera.aspect = w / h;
  tilt.rotation.z = lean ?? (camera.aspect > 1.1 ? 0.78 : 0);

  const spin = model.rotation.y;
  model.rotation.y = 0;
  tilt.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(tilt);
  model.rotation.y = spin;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const dist = Math.max(size.y / 2 / Math.tan(vfov / 2), size.x / 2 / Math.tan(hfov / 2)) * 1.22 + size.z / 2;
  camera.position.set(center.x, center.y, center.z + dist);
  camera.near = dist / 100;
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  userMoved = false;
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  if (!userMoved) frame();
  else { camera.aspect = w / h; camera.updateProjectionMatrix(); }
}
new ResizeObserver(resize).observe(stage);
resize();

// ------------------------------------------------------------- controls

const spinBtn = document.getElementById('spin');
const glowBtn = document.getElementById('glow');
let spinning = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
spinBtn.setAttribute('aria-pressed', String(spinning));
spinBtn.addEventListener('click', () => {
  spinning = !spinning;
  spinBtn.setAttribute('aria-pressed', String(spinning));
});
glowBtn.addEventListener('click', () => {
  const on = glowBtn.getAttribute('aria-pressed') !== 'true';
  glowBtn.setAttribute('aria-pressed', String(on));
  setGlow(on);
});
document.getElementById('reset').addEventListener('click', () => {
  model.rotation.y = 0;
  frame();
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (spinning) model.rotation.y += dt * 0.45;
  controls.update();
  renderer.render(scene, camera);
});
status.hidden = true;
if (new URLSearchParams(location.search).has('debug')) window.runeblade = { camera, controls, model, tilt, frame };

// Builds a fresh copy of the model and returns it as a binary glTF (.glb).
// Used to produce runeblade.glb; handy from the console too.
window.exportRunebladeGLB = async () => {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const fresh = buildRuneblade().model;
  return new GLTFExporter().parseAsync(fresh, { binary: true });
};
