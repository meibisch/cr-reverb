# Reverb — Audio-to-Visual Mapping Specification

> Chasing Reverbs Visual Companion · Phase 1 Concept Document

---

## 1. Audio Features

All features are extracted each animation frame from the Web Audio API `AnalyserNode`
(fftSize: 2048, native smoothingTimeConstant: 0.6). An additional one-pole smoothing
layer is applied in `features.js` before values reach the visual layer.

One-pole formula: `smoothed = smoothed * (1 − α) + raw * α`

Alpha is derived from the time constant τ and the frame interval Δt:
`α = 1 − exp(−Δt / τ)` — so time constants are frame-rate independent.

| Feature | Description | Smoothing τ (attack) | Smoothing τ (release) | Notes |
|---|---|---|---|---|
| **Loudness (RMS)** | Energy of full-range signal | 500 ms | 2000 ms | Clamped 0–1 |
| **Low band (20–250 Hz)** | Bass body, weight | 200 ms | 800 ms | Bin indices computed from sample rate |
| **Mid band (250–4000 Hz)** | Guitar/piano body | 300 ms | 600 ms | Bin indices computed from sample rate |
| **High band (4000–16000 Hz)** | Air, shimmer, reverb tail | 150 ms | 1200 ms | Long release = reverb-tail feel |
| **Spectral Centroid** | "Brightness" — weighted mean of frequency bins | 400 ms | 800 ms | Normalized 0–1 over 0–Nyquist |
| **Onset energy** | Transient attack strength | 50 ms (attack) | 3000 ms (decay) | Spectral flux (positive Σ only), thresholded |
| **Sustain envelope** | Time-since-last-onset, decaying | — | 4000 ms | Starts at 1.0 on each onset, decays exponentially |

**Why long release times:** A 2-second loudness release means a reverb tail continues
to illuminate the particle field after the note is played — which matches the listening
experience. Short releases would produce the "VU meter" effect: technically accurate,
cinematically wrong.

---

## 2. Prototype Visual Mode — Particle Field

**Chosen for Phase 2.** A field of 50 000 slow-drifting particles rendered via Three.js
`Points` with a custom `ShaderMaterial`. All visual parameters driven by audio uniforms.

### 2.1 Mapping Rules

| Audio input | Visual response | Detail |
|---|---|---|
| **Loudness (RMS)** | Particle opacity/density | Slow attack (500 ms), slow release (2 s). Quiet = near-invisible field. Loud = dense, present field. |
| **Low band** | Vertical drift speed | ±20% around base speed. More bass = particles drift downward with more weight. |
| **High band + Spectral Centroid** | Particle brightness & glow | "Shimmer" channel. High-band drives point size, centroid drives brightness. Long release = reverb tail stays glowing. |
| **Onset energy** | Soft outward radial burst from screen center | Decays over ~3 s. Reads like a breath, not an explosion. Never exceeds 5% of total screen brightness. |
| **Sustain envelope** | Trail length (motion-blur-like stretch) | Long sustain = particles leave longer trails (vertex shader stretches along velocity). |

### 2.2 Scene Setup

- Background: `#0d0d0d` (CR Deep Black) — never transparent, never lighter.
- Particles: `#ebebeb` (CR Off-White) — opacity only. No color variation, no tinting.
- Camera: `PerspectiveCamera`, FOV 50, looking toward origin from +Z.
- Particles distributed in a soft sphere, slightly biased forward (toward camera).
- Base drift: very slow random walk per particle (~0.0002 units/frame), never stationary.

### 2.3 What "cinematic" means operationally

- Any parameter change visible in under 100 ms is too fast. Aim for 300 ms–3 s response windows.
- Onset burst is a single breath: peak within 1 frame, decay over 3 s. Never repeats until it has decayed below 5%.
- When music is quiet: particles drift, nearly invisible. The screen breathes.
- When music is loud: particles coalesce into a luminous cloud. Never harsh, never white.

---

## 3. Future Visual Modes (Phase 3+)

### 3.1 Light Field / Volumetric Fog

Dense atmospheric fog rendered via layered transparent planes or a ray-march shader.
Best driven by **Loudness** (fog density breathes) and **Low band** (pockets of light
pulse with bass). Most technically complex mode — requires depth sorting or
order-independent transparency. Save for Phase 3 when the audio pipeline is proven.

### 3.2 Line Field

Sparse horizontal lines (long-exposure horizon aesthetic). **Onsets** create a new
faint line at a random vertical position. **Mid band** slowly shifts existing lines
horizontally. Lines decay in opacity over 5–10 seconds. Very minimal — works best
with solo guitar passages. Will need a line lifetime manager.

### 3.3 Particle Constellation

Sparse bright points slowly connecting and disconnecting with thin edges (like a
neural network or star map, but at 1/10th the density and speed). **Onsets** trigger
new connections. **Sustain** holds them visible. **Silence** causes gradual dissolution.
Requires a graph structure alongside the particle system.

### 3.4 Negative Space / Breath

Almost-black canvas, single soft radial gradient centered slightly off-screen.
**Loudness only** drives gradient radius and opacity. Extreme minimalism — appropriate
for ambient intros and outros. Almost indistinguishable from a black screen at first
glance, then slowly reveals itself. May be useful as a fallback/intro state.

---

## 4. Hard "No" Rules

- No screen flashes triggered by individual frames.
- No color shifts driven by audio. Color stays in the brand palette regardless.
- No camera shake, no zoom, no lens distortion synced to bass. This is post-rock, not Marvel.
- Onset reactions never exceed ~5% of total screen brightness. Subtlety wins.
- No audio-visualizer "bars", waveform displays, or spectrum analyzers.
- No rapid cuts, no strobe, no rainbow palettes.
- Visuals must never have their own pulse, animation cycle, or "default state of busyness"
  that runs without audio input. If audio is silent, visuals tend toward stillness.

---

## 5. Future Questions to Resolve in Testing

1. **Onset threshold tuning** — spectral flux will produce false positives on reverb tails
   (the tail looks like a new onset in frequency space). What threshold eliminates 95% of
   false positives without missing real plucks? Needs tuning on 3–4 different CR tracks.

2. **Particle count vs. frame rate** — 50 000 particles on M-series Mac is likely fine.
   What's the right count for Phase 3's mobile fallback target? Start at 8 000 and
   measure on an older iPhone before committing.

3. **Sustain trail rendering** — motion-blur via vertex shader stretching is fast but
   produces artifacts on very slow particles. Would a ping-pong framebuffer approach
   give a better cinematic look without killing frame rate?

4. **High band vs. Spectral Centroid overlap** — do both features add perceptible
   independent information, or do they track each other too closely on CR material?
   If centroid is redundant, simplify the mapping.

5. **Onset burst radius** — current spec says burst from screen center. Does it feel
   better anchored to the center, or should it follow a slowly drifting "focus point"
   (adding spatial memory)? Test with *Lost in Low Light* title track.
