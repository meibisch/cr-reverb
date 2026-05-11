import * as THREE from 'three';
import {
  loadAudio,
  toggle,
  getIsPlaying,
  getFrequencyData,
  getTimeDomainData,
} from './audio/audioEngine.js';
import { updateFeatures, getFeatures, resetFeatures } from './audio/features.js';
import { createSphereField } from './visuals/sphereField.js';
import { createFireField   } from './visuals/fireField.js';
import { createCloudField  } from './visuals/cloudField.js';

// ── Scene ────────────────────────────────────────────────────────────────────

const container = document.getElementById('canvas-container');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x0d0d0d, 1);
container.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0, 4);
camera.lookAt(0, 0, 0);

// ── Visuals ───────────────────────────────────────────────────────────────────

const sphereField = createSphereField();
const fireField   = createFireField();
const cloudField  = createCloudField();

scene.add(sphereField.points);
scene.add(fireField.points);
scene.add(fireField.sparkPoints);
scene.add(cloudField.points);

const VISUAL_MAP = ['sphere', 'fire', 'cloud'];
const VISUALS    = { sphere: sphereField, fire: fireField, cloud: cloudField };

let activeVisual = sphereField;
fireField.setVisible(false);
cloudField.setVisible(false);

function switchVisual(index) {
  activeVisual.setVisible(false);
  activeVisual = VISUALS[VISUAL_MAP[index]];
  activeVisual.setVisible(true);
}

window._resetParticles = () => activeVisual.resetPositions();

// ── Tracks ───────────────────────────────────────────────────────────────────

const TRACKS = [
  { label: 'Out of the Blue', file: 'Chasing Reverbs_Out of the Blue (mastered).mp3' },
  { label: 'I See Fire',      file: 'Chasing Reverbs_Electric Echo_I See Fire (mastered).mp3' },
  { label: 'Spotting Clouds', file: 'Chasing Reverbs_Spotting Clouds (mastered).mp3' },
];

const playBtn   = document.getElementById('playPauseBtn');
const controls  = document.getElementById('controls');
const errorEl   = document.getElementById('error-msg');
const trackBtns = document.querySelectorAll('.track-btn');

async function loadTrack(index) {
  trackBtns.forEach((b, i) => b.classList.toggle('active', i === index));
  playBtn.classList.remove('playing');
  switchVisual(index);
  try {
    await loadAudio(`/audio/${TRACKS[index].file}`);
    resetFeatures();
    errorEl.style.display = 'none';
  } catch (e) {
    errorEl.textContent = `Could not load: ${TRACKS[index].file}`;
    errorEl.style.display = 'block';
  }
}

loadTrack(0);
trackBtns.forEach((btn, i) => btn.addEventListener('click', () => loadTrack(i)));

// ── Controls auto-hide ────────────────────────────────────────────────────────

let hideTimer = null;

function showControls() {
  controls.classList.add('visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => controls.classList.remove('visible'), 2800);
}

// Show on any mouse movement
window.addEventListener('mousemove', showControls);

// Visible on load for 4 seconds
controls.classList.add('visible');
hideTimer = setTimeout(() => controls.classList.remove('visible'), 4000);

// ── Play UI ───────────────────────────────────────────────────────────────────

function handlePlay() {
  const playing = toggle();
  playBtn.classList.toggle('playing', playing);
}

playBtn.addEventListener('click', handlePlay);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    handlePlay();
  }
});

// ── Mouse + Click ─────────────────────────────────────────────────────────────

let mouseX      = 0;
let mouseY      = 0;
let isMouseHeld = false;

const NDC_SCALE_X = 3.3;
const NDC_SCALE_Y = 1.87;

window.addEventListener('mousemove', e => {
  mouseX =  (e.clientX / window.innerWidth)  * 2 - 1;
  mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
});

renderer.domElement.addEventListener('mousedown', () => { isMouseHeld = true; });
window.addEventListener('mouseup',    () => { isMouseHeld = false; });
window.addEventListener('mouseleave', () => { isMouseHeld = false; });

window.addEventListener('click', e => {
  if (!getIsPlaying()) return;
  if (e.target.closest('#controls')) return;
  const worldX =  (e.clientX / window.innerWidth  * 2 - 1) * NDC_SCALE_X;
  const worldY = -(e.clientY / window.innerHeight * 2 - 1) * NDC_SCALE_Y;
  if (activeVisual === VISUALS['sphere']) {
    activeVisual.triggerWave(worldX, worldY);
  } else if (activeVisual === VISUALS['fire']) {
    activeVisual.triggerSparks(worldX, worldY);
  }
  // cloud: wind uses mousedown/up, no click handler
});

// ── Render loop ───────────────────────────────────────────────────────────────

let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);

  const dt = Math.min(now - lastTime, 50);
  lastTime = now;

  if (getIsPlaying()) {
    updateFeatures(getFrequencyData(), getTimeDomainData(), dt);
  }

  const features = getFeatures();
  if (features.onsetFired) activeVisual.triggerOnset();

  const mwx = mouseX * NDC_SCALE_X;
  const mwy = mouseY * NDC_SCALE_Y;

  // Wind for cloud visual
  if (activeVisual.applyWind) {
    activeVisual.applyWind(mwx, mwy, isMouseHeld);
  }

  activeVisual.update(features, now * 0.001, mouseX, mouseY);
  renderer.render(scene, camera);
}

requestAnimationFrame(animate);

// ── Resize ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
