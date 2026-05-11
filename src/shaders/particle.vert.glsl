uniform float uLoudness;
uniform float uHighBand;
uniform float uCentroid;
uniform float uOnsetEnergy;

attribute float aSize;

varying float vOpacity;
varying float vGlow;

void main() {
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPos;

  float shimmer    = uHighBand * 0.6 + uCentroid * 0.4;
  float burstBoost = uOnsetEnergy * 0.8;

  float sz = aSize * (1.2 + shimmer * 2.0 + burstBoost * 0.5);
  gl_PointSize = sz * (200.0 / -mvPos.z);
  gl_PointSize = clamp(gl_PointSize, 0.5, 8.0);

  vOpacity = 0.05 + uLoudness * 0.55 + shimmer * 0.3 + burstBoost * 0.1;
  vOpacity = clamp(vOpacity, 0.0, 1.0);

  vGlow = shimmer + burstBoost * 0.3;
}
