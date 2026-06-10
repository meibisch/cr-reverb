import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import {
  loadAudio,
  unload,
  stop,
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

// ── Post-processing (desktop only, disabled if frame time degrades) ──────────

let composer     = null;
let bloomEnabled = false;
let frameAvg     = 16.7;
let frameCount   = 0;

function setupBloom() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.25,  // strength — subtle, sells glow without reading as an effect
    0.55,  // radius
    0.85   // threshold — only dense bright cores bloom
  ));
  // Final raw copy (plain ShaderMaterial, no colour-space conversion):
  // keeps the base image byte-identical to the direct render path.
  // UnrealBloomPass must NOT be the final pass — its renderToScreen branch
  // draws via MeshBasicMaterial, which applies sRGB encoding and washes
  // out the deep-black background.
  composer.addPass(new ShaderPass(CopyShader));
  bloomEnabled = true;
}

// ── Mobile detection + particle budget ───────────────────────────────────────

function isMobile() {
  return window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent);
}

const PARTICLE_COUNT = isMobile() ? 25000 : 50000;

if (!isMobile()) setupBloom();

// ── Visuals ───────────────────────────────────────────────────────────────────

const sphereField = createSphereField(PARTICLE_COUNT);
const fireField   = createFireField(PARTICLE_COUNT);
const cloudField  = createCloudField(PARTICLE_COUNT);

scene.add(sphereField.points);
scene.add(sphereField.snowPoints);
scene.add(fireField.points);
scene.add(fireField.sparkPoints);
scene.add(cloudField.points);

const VISUAL_MAP = ['sphere', 'fire', 'cloud'];
const VISUALS    = { sphere: sphereField, fire: fireField, cloud: cloudField };

let activeVisual = sphereField;
fireField.setVisible(false);
cloudField.setVisible(false);

// ── Scene scale (responsive sizing) ──────────────────────────────────────────

function computeSceneScale() {
  return Math.max(0.35, Math.min(1.0, window.innerWidth / 1440));
}

let sceneScale = computeSceneScale();
Object.values(VISUALS).forEach(v => v.setScale(sceneScale));

function switchVisual(index) {
  activeVisual.setVisible(false);
  activeVisual = VISUALS[VISUAL_MAP[index]];
  activeVisual.setVisible(true);
}

window._resetParticles = () => activeVisual.resetPositions();
window._visuals = VISUALS;
window._setBloom = v => { bloomEnabled = v && composer !== null; };

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
  stop();
  unload();
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

window.addEventListener('mousemove', showControls);
controls.classList.add('visible');
hideTimer = setTimeout(() => controls.classList.remove('visible'), 4000);

if (isMobile()) {
  clearTimeout(hideTimer);
  controls.classList.add('visible');
  window.addEventListener('touchstart', () => {
    clearTimeout(hideTimer);
    controls.classList.add('visible');
  }, { passive: true });
}

// ── Play UI ───────────────────────────────────────────────────────────────────

async function handlePlay() {
  const playing = await toggle();
  playBtn.classList.toggle('playing', playing);
}

playBtn.addEventListener('click', handlePlay);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    handlePlay();
  }
});

// ── Coordinate helpers ────────────────────────────────────────────────────────

const NDC_SCALE_X = 3.3;
const NDC_SCALE_Y = 1.87;

function clientToNDC(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndcX =  ((clientX - rect.left)  / rect.width)  * 2 - 1;
  const ndcY = -((clientY - rect.top)   / rect.height) * 2 + 1;
  return { ndcX, ndcY };
}

function clientToWorld(clientX, clientY) {
  const { ndcX, ndcY } = clientToNDC(clientX, clientY);
  const worldX = (ndcX * NDC_SCALE_X) / sceneScale;
  const worldY = (ndcY * NDC_SCALE_Y) / sceneScale;
  return { ndcX, ndcY, worldX, worldY };
}

// ── Interaction state ─────────────────────────────────────────────────────────

let mouseNdcX = 0;
let mouseNdcY = 0;

// Charge system (sphere)
const MAX_CHARGE_MS = 1800;
let chargeActive    = false;
let chargeStartTime = 0;

function getChargeLevel() {
  if (!chargeActive) return 0;
  return Math.min(1, (performance.now() - chargeStartTime) / MAX_CHARGE_MS);
}

