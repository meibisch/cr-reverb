import * as THREE from 'three';
import vertShader from '../shaders/particle.vert.glsl?raw';
import fragShader from '../shaders/sphere.frag.glsl?raw';

const BASE_AMP  = 0.05;
const AUDIO_AMP = 0.35;
const ATTACK    = 0.18;
const RELEASE   = 0.025;

const ATTRACT_RADIUS = 1.0;
const ATTRACT_FORCE  = 0.003;

// Bubble rise
const RISE_BASE      = 0.0015; // world units/frame — crosses ~5wu in ~55s
const RISE_AUDIO_MULT = 0.002;
const TOP_BOUND      =  2.5;
const BOTTOM_BOUND   = -2.5;
const FADE_ZONE      =  0.6;

const WAVE_EXPAND   = 0.025; // wu/frame — crosses sphere radius in ~1.3s at 60fps
const WAVE_FALLOFF  = 0.003; // strength decay/frame — ~5.5s total life
const WAVE_PUSH     = 0.12;  // max radial displacement (wu) at crest
const RIPPLE_LAMBDA = 1.5;   // wu between ripple crests — produces 2–3 visible rings

const NDC_SCALE_X = 3.3;
const NDC_SCALE_Y = 1.87;


export function createSphereField(particleCount = 50000) {
  const PARTICLE_COUNT = particleCount;
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
    uLoudness:     { value: 0 },
    uHighBand:     { value: 0 },
    uCentroid:     { value: 0 },
    uOnsetEnergy:  { value: 0 },
    uColorWhite:   { value: new THREE.Color('#ebebeb') },
    uColorBlue:    { value: new THREE.Color('#5b7fa6') },
    uColorMix:     { value: 0 },
    uBoundaryFade: { value: 1.0 },
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
  let sphereOffsetY  = -2.2;

  const wave = { active: false, originX: 0, originY: 0, progress: 0, strength: 0 };

  function triggerOnset() {
    onsetCountdown = 60;
  }

  function triggerWave(worldX, worldY) {
    wave.active   = true;
    wave.originX  = worldX;
    wave.originY  = worldY;
    wave.progress = 0;
    wave.strength = 1.0;
  }

  function setVisible(bool) { points.visible = bool; }
  function setScale(s)      { points.scale.set(s, s, s); }

  function update(features, time, mouseX = 0, mouseY = 0) {
    uniforms.uLoudness.value    = features.loudness;
    uniforms.uHighBand.value    = features.normalizedHigh;
    uniforms.uCentroid.value    = features.centroid;
    uniforms.uOnsetEnergy.value = features.onsetEnergy;

    const targetAmp = BASE_AMP + features.normalizedEnergy * AUDIO_AMP;
    smoothedAmp += (targetAmp > smoothedAmp ? ATTACK : RELEASE) * (targetAmp - smoothedAmp);

    uniforms.uColorMix.value = Math.max(0, Math.min(1, (smoothedAmp - BASE_AMP) / AUDIO_AMP));

    let effectiveAmp = smoothedAmp;
    if (onsetCountdown > 0) { effectiveAmp *= 1.0 + 0.5 * (onsetCountdown / 60); onsetCountdown--; }

    const mwx = mouseX * NDC_SCALE_X;
    const mwy = mouseY * NDC_SCALE_Y;

    // Bubble rise
    sphereOffsetY += RISE_BASE + features.normalizedEnergy * RISE_AUDIO_MULT;
    if (sphereOffsetY > TOP_BOUND) sphereOffsetY = BOTTOM_BOUND;
    const fadeTop = Math.min(1, (TOP_BOUND    - sphereOffsetY) / FADE_ZONE);
    const fadeBot = Math.min(1, (sphereOffsetY - BOTTOM_BOUND) / FADE_ZONE);
    uniforms.uBoundaryFade.value = Math.min(fadeTop, fadeBot);

    // Advance wave
    if (wave.active) {
      wave.progress += WAVE_EXPAND;
      wave.strength  = Math.max(0, wave.strength - WAVE_FALLOFF);
      if (wave.strength <= 0) wave.active = false;
    }

    const gpuPos = geometry.attributes.position.array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      const f  = freqs[i];

      let px = homePos[i3]     + Math.sin(time * f       + phases[i3])     * effectiveAmp;
      let py = homePos[i3 + 1] + Math.sin(time * f * 0.7 + phases[i3 + 1]) * effectiveAmp + sphereOffsetY;
      let pz = homePos[i3 + 2] + Math.sin(time * f * 0.5 + phases[i3 + 2]) * effectiveAmp;

      // Mouse attraction
      const mdx = mwx - px, mdy = mwy - py;
      const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
      if (mdist < ATTRACT_RADIUS && mdist > 0.001) {
        const pull = ATTRACT_FORCE * (1 - mdist / ATTRACT_RADIUS);
        px += (mdx / mdist) * pull;
        py += (mdy / mdist) * pull;
      }

      // Sine-based ripple wave
      if (wave.active) {
        const wdx  = px - wave.originX, wdy = py - wave.originY;
        const dist = Math.sqrt(wdx * wdx + wdy * wdy);
        if (dist > 0.001) {
          const phase    = (dist - wave.progress) / RIPPLE_LAMBDA;
          const envelope = Math.exp(-phase * phase * 1.8);
          const ripple   = Math.sin(phase * Math.PI * 2) * envelope;
          const push     = ripple * WAVE_PUSH * wave.strength;
          const angle    = Math.atan2(wdy, wdx);
          px += Math.cos(angle) * push;
          py += Math.sin(angle) * push;
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
    sphereOffsetY = -2.2;
    uniforms.uBoundaryFade.value = 1.0;
    wave.active = false; wave.progress = 0; wave.strength = 0;
  }

  return { points, update, triggerOnset, triggerWave, setVisible, setScale, resetPositions };
}
