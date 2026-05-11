uniform float uLoudness;
uniform float uHighBand;
uniform float uCentroid;
uniform float uOnsetEnergy;

attribute float aSize;

varying float vOpacity;
varying float vHighBand;

void main() {
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPos;

  float shimmer    = uHighBand * 0.7 + uCentroid * 0.3;
  float burstBoost = uOnsetEnergy * 0.5;

  float sz = aSize * (4.0 + shimmer * 1.8 + burstBoost * 0.4);
  gl_PointSize = sz * (200.0 / -mvPos.z);
  gl_PointSize = clamp(gl_PointSize, 2.0, 22.0);

  vOpacity  = 0.04 + uLoudness * 0.5 + shimmer * 0.35 + burstBoost * 0.1;
  vOpacity  = clamp(vOpacity, 0.0, 1.0);
  vHighBand = shimmer;
}
