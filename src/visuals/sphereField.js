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
const RISE_BASE       = 0.0010; // world units/frame — full cycle ~50–70s typical
const RISE_AUDIO_MULT = 0.0012;
const SURFACE_Y       =  1.9;   // pop happens while the bubble is still fully visible
const BOTTOM_BOUND    = -2.5;
const FADE_ZONE       =  0.6;
const APPROACH_ZONE   =  0.5;   // rise eases off in the last half unit below the surface

// Pop / reform lifecycle (seconds)
const PAUSE_DUR     = 0.7;  // held breath at the surface
const POP_DUR       = 1.6;  // burst + fade
const REFORM_DUR    = 4.0;  // scattered particles converge while rising from below
const POP_EXPAND    = 1.9;  // radial expansion factor added at full pop
const REFORM_SPREAD = 1.6;

// Press dent (hold interaction) — hands pressing against the bubble from outside
const PRESS_RADIUS   = 1.0;
const PRESS_STRENGTH = 0.5;

const NDC_SCALE_X = 3.3;
const NDC_SCALE_Y = 1.87;

// Marine snow — faint dust sinking past the bubble; sells the upward motion
const SNOW_FRAC = 0.08;

const SNOW_VERT = `
  uniform float uTime;
  uniform float uLoudness;
  attribute float aSpeed;
  attribute float aSize;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.y = 2.9 - mod((2.9 - position.y) + uTime * aSpeed, 5.8);
    vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPos;
    gl_PointSize = clamp(aSize * (200.0 / -mvPos.z), 0.5, 3.0);
    vAlpha = 0.025 + uLoudness * 0.05;
  }
`;

const SNOW_FRAG = `
  varying float vAlpha;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float a = (1.0 - smoothstep(0.2, 1.0, dist)) * vAlpha;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vec3(0.75, 0.80, 0.86), a);
  }
`;