let chargeWorldX = 0;
let chargeWorldY = 0;

function startCharge(worldX, worldY) {
  chargeActive    = true;
  chargeStartTime = performance.now();
  chargeWorldX    = worldX;
  chargeWorldY    = worldY;
}

function releaseCharge(worldX, worldY) {
  if (!chargeActive) return;
  const charge = getChargeLevel();
  chargeActive  = false;
  sphereField.triggerWave(worldX, worldY, charge);
}

// Fire hold state
let fireHoldActive = false;
let fireHoldWorldX = 0;
let fireHoldWorldY = 0;

// Pointer history for vortex detection (cloud)
const HISTORY_LEN   = 20;
const pointerHistory = [];

function pushPointerHistory(worldX, worldY) {
  pointerHistory.push({ x: worldX, y: worldY, t: performance.now() });
  if (pointerHistory.length > HISTORY_LEN) pointerHistory.shift();
}

function computeAngularVelocity() {
  if (pointerHistory.length < 4) return 0;
  const cx = pointerHistory.reduce((s, p) => s + p.x, 0) / pointerHistory.length;
  const cy = pointerHistory.reduce((s, p) => s + p.y, 0) / pointerHistory.length;
  let totalAngle = 0;
  for (let i = 1; i < pointerHistory.length; i++) {
    const a = pointerHistory[i - 1];
    const b = pointerHistory[i];
    const ax = a.x - cx, ay = a.y - cy;
    const bx = b.x - cx, by = b.y - cy;
    const cross = ax * by - ay * bx;
    const dot   = ax * bx + ay * by;
    totalAngle += Math.atan2(cross, dot);
  }
  const dt = (pointerHistory[pointerHistory.length - 1].t - pointerHistory[0].t) / 1000;
  return dt > 0 ? totalAngle / dt : 0;
}

// ── Mouse interaction ─────────────────────────────────────────────────────────

window.addEventListener('mousemove', e => {
  const { ndcX, ndcY, worldX, worldY } = clientToWorld(e.clientX, e.clientY);
  mouseNdcX = ndcX;
  mouseNdcY = ndcY;
  pushPointerHistory(worldX, worldY);
  if (fireHoldActive) {
    fireHoldWorldX = worldX;
    fireHoldWorldY = worldY;
  }
  if (chargeActive) {
    chargeWorldX = worldX;
    chargeWorldY = worldY;
  }
});

renderer.domElement.addEventListener('mousedown', e => {
  if (e.target.closest('#controls')) return;
  if (!getIsPlaying()) return;
  const { worldX, worldY } = clientToWorld(e.clientX, e.clientY);
  if (activeVisual === VISUALS['sphere'] || activeVisual === VISUALS['cloud']) {
    startCharge(worldX, worldY);
  } else if (activeVisual === VISUALS['fire']) {
    fireHoldActive = true;
    fireHoldWorldX = worldX;
    fireHoldWorldY = worldY;
  }
});

window.addEventListener('mouseup', e => {
  if (activeVisual === VISUALS['sphere'] && chargeActive) {
    const { worldX, worldY } = clientToWorld(e.clientX, e.clientY);
    releaseCharge(worldX, worldY);
  } else if (activeVisual === VISUALS['cloud'] && chargeActive) {
    const { worldX, worldY } = clientToWorld(e.clientX, e.clientY);
    cloudField.releaseGust(worldX, worldY, getChargeLevel());
  } else if (activeVisual === VISUALS['fire'] && fireHoldActive) {
    const { worldX, worldY } = clientToWorld(e.clientX, e.clientY);
    const charge = Math.min(1, (performance.now() - chargeStartTime) / MAX_CHARGE_MS);
    fireField.releaseEmberBurst(worldX, worldY, charge);
    fireHoldActive = false;
  }
  chargeActive   = false;
  fireHoldActive = false;
});

window.addEventListener('mouseleave', () => {
  chargeActive   = false;
  fireHoldActive = false;
});

// ── Touch interaction ─────────────────────────────────────────────────────────

let touchStartWorld = { x: 0, y: 0 };
let touchDownTime   = 0;

