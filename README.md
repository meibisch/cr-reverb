# Reverb — Chasing Reverbs Visual Companion

Audio-reactive cinematic particle field. One song, one mode, one HTML file.

## Setup

```bash
npm install
```

Drop a Chasing Reverbs track into `public/audio/test-song.mp3`.
Recommended: *Lost in Low Light* (title track) or *Spotting Clouds*.

```bash
npm run dev
```

Open `http://localhost:5173` — press Play or Space.

## Controls

- **Space** — play / pause
- **Click play button** — play / pause (UI fades after starting)

## Architecture

```
src/
  main.js              — scene, render loop, UI
  audio/
    audioEngine.js     — AudioContext, load, play/pause
    features.js        — RMS, bands, onset, centroid, sustain
  visuals/
    particleField.js   — Three.js Points + ShaderMaterial
  shaders/
    particle.vert.glsl — position, drift, burst, point size
    particle.frag.glsl — circular falloff, glow, off-white color
MAPPING.md             — audio-to-visual mapping specification
```

## Tuning

See `MAPPING.md` for the full mapping spec and open questions.
The onset threshold (`ONSET_THRESHOLD` in `features.js`) is the most
likely parameter to need tuning per-track.
