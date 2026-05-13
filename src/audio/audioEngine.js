// HTMLAudioElement + createMediaElementSource pipeline
// Works reliably on iOS Safari where fetch+decodeAudioData silently fails for MP3s

const AudioCtx = window.AudioContext || window.webkitAudioContext;

let ctx         = null;
let analyser    = null;
let gainNode    = null;
let audioEl     = null;  // HTMLAudioElement — replaced per song
let mediaSource = null;  // MediaElementSourceNode — replaced per song
let isPlaying   = false;

function ensureContext() {
  if (ctx) return;
  ctx      = new AudioCtx();
  analyser = ctx.createAnalyser();
  analyser.fftSize               = 2048;
  analyser.smoothingTimeConstant = 0.6;
  gainNode = ctx.createGain();
  gainNode.gain.value = 1.0;
  analyser.connect(gainNode);
  gainNode.connect(ctx.destination);
}

export function unload() {
  try { if (audioEl) { audioEl.pause(); audioEl.src = ''; } } catch (_) {}
  try { if (mediaSource) mediaSource.disconnect(); } catch (_) {}
  audioEl     = null;
  mediaSource = null;
  isPlaying   = false;
}

export async function loadAudio(url) {
  ensureContext();
  unload();

  const audio   = new Audio(url);
  audio.preload = 'auto';
  audio.onended = () => { isPlaying = false; };

  const src = ctx.createMediaElementSource(audio);
  src.connect(analyser);

  audioEl     = audio;
  mediaSource = src;
}

export async function start() {
  if (!audioEl || isPlaying) return;
  if (ctx.state === 'suspended') await ctx.resume();
  await audioEl.play();
  isPlaying = true;
}

export function pause() {
  if (!audioEl || !isPlaying) return;
  audioEl.pause();
  isPlaying = false;
}

export function stop() {
  if (!audioEl) return;
  audioEl.pause();
  audioEl.currentTime = 0;
  isPlaying = false;
}

export async function toggle() {
  if (isPlaying) pause();
  else await start();
  return isPlaying;
}

export function getIsPlaying()     { return isPlaying; }
export function getSampleRate()    { return ctx ? ctx.sampleRate : 44100; }
export function getFFTSize()       { return analyser ? analyser.fftSize : 2048; }

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
