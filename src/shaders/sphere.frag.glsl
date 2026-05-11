uniform vec3  uColorWhite;
uniform vec3  uColorBlue;
uniform float uColorMix;
uniform float uBoundaryFade;

varying float vOpacity;
varying float vGlow;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord) * 2.0;
  float alpha = 1.0 - smoothstep(0.3, 1.0, dist);

  vec3 color = mix(uColorWhite, uColorBlue, uColorMix);

  float glow = (1.0 - smoothstep(0.0, 0.6, dist)) * vGlow * 0.4;
  color = clamp(color + glow, 0.0, 1.0);

  float finalAlpha = alpha * vOpacity * uBoundaryFade;
  if (finalAlpha < 0.002) discard;

  gl_FragColor = vec4(color, finalAlpha);
}
