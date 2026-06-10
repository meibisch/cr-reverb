uniform float uLoudness;
uniform float uHighBand;
uniform float uCentroid;
uniform float uOnsetEnergy;
uniform vec2  uGapPos;
uniform float uGapR;

attribute float aSize;
attribute float aLayer;

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

  // depth layers: far clouds are fainter, near clouds carry the body
  float layerFade = mix(0.55, 1.15, aLayer * 0.5);

  // compressive response: lifts quiet passages into visibility, keeps loud
  // passages from burning to a solid sheet ("never harsh, never white")
  float lresp = sqrt(clamp(uLoudness, 0.0, 1.5) / 1.5);
  vOpacity  = (0.035 + lresp * 0.42 + shimmer * 0.25 + burstBoost * 0.08) * layerFade;

  // The Spot: clouds thin out to near-transparency inside the gap
  if (uGapR > 0.01) {
    float gd = distance(position.xy, uGapPos);
    vOpacity *= mix(0.07, 1.0, smoothstep(uGapR * 0.25, uGapR, gd));
  }

  vOpacity  = clamp(vOpacity, 0.0, 1.0);
  vHighBand = shimmer;
}
