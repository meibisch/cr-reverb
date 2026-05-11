let ctx = null;
let analyser = null;
let source = null;
let gainNode = null;
let audioBuffer = null;
let startOffset = 0;
let startTime = 0;
let isPlaying = false;

export async function initAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.6;
  gainNode = ctx.createGain();
  gainNode.gain.value = 1.0;
  gainNode.connect(analyser);
  analyser.connect(ctx.destination);
}

export async function loadAudio(url) {
  await initAudio();
  stop();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load audio: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  startOffset = 0;
}

export function start() {
  if (!audioBuffer || isPlaying) return;
  if (ctx.state === 'suspended') ctx.resume();
  source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(gainNode);
  source.start(0, startOffset);
  startTime = ctx.currentTime - startOffset;
  isPlaying = true;
  source.onended = () => {
    if (isPlaying) { isPlaying = false; startOffset = 0; }
  };
}

export function pause() {
  if (!isPlaying) return;
  startOffset = ctx.currentTime - startTime;
  source.stop();
  isPlaying = false;
}

export function stop() {
  if (!isPlaying) return;
  try { source.stop(); } catch (_) {}
  isPlaying = false;
  startOffset = 0;
}

export function toggle() {
  if (isPlaying) pause();
  else start();
  return isPlaying;
}

export function getIsPlaying() { return isPlaying; }

export function getFrequencyData() {
  if (!analyser) return new Uint8Array(0);
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  return data;
}

export function getTimeDomainData() {
  if (!analyser) return new Uint8Array(0);
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  return data;
}

export function getSampleRate() { return ctx ? ctx.sampleRate : 44100; }
export function getFFTSize() { return analyser ? analyser.fftSize : 2048; }
