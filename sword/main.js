import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;

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
