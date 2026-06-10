uniform vec3  uColorEmber;
uniform vec3  uColorFlame;
uniform vec3  uColorTip;
uniform float uTime;
uniform float uEnergyColorShift;
uniform float uLowBand;
uniform float uAliveFrac;

varying float vAge;
varying float vIsEmber;
varying float vGlow;

void main() {
  vec2  coord = gl_PointCoord - vec2(0.5);
  float dist  = length(coord) * 2.0;

  float alpha;
  vec3  color;

  // Shift colour ramp toward hotter (younger) appearance on energy peaks
  float adjustedAge = clamp(vAge - uEnergyColorShift * 0.25, 0.0, 1.0);

  if (vIsEmber > 0.5) {
    alpha = (1.0 - smoothstep(0.4, 1.0, dist)) * (1.0 - smoothstep(0.6, 1.0, adjustedAge));
    // ember bed breathes with the bass
    float pulse = 0.65 + (0.20 + 0.25 * uLowBand) * sin(uTime * 3.0 + vAge * 12.0);
    color = uColorEmber * pulse * (0.85 + uLowBand * 0.45);
  } else {
    alpha = (1.0 - smoothstep(0.2, 1.0, dist)) * (1.0 - smoothstep(0.0, 1.0, adjustedAge));
    // compensate additive stacking: dense column → dimmer individual flames
    alpha *= (1.15 - 0.55 * uAliveFrac);
    color = adjustedAge < 0.35
      ? mix(uColorEmber, uColorFlame, adjustedAge / 0.35)
      : mix(uColorFlame, uColorTip,  (adjustedAge - 0.35) / 0.65);
  }

  // Overall brightness shifts with energy
  color *= (0.85 + uEnergyColorShift * 0.30);
  color  = clamp(color + vGlow * 0.25, 0.0, 1.0);

  if (alpha < 0.005) discard;
  gl_FragColor = vec4(color, alpha);
}
