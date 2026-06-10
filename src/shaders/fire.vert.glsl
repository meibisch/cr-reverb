uniform float uLoudness;
uniform float uHighBand;
uniform float uLowBand;
uniform float uOnsetEnergy;
uniform float uFanLean;

attribute float aSize;
attribute float aAge;
attribute float aIsEmber;

varying float vAge;
varying float vIsEmber;
varying float vGlow;

void main() {
  vec3 p = position;

  // Wind shear: quadratic bend with height — tips lean hard, base stays rooted.
  // Embers sit low and heavy; they barely move.
  float heightFrac = clamp((p.y - (-1.6)) / 3.0, 0.0, 1.2);
  float leanAmt    = aIsEmber > 0.5 ? 0.25 : 1.0;
  p.x += uFanLean * heightFrac * heightFrac * leanAmt;

  vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPos;

  float shimmer  = uHighBand * 0.5 + uOnsetEnergy * 0.5;
  vGlow    = shimmer;
  vAge     = aAge;
  vIsEmber = aIsEmber;

  float sz;
  if (aIsEmber > 0.5) {
    sz = aSize * 0.20 * (1.0 + shimmer * 0.4 + uLowBand * 0.3);
  } else {
    sz = aSize * mix(0.22, 0.08, aAge) * (1.0 + shimmer * 0.6);
  }
  gl_PointSize = sz * (200.0 / -mvPos.z);
  gl_PointSize = clamp(gl_PointSize, 0.5, 10.0);
}
