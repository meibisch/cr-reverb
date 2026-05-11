import { getSampleRate, getFFTSize } from './audioEngine.js';

class Smoother {
  constructor(attackMs, releaseMs, initial = 0) {
    this.attackMs = attackMs;
    this.releaseMs = releaseMs;
    this.value = initial;
  }
  update(raw, dtMs) {
    const tau = raw > this.value ? this.attackMs : this.releaseMs;
    const alpha = 1 - Math.exp(-dtMs / tau);
    this.value += alpha * (raw - this.value);
    return this.value;
  }
}

class AdaptiveNorm {
  constructor(windowFrames = 480) {
    this.window = windowFrames;
    this.history = [];
  }
  update(raw) {
    this.history.push(raw);
    if (this.history.length > this.window) this.history.shift();
    if (this.history.length < 120) return 0.15;
    const min = Math.min(...this.history);
    const max = Math.max(...this.history);
    const range = max - min;
    if (range < 0.0001) return 0.15;
    return Math.max(0, Math.min(1, (raw - min) / range));
  }
}

function hzToBin(hz, sampleRate, fftSize) {
  return Math.round((hz / (sampleRate / 2)) * (fftSize / 2));
}

function bandSum(freqData, lo, hi) {
  let sum = 0;
  const count = hi - lo + 1;
  for (let i = lo; i <= hi; i++) sum += freqData[i] / 255;
  return count > 0 ? sum / count : 0;
}

const loudnessSm = new Smoother(500, 2000, 0);
const highSm     = new Smoother(150, 1200, 0);
const centroidSm = new Smoother(400, 800, 0);
const onsetSm    = new Smoother(50, 3000, 0);

const rmsNorm  = new AdaptiveNorm(480);
const highNorm = new AdaptiveNorm(480);

let prevRms = 0;

const features = {
  loudness:        0,
  normalizedEnergy:0,
  normalizedHigh:  0,
  centroid:        0,
  onsetEnergy:     0,
  onsetFired:      false,
};

export function updateFeatures(freqData, timeDomainData, dtMs) {
  const sampleRate = getSampleRate();
  const fftSize    = getFFTSize();
  const binCount   = fftSize / 2;

  const highLo = hzToBin(4000,  sampleRate, fftSize);
  const highHi = Math.min(hzToBin(16000, sampleRate, fftSize), binCount - 1);

  // RMS
  let sumSq = 0;
  for (let i = 0; i < timeDomainData.length; i++) {
    const s = (timeDomainData[i] - 128) / 128;
    sumSq += s * s;
  }
  const rawRms = Math.sqrt(sumSq / timeDomainData.length);
  const smoothRms = loudnessSm.update(rawRms, dtMs);

  features.loudness         = smoothRms * 2.5;
  features.normalizedEnergy = rmsNorm.update(smoothRms);
  features.normalizedHigh   = highNorm.update(highSm.update(bandSum(freqData, highLo, highHi), dtMs));

  // Centroid
  let weightedSum = 0, totalPower = 0;
  for (let i = 0; i < binCount; i++) {
    const mag = freqData[i] / 255;
    weightedSum += mag * i;
    totalPower += mag;
  }
  features.centroid = centroidSm.update(
    totalPower > 0 ? weightedSum / (totalPower * binCount) : 0,
    dtMs
  );

  // Onset: RMS rate-of-change only
  const rmsChange = Math.max(0, smoothRms - prevRms);
  prevRms = smoothRms;
  features.onsetFired = rmsChange > 0.003;
  features.onsetEnergy = onsetSm.update(features.onsetFired ? rmsChange * 10 : 0, dtMs);

  return features;
}

export function getFeatures() {
  return features;
}

export function resetFeatures() {
  prevRms = 0;
}
