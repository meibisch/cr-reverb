import * as THREE from 'three';
import vertShader from '../shaders/cloud.vert.glsl?raw';
import fragShader from '../shaders/cloud.frag.glsl?raw';

const BASE_AMP  = 0.03;
const AUDIO_AMP = 0.14;
const ATTACK    = 0.18;
const RELEASE   = 0.025;

// Drift in world units per frame (at 60fps: main traverses ~6.6wu in ~92s)
const DRIFT_SPEEDS = [0.0012, 0.0008, 0.0016]; // main, left wisp, right wisp
const RIGHT_BOUND  =  3.5;
const LEFT_BOUND   = -3.5;

const ATTRACT_RADIUS = 1.0;
const ATTRACT_FORCE  = 0.003;

const WIND_RADIUS   = 1.2;
const WIND_STRENGTH = 0.025;
const WIND_DECAY    = 0.95;

const NDC_SCALE_X = 3.3;
const NDC_SCALE_Y = 1.87;

// Three overlapping clusters — coordinates in world units
const CLUSTERS = [
  { cx:  0.00, cy:  0.10, spreadX: 1.50, spreadY: 0.60 }, // main body    45%
  { cx: -1.00, cy: -0.05, spreadX: 0.90, spreadY: 0.40 }, // left wisp    30%
  { cx:  0.90, cy:  0.15, spreadX: 0.80, spreadY: 0.35 }, // right wisp   25%
];
const CLUSTER_FRACS = [0.45, 0.30, 0.25];

function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * 0.5;
}


export function createCloudField(particleCount = 50000) {
  const PARTICLE_COUNT = particleCount;
  const homePos   = new Float32Array(PARTICLE_COUNT * 3);
  const phases    = new Float32Array(PARTICLE_COUNT * 3);
  const freqs     = new Float32Array(PARTICLE_COUNT);
  const sizes     = new Float32Array(PARTICLE_COUNT);
  const clusterOf = new Uint8Array(PARTICLE_COUNT);

  // Assign particles to clusters and sample initial positions
  const counts = CLUSTER_FRACS.map(f => Math.round(f * PARTICLE_COUNT));
  counts[0] = PARTICLE_COUNT - counts[1] - counts[2]; // ensure total = PARTICLE_COUNT

  let idx = 0;
  for (let c = 0; c < 3; c++) {
    const cl = CLUSTERS[c];
    for (let k = 0; k < counts[c]; k++, idx++) {
      homePos[idx * 3]     = cl.cx + gaussianRandom() * cl.spreadX;
      homePos[idx * 3 + 1] = cl.cy + gaussianRandom() * cl.spreadY;
      homePos[idx * 3 + 2] = gaussianRandom() * 0.20; // shallow z — cloud is flat
      phases[idx * 3]     = Math.random() * Math.PI * 2;
      phases[idx * 3 + 1] = Math.random() * Math.PI * 2;
      phases[idx * 3 + 2] = Math.random() * Math.PI * 2;
      freqs[idx]     = 0.20 + Math.random() * 0.30;
      sizes[idx]     = 0.5 + Math.random() * 0.8;
      clusterOf[idx] = c;
    }
  }

  const windOffsetX = new Float32Array(PARTICLE_COUNT);
  const windOffsetY = new Float32Array(PARTICLE_COUNT);

  const geometry = new THREE.BufferGeometry();
  const posAttr  = new THREE.BufferAttribute(new Float32Array(homePos), 3);
  posAttr.usage  = THREE.DynamicDrawUsage;
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));

  const uniforms = {
    uLoudness:    { value: 0 },
    uHighBand:    { value: 0 },
    uCentroid:    { value: 0 },
    uOnsetEnergy: { value: 0 },
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

  let smoothedAmp    = BASE_AMP;
  let onsetCountdown = 0;
  let isBlowing      = false;
  let windX          = 0;
  let windY          = 0;

  function triggerOnset() { onsetCountdown = 60; }
  function triggerWave()  {} // no wave for clouds
  function setVisible(bool) { points.visible = bool; }
  function setScale(s)      { points.scale.set(s, s, s); }

  function applyWind(worldX, worldY, holding) {
    isBlowing = holding;
    windX     = worldX;
    windY     = worldY;
  }

  function update(features, time, mouseX = 0, mouseY = 0) {
    uniforms.uLoudness.value    = features.loudness;
    uniforms.uHighBand.value    = features.normalizedHigh;
    uniforms.uCentroid.value    = features.centroid;
    uniforms.uOnsetEnergy.value = features.onsetEnergy;

    const targetAmp = BASE_AMP + features.normalizedEnergy * AUDIO_AMP;
    smoothedAmp += (targetAmp > smoothedAmp ? ATTACK : RELEASE) * (targetAmp - smoothedAmp);

    let effectiveAmp = smoothedAmp;
    if (onsetCountdown > 0) { effectiveAmp *= 1.0 + 0.5 * (onsetCountdown / 60); onsetCountdown--; }

    const mwx = mouseX * NDC_SCALE_X;
    const mwy = mouseY * NDC_SCALE_Y;

    // Drift homePos rightward per particle
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const drift = DRIFT_SPEEDS[clusterOf[i]] * (1 + features.normalizedEnergy * 0.4);
      homePos[i * 3] += drift;
      if (homePos[i * 3] > RIGHT_BOUND) homePos[i * 3] -= (RIGHT_BOUND - LEFT_BOUND);
    }

    const gpuPos = geometry.attributes.position.array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      const f  = freqs[i];

      // Wind force / decay
      if (isBlowing) {
        const dx   = homePos[i3]     - windX;
        const dy   = homePos[i3 + 1] - windY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < WIND_RADIUS) {
          const force = WIND_STRENGTH * (1 - dist / WIND_RADIUS);
          const angle = Math.atan2(dy, dx);
          windOffsetX[i] += Math.cos(angle) * force;
          windOffsetY[i] += Math.sin(angle) * force;
        }
      }
      windOffsetX[i] *= WIND_DECAY;
      windOffsetY[i] *= WIND_DECAY;

      // Oscillation: mostly vertical for clouds
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
    isBlowing = false;
  }

  return { points, update, triggerOnset, triggerWave, applyWind, setVisible, setScale, resetPositions };
}
