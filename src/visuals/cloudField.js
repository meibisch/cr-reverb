import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import vertShader from '../shaders/cloud.vert.glsl?raw';
import fragShader from '../shaders/cloud.frag.glsl?raw';

const BASE_AMP  = 0.03;
const AUDIO_AMP = 0.14;
const ATTACK    = 0.18;
const RELEASE   = 0.025;

// Drift in world units per frame at 60fps, per depth layer (far → near).
// Near clouds pass faster: parallax sells the volume.
const LAYER_DRIFT = [0.0007, 0.0012, 0.0020];
const LAYER_Z     = [-0.85, 0.0, 0.85];
const LAYER_SIZE  = [0.65, 1.0, 1.45];
const LAYER_FRACS = [0.40, 0.35, 0.25];
const RIGHT_BOUND =  3.6;
const LEFT_BOUND  = -3.6;

const ATTRACT_RADIUS = 1.0;
const ATTRACT_FORCE  = 0.003;

// Parting the clouds: hold pushes them aside, grows with hold duration.
// Slow decay = a parted trail stays visible for ~15–20s; the offset cap
// keeps sustained forces from running away (equilibrium ≈ force / (1−decay)).
const WIND_RADIUS     = 1.2;
const WIND_STRENGTH   = 0.010;
const WIND_DECAY      = 0.995;
const MAX_WIND_OFFSET = 1.1;
const VORTEX_RADIUS   = 1.8;
const VORTEX_FORCE    = 0.008;

// Vortex hint: clouds begin to curl around a resting pointer — physics as
// invitation, no on-screen instructions
const HINT_RADIUS = 0.9;
const HINT_FORCE  = 0.0035;

// The Spot: a gap opens in the cloud deck on musically bright moments
const GAP_OPEN_S    = 5;
const GAP_HOLD_S    = 6;
const GAP_CLOSE_S   = 25;
const GAP_RADIUS    = 0.9;
const GAP_COOLDOWN  = 45;
const GAP_THRESHOLD = 0.72;
const GAP_WARMUP_S  = 25; // let the adaptive normalization settle first

// Three overlapping cloud masses — coordinates in world units
const CLUSTERS = [
  { cx:  0.00, cy:  0.10, spreadX: 1.50, spreadY: 0.60 },
  { cx: -1.00, cy: -0.05, spreadX: 0.90, spreadY: 0.40 },
  { cx:  0.90, cy:  0.15, spreadX: 0.80, spreadY: 0.35 },
];
const CLUSTER_FRACS = [0.45, 0.30, 0.25];

const NDC_SCALE_X = 3.3;
const NDC_SCALE_Y = 1.87;

const noise2D = createNoise2D();

function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * 0.5;
}

