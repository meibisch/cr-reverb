import * as THREE from 'three';
import vertShader from '../shaders/fire.vert.glsl?raw';
import fragShader from '../shaders/fire.frag.glsl?raw';

const PARTICLE_COUNT = 50000;
const EMBER_FRAC     = 0.15;
const EMBER_COUNT    = Math.round(PARTICLE_COUNT * EMBER_FRAC);
const FLAME_COUNT    = PARTICLE_COUNT - EMBER_COUNT;

const FIRE_BASE_Y  = -1.6;
const SPREAD_X     =  1.1;
const SPREAD_Z     =  0.18;

// Age advances per frame — slowed to ~30% of original
const FLAME_AGE_BASE  = 0.0024;
const FLAME_AGE_AUDIO = 0.0018;
const EMBER_AGE_BASE  = 0.0012;
const EMBER_AGE_AUDIO = 0.0009;

// Rise speed (world units / frame) — slowed to ~30%
const FLAME_RISE_BASE  = 0.006;
const FLAME_RISE_AUDIO = 0.0045;
const EMBER_RISE_BASE  = 0.0036;
const EMBER_RISE_AUDIO = 0.003;

const FLAME_DRIFT = 0.003;
const EMBER_DRIFT = 0.006;

const ATTACK  = 0.18;
const RELEASE = 0.025;

const SPARK_COUNT = 120;

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

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

function spawnFlame(i, pos, age, drift, sizeArr) {
  pos[i * 3]     = rand(-SPREAD_X, SPREAD_X);
  pos[i * 3 + 1] = FIRE_BASE_Y + rand(-0.15, 0.15);
  pos[i * 3 + 2] = rand(-SPREAD_Z, SPREAD_Z);
  age[i]         = Math.random();
  drift[i]       = rand(-FLAME_DRIFT, FLAME_DRIFT);
  sizeArr[i]     = rand(0.5, 1.2);
}

function spawnEmber(i, pos, age, drift, sizeArr) {
  pos[i * 3]     = rand(-SPREAD_X * 0.6, SPREAD_X * 0.6);
  pos[i * 3 + 1] = FIRE_BASE_Y + rand(0.0, 0.4);
  pos[i * 3 + 2] = rand(-SPREAD_Z, SPREAD_Z);
  age[i]         = Math.random();
  drift[i]       = rand(-EMBER_DRIFT, EMBER_DRIFT);
  sizeArr[i]     = rand(0.3, 0.7);
}

export function createFireField() {
  const pos     = new Float32Array(PARTICLE_COUNT * 3);
  const age     = new Float32Array(PARTICLE_COUNT);
  const drift   = new Float32Array(PARTICLE_COUNT);
  const isEmber = new Float32Array(PARTICLE_COUNT);
  const sizeArr = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < FLAME_COUNT; i++) {
    isEmber[i] = 0;
    spawnFlame(i, pos, age, drift, sizeArr);
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
    uOnsetEnergy:      { value: 0 },
    uTime:             { value: 0 },
    uEnergyColorShift: { value: 0 },
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

  // CPU-side spark state (velocity only — position/age live in GPU arrays)
  const sparks = Array.from({ length: SPARK_COUNT }, () =>
    ({ active: false, vx: 0, vy: 0, vz: 0 })
  );

  let smoothedAmp = 0;

  function triggerOnset() {}

  function triggerSparks(worldX, worldY) {
    const gpuPos = sparkGeo.attributes.position.array;
    const gpuAge = sparkGeo.attributes.aAge.array;
    let activated = 0;
    for (let i = 0; i < SPARK_COUNT && activated < 80; i++) {
      if (gpuAge[i] >= 1.0) {
        const angle = Math.random() * Math.PI * 2;
        const speed = rand(0.05, 0.10);
        sparks[i].active = true;
        sparks[i].vx     = Math.cos(angle) * speed;
        sparks[i].vy     = Math.sin(angle) * speed + 0.015;
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

  // Keep triggerWave as no-op so main.js interface stays consistent
  function triggerWave() {}

  function setVisible(bool) {
    points.visible      = bool;
    sparkPoints.visible = bool;
  }

  function update(features, time) {
    uniforms.uLoudness.value    = features.loudness;
    uniforms.uHighBand.value    = features.normalizedHigh;
    uniforms.uOnsetEnergy.value = features.onsetEnergy;
    uniforms.uTime.value        = time;

    const targetAmp = features.normalizedEnergy;
    smoothedAmp += (targetAmp > smoothedAmp ? ATTACK : RELEASE) * (targetAmp - smoothedAmp);
    const e = smoothedAmp;

    uniforms.uEnergyColorShift.value = e;

    const gpuPos = geometry.attributes.position.array;
    const gpuAge = geometry.attributes.aAge.array;

    // Flames
    for (let i = 0; i < FLAME_COUNT; i++) {
      gpuAge[i] += FLAME_AGE_BASE + e * FLAME_AGE_AUDIO;
      if (gpuAge[i] >= 1.0) {
        spawnFlame(i, gpuPos, gpuAge, drift, sizeArr);
        continue;
      }
      gpuPos[i * 3]     += drift[i];
      gpuPos[i * 3 + 1] += FLAME_RISE_BASE + e * FLAME_RISE_AUDIO;
    }

    // Embers
    for (let i = FLAME_COUNT; i < PARTICLE_COUNT; i++) {
      gpuAge[i] += EMBER_AGE_BASE + e * EMBER_AGE_AUDIO;
      if (gpuAge[i] >= 1.0) {
        spawnEmber(i, gpuPos, gpuAge, drift, sizeArr);
        continue;
      }
      gpuPos[i * 3]     += drift[i] + (Math.random() - 0.5) * 0.001;
      gpuPos[i * 3 + 1] += EMBER_RISE_BASE + e * EMBER_RISE_AUDIO;
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aAge.needsUpdate     = true;

    // Sparks
    const sPos = sparkGeo.attributes.position.array;
    const sAge = sparkGeo.attributes.aAge.array;
    let sparkDirty = false;
    for (let i = 0; i < SPARK_COUNT; i++) {
      if (!sparks[i].active) continue;
      sparks[i].vy     -= 0.0012;
      sparks[i].vx     *= 0.96;
      sparks[i].vy     *= 0.97;
      sPos[i * 3]      += sparks[i].vx;
      sPos[i * 3 + 1]  += sparks[i].vy;
      sPos[i * 3 + 2]  += sparks[i].vz;
      sAge[i]          += 0.018;
      if (sAge[i] >= 1.0) sparks[i].active = false;
      sparkDirty = true;
    }
    if (sparkDirty) {
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.aAge.needsUpdate     = true;
    }
  }

  function resetPositions() {
    for (let i = 0; i < FLAME_COUNT; i++) spawnFlame(i, pos, age, drift, sizeArr);
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
  }

  return { points, sparkPoints, update, triggerOnset, triggerSparks, triggerWave, setVisible, resetPositions };
}