function easeOutCubic(t) {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

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
    uTime:         { value: 0 },
    uFlash:        { value: 0 },
    uScale:        { value: 1 },
    uColorWhite:   { value: new THREE.Color('#ebebeb') },
    uColorBlue:    { value: new THREE.Color('#5b7fa6') },
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

  // ── Marine snow (GPU-driven, no per-frame CPU cost) ────────────────────────
  const SNOW_COUNT = Math.round(PARTICLE_COUNT * SNOW_FRAC);
  const snowPos    = new Float32Array(SNOW_COUNT * 3);
  const snowSpeed  = new Float32Array(SNOW_COUNT);
  const snowSize   = new Float32Array(SNOW_COUNT);

  for (let i = 0; i < SNOW_COUNT; i++) {
    snowPos[i * 3]     = (Math.random() * 2 - 1) * 3.5;
    snowPos[i * 3 + 1] = (Math.random() * 2 - 1) * 2.9;
    snowPos[i * 3 + 2] = (Math.random() * 2 - 1) * 1.0;
    snowSpeed[i] = 0.05 + Math.random() * 0.08; // world units / s, sinking
    snowSize[i]  = 0.5 + Math.random() * 1.0;
  }

  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  snowGeo.setAttribute('aSpeed',   new THREE.BufferAttribute(snowSpeed, 1));
  snowGeo.setAttribute('aSize',    new THREE.BufferAttribute(snowSize, 1));

  const snowMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:     { value: 0 },
      uLoudness: { value: 0 },
    },
    vertexShader:   SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const snowPoints = new THREE.Points(snowGeo, snowMat);

  // ── State ──────────────────────────────────────────────────────────────────
  let smoothedAmp    = BASE_AMP;
  let onsetCountdown = 0;
  let sphereOffsetY  = -2.2;

  // Lifecycle: rising → pausing (at surface) → popping → reforming (from below)
  let phase          = 'rising';
  let phaseStart     = 0;
  let lastUpdateTime = 0;

  // Press dent
  let pressX = 0, pressY = 0;
  let pressTarget = 0;
  let pressLevel  = 0;

  const wave = {
    active: false, originX: 0, originY: 0, progress: 0, strength: 0,
    expandSpeed: 0.025, pushStrength: 0.12, lambda: 1.5, falloff: 0.002,
  };

  function triggerOnset() { onsetCountdown = 60; }

  function triggerWave(worldX, worldY, charge = 0) {
    wave.active      = true;
    wave.originX     = worldX;
    wave.originY     = worldY;
    wave.progress    = 0;
    wave.strength    = 1.0;
    // charge 0 = quick tap (fast, compact, ~8s); charge 1 = full hold (slow, deep swell, ~18s)
    wave.expandSpeed  = 0.030 - charge * 0.017;  // 0.030 → 0.013 wu/frame
    wave.pushStrength = 0.10  + charge * 0.18;   // 0.10  → 0.28  wu
    wave.lambda       = 1.5   + charge * 2.3;    // 1.5   → 3.8   wu
    wave.falloff      = 0.0020 - charge * 0.0011; // 0.0020 → 0.0009 (≈8s → ≈18s life)
  }

  function applyPress(worldX, worldY, level) {
    pressX      = worldX;
    pressY      = worldY;
    pressTarget = level;
  }

  function setVisible(bool) {
    points.visible     = bool;
    snowPoints.visible = bool;
  }

  function setScale(s) {
    points.scale.set(s, s, s);
    snowPoints.scale.set(s, s, s);
    uniforms.uScale.value = s;
  }

  function update(features, time, mouseX = 0, mouseY = 0, chargeLevel = 0, isPlaying = true) {
    uniforms.uLoudness.value    = features.loudness;
    uniforms.uHighBand.value    = features.normalizedHigh;
    uniforms.uCentroid.value    = features.centroid;
    uniforms.uOnsetEnergy.value = features.onsetEnergy;
    uniforms.uTime.value        = time;

    snowMat.uniforms.uTime.value     = time;
    snowMat.uniforms.uLoudness.value = features.loudness;

    const targetAmp = BASE_AMP + features.normalizedEnergy * AUDIO_AMP;
    smoothedAmp += (targetAmp > smoothedAmp ? ATTACK : RELEASE) * (targetAmp - smoothedAmp);

    let effectiveAmp = smoothedAmp;
    if (onsetCountdown > 0) { effectiveAmp *= 1.0 + 0.5 * (onsetCountdown / 60); onsetCountdown--; }
    // Charge pulse: sphere breathes faster while holding
    if (chargeLevel > 0) {
      effectiveAmp += Math.sin(time * (2 + chargeLevel * 6)) * chargeLevel * 0.04;
    }

    const mwx = mouseX * NDC_SCALE_X;
    const mwy = mouseY * NDC_SCALE_Y;

    // ── Lifecycle — only advances while music plays (silence = stillness) ──
    // dtScale normalizes per-frame constants (tuned at 60fps) to real time,
    // so 120Hz displays don't run the lifecycle twice as fast
    const dtScale = lastUpdateTime > 0
      ? Math.min(3, Math.max(0.25, (time - lastUpdateTime) * 60))
      : 1;
    const riseSpeed = (RISE_BASE + features.normalizedEnergy * RISE_AUDIO_MULT) * dtScale;

    if (!isPlaying) {
      // freeze the cycle; keep phase timers from jumping when playback resumes
      phaseStart += time - lastUpdateTime;
    } else if (phase === 'rising') {
      // rise eases off approaching the surface — a held breath before the pop
      const ease = Math.min(1, Math.max(0.12, (SURFACE_Y - sphereOffsetY) / APPROACH_ZONE));
      sphereOffsetY += riseSpeed * ease;
      if (sphereOffsetY >= SURFACE_Y - 0.02) { phase = 'pausing'; phaseStart = time; }
    } else if (phase === 'pausing') {
      if (time - phaseStart >= PAUSE_DUR) { phase = 'popping'; phaseStart = time; }
    } else if (phase === 'popping') {
      if (time - phaseStart >= POP_DUR) {
        phase         = 'reforming';
        phaseStart    = time;
        sphereOffsetY = BOTTOM_BOUND;
      }
    } else { // reforming
      sphereOffsetY += riseSpeed;
      if (time - phaseStart >= REFORM_DUR) phase = 'rising';
    }
    lastUpdateTime = time;

    // Per-frame lifecycle params
    let bubbleScale = 1;
    let popFade     = 1;
    let flash       = 0;

    if (phase === 'popping') {
      const t  = (time - phaseStart) / POP_DUR;
      bubbleScale = 1 + easeOutCubic(t) * POP_EXPAND;
      popFade     = 1 - Math.min(1, Math.max(0, (t - 0.25) / 0.6));
      flash       = Math.exp(-t * 5);
    } else if (phase === 'reforming') {
      const t = (time - phaseStart) / REFORM_DUR;
      bubbleScale = 1 + (1 - easeOutCubic(t)) * REFORM_SPREAD;
    }

    uniforms.uFlash.value = flash;

    const fadeBot = Math.min(1, (sphereOffsetY - BOTTOM_BOUND) / FADE_ZONE);
    uniforms.uBoundaryFade.value = Math.max(0, Math.min(fadeBot, popFade));

    // Press dent eases in while holding, relaxes after release
    pressLevel += (pressTarget - pressLevel) * 0.15;
    pressTarget = 0; // re-set every frame by applyPress while holding

    // Advance wave
    if (wave.active) {
      wave.progress += wave.expandSpeed * dtScale;
      wave.strength  = Math.max(0, wave.strength - wave.falloff * dtScale);
      if (wave.strength <= 0) wave.active = false;
    }

    const gpuPos = geometry.attributes.position.array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      const f  = freqs[i];

      let px = homePos[i3]     * bubbleScale + Math.sin(time * f       + phases[i3])     * effectiveAmp;
      let py = homePos[i3 + 1] * bubbleScale + Math.sin(time * f * 0.7 + phases[i3 + 1]) * effectiveAmp + sphereOffsetY;
      let pz = homePos[i3 + 2] * bubbleScale + Math.sin(time * f * 0.5 + phases[i3 + 2]) * effectiveAmp;

      // Mouse attraction
      const mdx = mwx - px, mdy = mwy - py;
      const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
      if (mdist < ATTRACT_RADIUS && mdist > 0.001) {
        const pull = ATTRACT_FORCE * (1 - mdist / ATTRACT_RADIUS);
        px += (mdx / mdist) * pull;
        py += (mdy / mdist) * pull;
      }

      // Press dent: membrane gives way under the hand
      if (pressLevel > 0.003) {
        const ddx = px - pressX, ddy = py - pressY;
        const d   = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < PRESS_RADIUS && d > 0.001) {
          const fall = 1 - d / PRESS_RADIUS;
          const push = fall * fall * PRESS_STRENGTH * pressLevel;
          px += (ddx / d) * push;
          py += (ddy / d) * push;
        }
      }

      // Sine-based ripple wave
      if (wave.active) {
        const wdx  = px - wave.originX, wdy = py - wave.originY;
        const dist = Math.sqrt(wdx * wdx + wdy * wdy);
        if (dist > 0.001) {
          const phs      = (dist - wave.progress) / wave.lambda;
          const envelope = Math.exp(-phs * phs * 1.8);
          const ripple   = Math.sin(phs * Math.PI * 2) * envelope;
          const push     = ripple * wave.pushStrength * wave.strength;
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
    phase = 'rising';
    phaseStart = 0;
    pressLevel = 0;
    pressTarget = 0;
    uniforms.uBoundaryFade.value = 1.0;
    uniforms.uFlash.value = 0;
    wave.active = false; wave.progress = 0; wave.strength = 0;
  }

  function getDebugState() {
    return { phase, sphereOffsetY, phaseStart, lastUpdateTime };
  }

  return { points, snowPoints, update, triggerOnset, triggerWave, applyPress, setVisible, setScale, resetPositions, getDebugState };
}