renderer.domElement.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.touches[0];
  const { ndcX, ndcY, worldX, worldY } = clientToWorld(t.clientX, t.clientY);
  mouseNdcX      = ndcX;
  mouseNdcY      = ndcY;
  touchStartWorld = { x: worldX, y: worldY };
  touchDownTime   = performance.now();
  pointerHistory.length = 0;
  pushPointerHistory(worldX, worldY);

  if (!getIsPlaying()) return;
  if (activeVisual === VISUALS['sphere'] || activeVisual === VISUALS['cloud']) {
    startCharge(worldX, worldY);
  } else if (activeVisual === VISUALS['fire']) {
    fireHoldActive = true;
    fireHoldWorldX = worldX;
    fireHoldWorldY = worldY;
  }
}, { passive: false });

renderer.domElement.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  const { ndcX, ndcY, worldX, worldY } = clientToWorld(t.clientX, t.clientY);
  mouseNdcX = ndcX;
  mouseNdcY = ndcY;
  pushPointerHistory(worldX, worldY);
  showControls();
  if (fireHoldActive) {
    fireHoldWorldX = worldX;
    fireHoldWorldY = worldY;
  }
  if (chargeActive) {
    chargeWorldX = worldX;
    chargeWorldY = worldY;
  }
}, { passive: false });

renderer.domElement.addEventListener('touchend', e => {
  const t = e.changedTouches[0];
  const { worldX, worldY } = clientToWorld(t.clientX, t.clientY);

  if (getIsPlaying()) {
    if (activeVisual === VISUALS['sphere'] && chargeActive) {
      releaseCharge(worldX, worldY);
    } else if (activeVisual === VISUALS['cloud'] && chargeActive) {
      cloudField.releaseGust(worldX, worldY, getChargeLevel());
    } else if (activeVisual === VISUALS['fire'] && fireHoldActive) {
      const holdMs = performance.now() - touchDownTime;
      const strength = Math.min(1, holdMs / MAX_CHARGE_MS);
      fireField.releaseEmberBurst(worldX, worldY, strength);
    }
  }

  chargeActive   = false;
  fireHoldActive = false;
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

  const features    = getFeatures();
  const chargeLevel = getChargeLevel();

  if (features.onsetFired) activeVisual.triggerOnset();

  const worldMouseX = (mouseNdcX * NDC_SCALE_X) / sceneScale;
  const worldMouseY = (mouseNdcY * NDC_SCALE_Y) / sceneScale;

  // Cloud: wind + vortex — parting force grows with hold duration
  if (activeVisual === VISUALS['cloud']) {
    const isHolding = chargeActive || fireHoldActive;
    cloudField.applyWind(worldMouseX, worldMouseY, isHolding, chargeLevel);

    const av = computeAngularVelocity();
    if (Math.abs(av) > 2.5) {
      const centroid = pointerHistory.length > 0
        ? { x: pointerHistory.reduce((s, p) => s + p.x, 0) / pointerHistory.length,
            y: pointerHistory.reduce((s, p) => s + p.y, 0) / pointerHistory.length }
        : { x: worldMouseX, y: worldMouseY };
      cloudField.applyVortex(centroid.x, centroid.y, Math.min(1, Math.abs(av) / 8));
    } else {
      cloudField.clearVortex();
    }
  }

  // Fire: fanning while held
  if (activeVisual === VISUALS['fire'] && fireHoldActive) {
    const holdMs   = performance.now() - touchDownTime;
    const strength = Math.min(1, holdMs / MAX_CHARGE_MS);
    fireField.applyFanning(fireHoldWorldX, fireHoldWorldY, strength);
  }

  // Sphere: hands pressing against the bubble while charging
  if (activeVisual === VISUALS['sphere'] && chargeActive) {
    sphereField.applyPress(chargeWorldX, chargeWorldY, chargeLevel);
  }

  activeVisual.update(features, now * 0.001, mouseNdcX, mouseNdcY, chargeLevel, getIsPlaying());

  // Disable bloom permanently if sustained frame time degrades
  frameAvg += (dt - frameAvg) * 0.02;
  frameCount++;
  if (bloomEnabled && frameCount > 300 && frameAvg > 25) bloomEnabled = false;

  if (bloomEnabled && composer) composer.render();
  else renderer.render(scene, camera);
}

requestAnimationFrame(animate);

// ── Resize ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  sceneScale = computeSceneScale();
  Object.values(VISUALS).forEach(v => v.setScale(sceneScale));
});
