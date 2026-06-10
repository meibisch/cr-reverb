import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import vertShader from '../shaders/fire.vert.glsl?raw';
import fragShader from '../shaders/fire.frag.glsl?raw';

const EMBER_FRAC = 0.15;

const FIRE_BASE_Y  = -1.6;
const SPREAD_X     =  1.1;
const SPREAD_Z     =  0.18;

// Age advances per frame (at 60fps reference)
const FLAME_AGE_BASE  = 0.0024;
const FLAME_AGE_AUDIO = 0.0018;
const EMBER_AGE_BASE  = 0.0012;
const EMBER_AGE_AUDIO = 0.0009;

// Rise speed (world units / frame at 60fps)
const FLAME_RISE_BASE  = 0.006;
const FLAME_RISE_AUDIO = 0.0045;
const EMBER_RISE_BASE  = 0.0036;
const EMBER_RISE_AUDIO = 0.003;

const FLAME_DRIFT = 0.003;
const EMBER_DRIFT = 0.006;

const ATTACK  = 0.18;
const RELEASE = 0.025;

// Mood envelope: slow attack, slower release — verses sink to embers,
// the chorus builds a roaring column (hysteresis avoids flicker)
const MOOD_ATTACK  = 0.045;
const MOOD_RELEASE = 0.010;
const ALIVE_MIN    = 0.12;  // fraction of flames burning at total calm

// Spine: the fire's central column sways slowly via simplex noise
const SPINE_SWAY_HZ   = 0.07;
const SPINE_AMPLITUDE = 0.45;
const CORE_SPREAD     = 0.28;
const SKIRT_SPREAD    = 0.85;

// Fanning: shader-side lean (wu at full column height), spring-back on release
const FAN_LEAN_MAX   = 1.1;
const FAN_SPRING_K   = 0.012;
const FAN_SPRING_DMP = 0.94;

// Backdraft: fanning too long starves the fire — release makes it roar back
const GUTTER_AFTER_S  = 3.5;
const BACKDRAFT_DECAY = 0.992; // per frame ≈ 4s

const SPARK_COUNT = 160;

const SPARK_VERT = `
  attribute float aAge;
  varying float vAge;
  void main() {
    vAge = aAge;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float sz = (1.0 - vAge) * 2.8;
    gl_PointSize = sz * (200.0 / -mvPos.z);
    gl_PointSize = clamp(gl_PointSize, 0.5, 7.0);
  }
`;

