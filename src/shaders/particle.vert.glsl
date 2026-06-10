uniform float uLoudness;
uniform float uHighBand;
uniform float uCentroid;
uniform float uOnsetEnergy;
uniform float uTime;
uniform float uFlash;
uniform float uScale;

attribute float aSize;

varying float vOpacity;
varying float vGlow;
varying float vDepth;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vec4 mvPos    = viewMatrix * worldPos;
  gl_Position   = projectionMatrix * mvPos;

  // 0 at the water surface, 1 in deep water (normalized to unscaled scene units)
  vDepth = clamp((1.9 - worldPos.y / uScale) / 4.4, 0.0, 1.0);

  float shimmer    = uHighBand * 0.6 + uCentroid * 0.4;
  float burstBoost = uOnsetEnergy * 0.8;

  // caustics — slow light interference from above, strongest near the surface
  float c1 = sin(worldPos.x * 1.8 + uTime * 0.35) * sin(worldPos.y * 2.3 - uTime * 0.28);
  float c2 = sin(worldPos.x * 3.6 - uTime * 0.22) * sin(worldPos.y * 1.3 + uTime * 0.41);
  float caustic = ((c1 + 0.6 * c2) / 1.6) * 0.5 + 0.5;
  float causticAmt = caustic * (1.0 - vDepth) * 0.22;

  float sz = aSize * (1.2 + shimmer * 2.0 + burstBoost * 0.5);
  gl_PointSize = sz * (200.0 / -mvPos.z);
  gl_PointSize = clamp(gl_PointSize, 0.5, 8.0);

  vOpacity = 0.05 + uLoudness * 0.55 + shimmer * 0.3 + burstBoost * 0.1;
  // pressure: deep water reads slightly denser, near-surface slightly sparser
  vOpacity *= mix(0.9, 1.08, vDepth);
  vOpacity = clamp(vOpacity, 0.0, 1.0);

  vGlow = shimmer + burstBoost * 0.3 + causticAmt + uFlash * 0.8;
}
