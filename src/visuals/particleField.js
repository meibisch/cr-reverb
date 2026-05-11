import * as THREE from 'three';
import vertShader from '../shaders/particle.vert.glsl?raw';
import fragShader from '../shaders/particle.frag.glsl?raw';

const PARTICLE_COUNT = 50000;

// World-unit amplitudes (sphere radius ~2.0, camera at z=4, visible height ~3.7 wu)
const BASE_AMP  = 0.05;   // baseline breathing in silence
const AUDIO_AMP = 0.35;   // max additional amplitude at full energy

// Asymmetric envelope
const ATTACK  = 0.18;     // fast rise
const RELEASE = 0.025;    // slow decay — movement lingers like reverb tail

// Mouse attraction (world units)
const ATTRACT_RADIUS = 1.0;   // particles within 1.0 wu feel the cursor
const ATTRACT_FORCE  = 0.003; // gentle lean per frame

// Click wave (world units)
const WAVE_SPEED   = 0.012;  // waveProgress per frame
const WAVE_FALLOFF = 0.010;  // strength decay per frame (~100 frames = ~1.7s)
const WAVE_PUSH    = 0.08;   // max radial displacement at wave front
const WAVE_WIDTH   = 0.4;    // ring thickness in world units
const WAVE_RADIUS  = 5.0;    // waveProgress 0→1 maps to 0→5 world units

// NDC (-1..1) → world coords at z=0 for this camera (FOV 50, aspect ~1.78)
const NDC_SCALE_X = 3.3;   // half visible width  at z=0
const NDC_SCALE_Y = 1.87;  // half visible height at z=0

export function createParticleField() {
  const homePos = new Float32Array(PARTICLE_COUNT * 3);
  const phases  = new Float32Array(PARTICLE_COUNT * 3);
  const freqs   = new Float32Array(PARTICLE_COUNT);
  const sizes   = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = Math.cbrt(Math.random()) * 2.0;

    homePos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    homePos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    homePos[i * 3 + 2] = r * Math.cos(phi) * 0.55;

    phases[i * 3]     = Math.random() * Math.PI * 2;
    phases[i * 3 + 1] = Math.random() * Math.PI * 2;
    phases[i * 3 + 2] = Math.random() * Math.PI * 2;

    freqs[i] = 0.25 + Math.random() * 0.35;
    sizes[i] = 0.4 + Math.random() * 0.6;
  }

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

  // Envelope state
  let smoothedAmp = BASE_AMP;

  // Onset state
  let onsetCountdown = 0;

  // Wave state
  let waveActive   = false;
  let waveOriginX  = 0;
  let waveOriginY  = 0;
  let waveProgress = 0;
  let waveStrength = 0;

  function triggerOnset() {
    onsetCountdown = 60;
  }

  function triggerWave(worldX, worldY) {
    waveActive   = true;
    waveOriginX  = worldX;
    waveOriginY  = worldY;
    waveProgress = 0;
    waveStrength = 1.0;
  }

  function update(features, time, mouseX = 0, mouseY = 0) {
    uniforms.uLoudness.value    = features.loudness;
    uniforms.uHighBand.value    = features.normalizedHigh;
    uniforms.uCentroid.value    = features.centroid;
    uniforms.uOnsetEnergy.value = features.onsetEnergy;

    // Asymmetric envelope on amplitude
    const targetAmp = BASE_AMP + features.normalizedEnergy * AUDIO_AMP;
    if (targetAmp > smoothedAmp) {
      smoothedAmp += (targetAmp - smoothedAmp) * ATTACK;
    } else {
      smoothedAmp += (targetAmp - smoothedAmp) * RELEASE;
    }

    // Onset expansion: 1.5× for ~60 frames
    let effectiveAmp = smoothedAmp;
    if (onsetCountdown > 0) {
      effectiveAmp *= 1.0 + 0.5 * (onsetCountdown / 60);
      onsetCountdown--;
    }

    // Mouse in world coords
    const mwx = mouseX * NDC_SCALE_X;
    const mwy = mouseY * NDC_SCALE_Y;

    // Advance wave
    if (waveActive) {
      waveProgress += WAVE_SPEED;
      waveStrength  = Math.max(0, waveStrength - WAVE_FALLOFF);
      if (waveStrength <= 0) waveActive = false;
    }
    const waveRadius = waveProgress * WAVE_RADIUS;

    const gpuPos = geometry.attributes.position.array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      const f  = freqs[i];

      // Base oscillation from homePos
      let px = homePos[i3]     + Math.sin(time * f       + phases[i3])     * effectiveAmp;
      let py = homePos[i3 + 1] + Math.sin(time * f * 0.7 + phases[i3 + 1]) * effectiveAmp;
      let pz = homePos[i3 + 2] + Math.sin(time * f * 0.5 + phases[i3 + 2]) * effectiveAmp;

      // Mouse attraction (XY plane only)
      const mdx  = mwx - px;
      const mdy  = mwy - py;
      const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
      if (mdist < ATTRACT_RADIUS && mdist > 0.001) {
        const pull = ATTRACT_FORCE * (1 - mdist / ATTRACT_RADIUS);
        px += (mdx / mdist) * pull;
        py += (mdy / mdist) * pull;
      }

      // Click wave (XY plane)
      if (waveActive) {
        const wdx  = px - waveOriginX;
        const wdy  = py - waveOriginY;
        const wdist = Math.sqrt(wdx * wdx + wdy * wdy);
        const distFromFront = Math.abs(wdist - waveRadius);
        if (distFromFront < WAVE_WIDTH && wdist > 0.001) {
          const falloff  = 1 - distFromFront / WAVE_WIDTH;
          const pushAmt  = WAVE_PUSH * falloff * waveStrength;
          const angle    = Math.atan2(wdy, wdx);
          px += Math.cos(angle) * pushAmt;
          py += Math.sin(angle) * pushAmt;
        }
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
    smoothedAmp = BASE_AMP;
    onsetCountdown = 0;
    waveActive = false;
  }

  return { points, update, triggerOnset, triggerWave, resetPositions };
}