const SPARK_FRAG = `
  uniform vec3 uColorHot;
  uniform vec3 uColorCool;
  varying float vAge;
  void main() {
    float dist  = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float alpha = (1.0 - smoothstep(0.3, 1.0, dist)) * (1.0 - smoothstep(0.4, 1.0, vAge));
    vec3  color = mix(uColorHot, uColorCool, vAge * 1.4);
    color = clamp(color, 0.0, 1.0);
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

const noise2D = createNoise2D();

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * 0.5;
}

export function createFireField(particleCount = 50000) {
  const PARTICLE_COUNT = particleCount;
  const EMBER_COUNT    = Math.round(PARTICLE_COUNT * EMBER_FRAC);
  const FLAME_COUNT    = PARTICLE_COUNT - EMBER_COUNT;
  const pos     = new Float32Array(PARTICLE_COUNT * 3);
  const age     = new Float32Array(PARTICLE_COUNT);
  const drift   = new Float32Array(PARTICLE_COUNT);
  const isEmber = new Float32Array(PARTICLE_COUNT);
  const sizeArr = new Float32Array(PARTICLE_COUNT);
  const lifeMul = new Float32Array(PARTICLE_COUNT); // varied lifespans — no uniform death line

  let spineX = 0;

  function spawnFlame(i, pos, age, drift, sizeArr) {
    // dense core hugging the spine, faint wide skirt at the base
    const core   = Math.random() < 0.7;
    const spread = core ? CORE_SPREAD : SKIRT_SPREAD;
    pos[i * 3]     = spineX + gaussianRandom() * spread;
    pos[i * 3 + 1] = FIRE_BASE_Y + rand(-0.15, 0.15);
    pos[i * 3 + 2] = rand(-SPREAD_Z, SPREAD_Z);
    age[i]         = Math.random() * 0.25; // fresh flames start young
    drift[i]       = rand(-FLAME_DRIFT, FLAME_DRIFT);
    sizeArr[i]     = core ? rand(0.7, 1.3) : rand(0.4, 0.8);
    lifeMul[i]     = rand(0.6, 1.7);
  }

  function spawnEmber(i, pos, age, drift, sizeArr) {
    pos[i * 3]     = rand(-SPREAD_X * 0.6, SPREAD_X * 0.6);
    pos[i * 3 + 1] = FIRE_BASE_Y + rand(0.0, 0.4);
    pos[i * 3 + 2] = rand(-SPREAD_Z, SPREAD_Z);
    age[i]         = Math.random();
    drift[i]       = rand(-EMBER_DRIFT, EMBER_DRIFT);
    sizeArr[i]     = rand(0.3, 0.7);
    lifeMul[i]     = rand(0.6, 1.7);
  }

  for (let i = 0; i < FLAME_COUNT; i++) {
    isEmber[i] = 0;
    spawnFlame(i, pos, age, drift, sizeArr);
    age[i] = Math.random(); // initial fill: spread over the whole lifecycle
  }
  for (let i = FLAME_COUNT; i < PARTICLE_COUNT; i++) {
    isEmber[i] = 1;
    spawnEmber(i, pos, age, drift, sizeArr);
  }

  // ── Main flame geometry ────────────────────────────────────────────────────
  const geometry = new THREE.BufferGeometry();
  const posAttr  = new THREE.BufferAttribute(new Float32Array(pos), 3);
  posAttr.usage  = THREE.DynamicDrawUsage;
  const ageAttr  = new THREE.BufferAttribute(new Float32Array(age), 1);
  ageAttr.usage  = THREE.DynamicDrawUsage;
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aAge',     ageAttr);
  geometry.setAttribute('aIsEmber', new THREE.BufferAttribute(isEmber, 1));
  geometry.setAttribute('aSize',    new THREE.BufferAttribute(sizeArr, 1));

  const uniforms = {
    uLoudness:         { value: 0 },
    uHighBand:         { value: 0 },
    uLowBand:          { value: 0 },
    uOnsetEnergy:      { value: 0 },
    uTime:             { value: 0 },
    uEnergyColorShift: { value: 0 },
    uFanLean:          { value: 0 },
    uAliveFrac:        { value: ALIVE_MIN },
    uColorEmber:       { value: new THREE.Color('#8B1A00') },
    uColorFlame:       { value: new THREE.Color('#E85D04') },
    uColorTip:         { value: new THREE.Color('#F48C06') },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader:   vertShader,
    fragmentShader: fragShader,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);

  // ── Spark geometry ─────────────────────────────────────────────────────────
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  const sparkAge = new Float32Array(SPARK_COUNT).fill(1.0);

  const sparkGeo    = new THREE.BufferGeometry();
  const sparkPosA   = new THREE.BufferAttribute(sparkPos, 3);
  sparkPosA.usage   = THREE.DynamicDrawUsage;
  const sparkAgeA   = new THREE.BufferAttribute(sparkAge, 1);
  sparkAgeA.usage   = THREE.DynamicDrawUsage;
  sparkGeo.setAttribute('position', sparkPosA);
  sparkGeo.setAttribute('aAge',     sparkAgeA);

  const sparkMat = new THREE.ShaderMaterial({
    uniforms: {
      uColorHot:  { value: new THREE.Color('#FFC857') },
      uColorCool: { value: new THREE.Color('#E85D04') },
    },
    vertexShader:   SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });

  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);

  const sparks = Array.from({ length: SPARK_COUNT }, () =>
    ({ active: false, vx: 0, vy: 0, vz: 0 })
  );

  // ── State ──────────────────────────────────────────────────────────────────
  let smoothedAmp    = 0;
  let moodE          = 0;     // slow mood envelope: embers ↔ roaring column
  let backdraft      = 0;     // post-gutter roar, decays over ~4s
  let fanLean        = 0;     // current lean (wu at full height), shader-side
  let fanVel         = 0;     // spring velocity for the whip-back
  let fanTarget      = 0;
  let fanningNow     = false;
  let fanLift        = 0;
  let fanHoldSec     = 0;
  let lastUpdateTime = 0;

  function triggerOnset() {}

  function setScale(s) {
    points.scale.set(s, s, s);
    sparkPoints.scale.set(s, s, s);
  }

  function applyFanning(worldX, worldY, strength) {
    const leanDir = worldX < 0 ? 1 : -1;
    fanTarget  = leanDir * strength * FAN_LEAN_MAX;
    fanLift    = strength * 0.004;
    fanningNow = true;
  }

  function triggerSparks(worldX, worldY, count = 80, speedLo = 0.018, speedHi = 0.038, upBias = 0.006) {
    const gpuPos = sparkGeo.attributes.position.array;
    const gpuAge = sparkGeo.attributes.aAge.array;
    let activated = 0;
    for (let i = 0; i < SPARK_COUNT && activated < count; i++) {
      if (gpuAge[i] >= 1.0) {
        const angle = Math.random() * Math.PI * 2;
        const speed = rand(speedLo, speedHi);
        sparks[i].active = true;
        sparks[i].vx     = Math.cos(angle) * speed;
        sparks[i].vy     = Math.sin(angle) * speed + upBias;
        sparks[i].vz     = rand(-0.015, 0.015);
        gpuPos[i * 3]     = worldX + rand(-0.15, 0.15);
        gpuPos[i * 3 + 1] = worldY + rand(-0.15, 0.15);
        gpuPos[i * 3 + 2] = rand(-0.10, 0.10);
        gpuAge[i] = 0;
        activated++;
      }
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.aAge.needsUpdate     = true;
  }

  function releaseEmberBurst(worldX, worldY, strength) {
    // fanned long enough to starve the fire? release = backdraft roar
    if (fanHoldSec >= GUTTER_AFTER_S) {
      backdraft = 1;
      triggerSparks(spineX, FIRE_BASE_Y + 0.4, 150, 0.030, 0.10, 0.030);
    } else {
      const count   = Math.floor(60 + strength * 120);
      const speedHi = 0.038 + strength * 0.050;
      const upBias  = 0.010 + strength * 0.015;
      triggerSparks(worldX, worldY, count, 0.025, speedHi, upBias);
    }
    fanHoldSec = 0;
  }

  function triggerWave() {}

  function setVisible(bool) {
    points.visible      = bool;
    sparkPoints.visible = bool;
  }

  function update(features, time, mouseX = 0, mouseY = 0, chargeLevel = 0, isPlaying = true) {
    uniforms.uLoudness.value    = features.loudness;
    uniforms.uHighBand.value    = features.normalizedHigh;
    uniforms.uLowBand.value     = features.normalizedLow || 0;
    uniforms.uOnsetEnergy.value = features.onsetEnergy;
    uniforms.uTime.value        = time;

    const dtScale = lastUpdateTime > 0
      ? Math.min(3, Math.max(0.25, (time - lastUpdateTime) * 60))
      : 1;
    // real elapsed time for hold-duration tracking (not clamped like dtScale)
    const dtSec = lastUpdateTime > 0 ? Math.min(time - lastUpdateTime, 0.25) : 1 / 60;
    lastUpdateTime = time;

    // Spine sways in slow geological time
    spineX = noise2D(time * SPINE_SWAY_HZ, 0) * SPINE_AMPLITUDE;

    const targetAmp = isPlaying ? features.normalizedEnergy : 0;
    smoothedAmp += (targetAmp > smoothedAmp ? ATTACK : RELEASE) * (targetAmp - smoothedAmp);

    // Mood: silence sinks to embers, the chorus roars; backdraft overrides
    moodE += (targetAmp > moodE ? MOOD_ATTACK : MOOD_RELEASE) * (targetAmp - moodE) * dtScale;
    backdraft *= Math.pow(BACKDRAFT_DECAY, dtScale);
    if (backdraft < 0.01) backdraft = 0;

    const e = Math.max(smoothedAmp, backdraft);
    const mood = Math.max(moodE, backdraft);

    uniforms.uEnergyColorShift.value = e;

    // Fanning: spring-loaded lean. Holding bends the column; release whips back
    if (fanningNow) {
      fanLean   += (fanTarget - fanLean) * 0.08 * dtScale;
      fanVel     = 0;
      fanHoldSec += dtSec;
      // fire gutters when fanned too long — flames starve, embers brighten
    } else if (Math.abs(fanLean) > 0.0005 || Math.abs(fanVel) > 0.0005) {
      fanVel  += -fanLean * FAN_SPRING_K * dtScale;
      fanVel  *= Math.pow(FAN_SPRING_DMP, dtScale);
      fanLean += fanVel * dtScale;
    } else {
      fanLean = 0; fanVel = 0;
    }
    const gutter = fanningNow ? Math.max(0.25, 1 - Math.max(0, fanHoldSec - GUTTER_AFTER_S) / 1.5) : 1;
    fanningNow = false; // re-set every frame by applyFanning while holding
    uniforms.uFanLean.value = fanLean;

    // How much of the flame population burns right now
    const aliveFrac = (ALIVE_MIN + (1 - ALIVE_MIN) * mood) * gutter;
    const allowed   = Math.floor(FLAME_COUNT * aliveFrac);
    uniforms.uAliveFrac.value = aliveFrac;
    // Column height follows mood via rise speed — no hard ceiling, no banding
    const flameRise = (FLAME_RISE_BASE + e * FLAME_RISE_AUDIO) * (0.35 + 0.65 * mood);

    const gpuPos = geometry.attributes.position.array;
    const gpuAge = geometry.attributes.aAge.array;

    // Flames
    for (let i = 0; i < FLAME_COUNT; i++) {
      gpuAge[i] += (FLAME_AGE_BASE + e * FLAME_AGE_AUDIO) * lifeMul[i] * dtScale;
      if (gpuAge[i] >= 1.0) {
        if (i < allowed) {
          spawnFlame(i, gpuPos, gpuAge, drift, sizeArr);
        } else {
          gpuAge[i] = 1.0; // dormant: invisible until the music calls it back
        }
        continue;
      }
      gpuPos[i * 3]     += drift[i] * dtScale;
      gpuPos[i * 3 + 1] += (flameRise + fanLift) * dtScale;
    }

    fanLift *= Math.pow(0.92, dtScale);

    // Embers — the constant base; pulse handled in the shader via uLowBand
    for (let i = FLAME_COUNT; i < PARTICLE_COUNT; i++) {
      gpuAge[i] += (EMBER_AGE_BASE + e * EMBER_AGE_AUDIO) * lifeMul[i] * dtScale;
      if (gpuAge[i] >= 1.0) {
        spawnEmber(i, gpuPos, gpuAge, drift, sizeArr);
        continue;
      }
      gpuPos[i * 3]     += (drift[i] + (Math.random() - 0.5) * 0.001) * dtScale;
      gpuPos[i * 3 + 1] += (EMBER_RISE_BASE + e * EMBER_RISE_AUDIO) * dtScale;
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aAge.needsUpdate     = true;

    // Sparks
    const sPos = sparkGeo.attributes.position.array;
    const sAge = sparkGeo.attributes.aAge.array;
    let sparkDirty = false;
    for (let i = 0; i < SPARK_COUNT; i++) {
      if (!sparks[i].active) continue;
      sparks[i].vy     -= 0.0012 * dtScale;
      sparks[i].vx     *= Math.pow(0.96, dtScale);
      sparks[i].vy     *= Math.pow(0.97, dtScale);
      sPos[i * 3]      += sparks[i].vx * dtScale;
      sPos[i * 3 + 1]  += sparks[i].vy * dtScale;
      sPos[i * 3 + 2]  += sparks[i].vz * dtScale;
      sAge[i]          += 0.018 * dtScale;
      if (sAge[i] >= 1.0) sparks[i].active = false;
      sparkDirty = true;
    }
    if (sparkDirty) {
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.aAge.needsUpdate     = true;
    }
  }

  function resetPositions() {
    for (let i = 0; i < FLAME_COUNT; i++) { spawnFlame(i, pos, age, drift, sizeArr); age[i] = Math.random(); }
    for (let i = FLAME_COUNT; i < PARTICLE_COUNT; i++) spawnEmber(i, pos, age, drift, sizeArr);
    const gpuPos = geometry.attributes.position.array;
    const gpuAge = geometry.attributes.aAge.array;
    gpuPos.set(pos); gpuAge.set(age);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aAge.needsUpdate     = true;
    sparkGeo.attributes.aAge.array.fill(1.0);
    sparkGeo.attributes.aAge.needsUpdate = true;
    sparks.forEach(s => { s.active = false; });
    smoothedAmp = 0;
    moodE = 0; backdraft = 0;
    fanLean = 0; fanVel = 0; fanTarget = 0; fanLift = 0; fanHoldSec = 0;
    uniforms.uFanLean.value = 0;
  }

  function getDebugState() {
    return { moodE, backdraft, fanLean, fanHoldSec, spineX };
  }

  return { points, sparkPoints, update, triggerOnset, triggerSparks, releaseEmberBurst, triggerWave, applyFanning, setVisible, setScale, resetPositions, getDebugState };
}