function easeInOut(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

export function createCloudField(particleCount = 50000) {
  const PARTICLE_COUNT = particleCount;
  const homePos = new Float32Array(PARTICLE_COUNT * 3);
  const phases  = new Float32Array(PARTICLE_COUNT * 3);
  const freqs   = new Float32Array(PARTICLE_COUNT);
  const sizes   = new Float32Array(PARTICLE_COUNT);
  const layerOf = new Uint8Array(PARTICLE_COUNT);

  // Assign layers, then sample positions from cluster gaussians shaped by
  // simplex noise (rejection sampling) — ragged organic edges, not blobs
  let idx = 0;
  for (let l = 0; l < 3; l++) {
    const count = l < 2
      ? Math.round(LAYER_FRACS[l] * PARTICLE_COUNT)
      : PARTICLE_COUNT - idx;
    for (let k = 0; k < count; k++, idx++) {
      // pick a cluster for this particle
      const r = Math.random();
      const c = r < CLUSTER_FRACS[0] ? 0 : (r < CLUSTER_FRACS[0] + CLUSTER_FRACS[1] ? 1 : 2);
      const cl = CLUSTERS[c];

      let x = 0, y = 0;
      for (let attempt = 0; attempt < 6; attempt++) {
        x = cl.cx + gaussianRandom() * cl.spreadX;
        y = cl.cy + gaussianRandom() * cl.spreadY;
        const n = noise2D(x * 0.9 + l * 13.7, y * 1.5 - l * 7.3);
        if (n > -0.25) break; // keep dense pockets, thin out the troughs
      }

      homePos[idx * 3]     = x;
      homePos[idx * 3 + 1] = y + (l - 1) * 0.12; // slight per-layer band offset
      homePos[idx * 3 + 2] = LAYER_Z[l] + gaussianRandom() * 0.18;
      phases[idx * 3]     = Math.random() * Math.PI * 2;
      phases[idx * 3 + 1] = Math.random() * Math.PI * 2;
      phases[idx * 3 + 2] = Math.random() * Math.PI * 2;
      freqs[idx]   = 0.20 + Math.random() * 0.30;
      sizes[idx]   = (0.5 + Math.random() * 0.8) * LAYER_SIZE[l];
      layerOf[idx] = l;
    }
  }

  const windOffsetX = new Float32Array(PARTICLE_COUNT);
  const windOffsetY = new Float32Array(PARTICLE_COUNT);

  const geometry = new THREE.BufferGeometry();
  const posAttr  = new THREE.BufferAttribute(new Float32Array(homePos), 3);
  posAttr.usage  = THREE.DynamicDrawUsage;
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aLayer',   new THREE.BufferAttribute(new Float32Array(layerOf), 1));

  const uniforms = {
    uLoudness:    { value: 0 },
    uHighBand:    { value: 0 },
    uCentroid:    { value: 0 },
    uOnsetEnergy: { value: 0 },
    uGapPos:      { value: new THREE.Vector2(0, 0) },
    uGapR:        { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader:   vertShader,
    fragmentShader: fragShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);

  // ── State ──────────────────────────────────────────────────────────────────
  let smoothedAmp    = BASE_AMP;
  let onsetCountdown = 0;
  let isBlowing      = false;
  let windX          = 0;
  let windY          = 0;
  let windCharge     = 0;
  let vortexActive   = false;
  let vortexCX       = 0;
  let vortexCY       = 0;
  let vortexStrength = 0;
  let lastUpdateTime = 0;

  // Vortex hint
  let lastMouseX  = 0;
  let lastMouseY  = 0;
  let pointerSeen = false;
  let stillSec    = 0;

  // The Spot
  let gapActive   = false;
  let gapStart    = -1e9;
  let gapX        = 0;
  let gapY        = 0;
  let slowBright  = 0;
  let playSec     = 0;

  function triggerOnset() { onsetCountdown = 60; }
  function triggerWave()  {}
  function setVisible(bool) { points.visible = bool; }
  function setScale(s)      { points.scale.set(s, s, s); }

  function applyWind(worldX, worldY, holding, charge = 0) {
    isBlowing  = holding;
    windX      = worldX;
    windY      = worldY;
    windCharge = charge;
  }

  function applyVortex(cx, cy, strength) {
    vortexActive   = true;
    vortexCX       = cx;
    vortexCY       = cy;
    vortexStrength = strength;
  }

  function clearVortex() { vortexActive = false; }

  // Release after holding: one gust rolls outward through the layers
  function releaseGust(worldX, worldY, charge = 0) {
    const R = 1.6 + charge * 1.2;
    const F = 0.05 + charge * 0.10;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const dx = homePos[i * 3]     - worldX;
      const dy = homePos[i * 3 + 1] - worldY;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < R && d > 0.001) {
        const f = F * (1 - d / R);
        windOffsetX[i] += (dx / d) * f;
        windOffsetY[i] += (dy / d) * f;
      }
    }
  }

  function update(features, time, mouseX = 0, mouseY = 0, chargeLevel = 0, isPlaying = true) {
    uniforms.uLoudness.value    = features.loudness;
    uniforms.uHighBand.value    = features.normalizedHigh;
    uniforms.uCentroid.value    = features.centroid;
    uniforms.uOnsetEnergy.value = features.onsetEnergy;

    const dtScale = lastUpdateTime > 0
      ? Math.min(3, Math.max(0.25, (time - lastUpdateTime) * 60))
      : 1;
    const dtSec = lastUpdateTime > 0 ? Math.min(time - lastUpdateTime, 0.25) : 1 / 60;
    lastUpdateTime = time;

    const targetAmp = BASE_AMP + features.normalizedEnergy * AUDIO_AMP;
    smoothedAmp += (targetAmp > smoothedAmp ? ATTACK : RELEASE) * (targetAmp - smoothedAmp);

    let effectiveAmp = smoothedAmp;
    if (onsetCountdown > 0) { effectiveAmp *= 1.0 + 0.5 * (onsetCountdown / 60); onsetCountdown--; }

    const mwx = mouseX * NDC_SCALE_X;
    const mwy = mouseY * NDC_SCALE_Y;

    // ── Vortex hint: pointer at rest makes nearby clouds curl gently ────────
    if (mouseX !== lastMouseX || mouseY !== lastMouseY) pointerSeen = true;
    const pointerSpeed = Math.hypot(mwx - lastMouseX, mwy - lastMouseY) / Math.max(dtSec, 0.001);
    lastMouseX = mwx; lastMouseY = mwy;
    if (pointerSeen && pointerSpeed < 0.25 && !isBlowing) stillSec += dtSec;
    else stillSec = 0;
    const hint = Math.min(0.5, Math.max(0, (stillSec - 0.8) / 2));

    // ── The Spot: a gap opens on sustained bright, airy passages ────────────
    if (isPlaying) {
      playSec    += dtSec;
      slowBright += (features.normalizedHigh - slowBright) * 0.02 * dtScale;
      if (!gapActive && playSec > GAP_WARMUP_S && slowBright > GAP_THRESHOLD
          && time - gapStart > GAP_COOLDOWN) {
        gapActive = true;
        gapStart  = time;
        gapX      = (Math.random() * 2 - 1) * 1.5;
        gapY      = 0.2 + Math.random() * 1.0;
      }
    }
    let gapStrength = 0;
    if (gapActive) {
      const t = time - gapStart;
      if      (t < GAP_OPEN_S)                        gapStrength = easeInOut(t / GAP_OPEN_S);
      else if (t < GAP_OPEN_S + GAP_HOLD_S)           gapStrength = 1;
      else if (t < GAP_OPEN_S + GAP_HOLD_S + GAP_CLOSE_S)
        gapStrength = 1 - easeInOut((t - GAP_OPEN_S - GAP_HOLD_S) / GAP_CLOSE_S);
      else gapActive = false;
    }
    // Soft see-through thinning, applied in the vertex shader — no displaced
    // mass, no bright rim shell
    uniforms.uGapPos.value.set(gapX, gapY);
    uniforms.uGapR.value = GAP_RADIUS * gapStrength;

    // ── Drift: layered parallax; audio only adds movement while playing ─────
    const audioBoost = isPlaying ? features.normalizedEnergy * 0.4 : 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const drift = LAYER_DRIFT[layerOf[i]] * (1 + audioBoost) * dtScale;
      homePos[i * 3] += drift;
      if (homePos[i * 3] > RIGHT_BOUND) homePos[i * 3] -= (RIGHT_BOUND - LEFT_BOUND);
    }

    const windForce = WIND_STRENGTH * (0.6 + windCharge * 1.6);
    const windDecay = Math.pow(WIND_DECAY, dtScale);

    const gpuPos = geometry.attributes.position.array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      const f  = freqs[i];

      // Parting the clouds while holding
      if (isBlowing) {
        const dx   = homePos[i3]     - windX;
        const dy   = homePos[i3 + 1] - windY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < WIND_RADIUS && dist > 0.001) {
          const force = windForce * (1 - dist / WIND_RADIUS) * dtScale;
          windOffsetX[i] += (dx / dist) * force;
          windOffsetY[i] += (dy / dist) * force;
        }
      }
      // Explicit vortex (deliberate circling)
      if (vortexActive) {
        const vdx = homePos[i3]     - vortexCX;
        const vdy = homePos[i3 + 1] - vortexCY;
        const vd  = Math.sqrt(vdx * vdx + vdy * vdy);
        if (vd < VORTEX_RADIUS && vd > 0.001) {
          const force = vortexStrength * VORTEX_FORCE * (1 - vd / VORTEX_RADIUS) * dtScale;
          windOffsetX[i] += (-vdy / vd) * force;
          windOffsetY[i] += ( vdx / vd) * force;
        }
      } else if (hint > 0) {
        // the whisper: a gentle curl around the resting pointer
        const hdx = homePos[i3]     - mwx;
        const hdy = homePos[i3 + 1] - mwy;
        const hd  = Math.sqrt(hdx * hdx + hdy * hdy);
        if (hd < HINT_RADIUS && hd > 0.001) {
          const force = hint * HINT_FORCE * (1 - hd / HINT_RADIUS) * dtScale;
          windOffsetX[i] += (-hdy / hd) * force;
          windOffsetY[i] += ( hdx / hd) * force;
        }
      }
      windOffsetX[i] *= windDecay;
      windOffsetY[i] *= windDecay;
      const om2 = windOffsetX[i] * windOffsetX[i] + windOffsetY[i] * windOffsetY[i];
      if (om2 > MAX_WIND_OFFSET * MAX_WIND_OFFSET) {
        const s = MAX_WIND_OFFSET / Math.sqrt(om2);
        windOffsetX[i] *= s;
        windOffsetY[i] *= s;
      }

      // Oscillation: mostly vertical
      let px = homePos[i3]     + Math.sin(time * f       + phases[i3])     * effectiveAmp * 0.2 + windOffsetX[i];
      let py = homePos[i3 + 1] + Math.sin(time * f * 0.6 + phases[i3 + 1]) * effectiveAmp       + windOffsetY[i];
      let pz = homePos[i3 + 2] + Math.sin(time * f * 0.4 + phases[i3 + 2]) * effectiveAmp * 0.3;

      // Mouse attraction
      const mdx = mwx - px, mdy = mwy - py;
      const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
      if (mdist < ATTRACT_RADIUS && mdist > 0.001) {
        const pull = ATTRACT_FORCE * (1 - mdist / ATTRACT_RADIUS);
        px += (mdx / mdist) * pull; py += (mdy / mdist) * pull;
      }

      gpuPos[i3] = px; gpuPos[i3 + 1] = py; gpuPos[i3 + 2] = pz;
    }

    geometry.attributes.position.needsUpdate = true;
  }

  function resetPositions() {
    const gpuPos = geometry.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      gpuPos[i3] = homePos[i3]; gpuPos[i3 + 1] = homePos[i3 + 1]; gpuPos[i3 + 2] = homePos[i3 + 2];
    }
    geometry.attributes.position.needsUpdate = true;
    smoothedAmp = BASE_AMP; onsetCountdown = 0;
    windOffsetX.fill(0); windOffsetY.fill(0);
    isBlowing = false; windCharge = 0;
    gapActive = false; gapStart = -1e9; slowBright = 0; playSec = 0;
    stillSec = 0; pointerSeen = false;
    uniforms.uGapR.value = 0;
  }

  function forceGap(x = 0, y = 0.5) {
    gapActive = true;
    gapStart  = lastUpdateTime;
    gapX      = x;
    gapY      = y;
  }

  function getDebugState() {
    return { gapActive, gapR: +uniforms.uGapR.value.toFixed(3), slowBright: +slowBright.toFixed(3), playSec: +playSec.toFixed(1), stillSec: +stillSec.toFixed(1), isBlowing };
  }

  return { points, update, triggerOnset, triggerWave, applyWind, applyVortex, clearVortex, releaseGust, setVisible, setScale, resetPositions, forceGap, getDebugState };
}
