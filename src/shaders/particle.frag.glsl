varying float vOpacity;
varying float vGlow;

void main() {
  // Soft circular falloff — no hard pixel edges
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord) * 2.0;
  float alpha = 1.0 - smoothstep(0.3, 1.0, dist);

  // Off-white color — CR #ebebeb, never tinted
  vec3 color = vec3(0.922, 0.922, 0.922);

  // Subtle glow: center slightly brighter
  float glow = (1.0 - smoothstep(0.0, 0.6, dist)) * vGlow * 0.4;
  color += glow;
  color = clamp(color, 0.0, 1.0);

  float finalAlpha = alpha * vOpacity;

  if (finalAlpha < 0.002) discard;

  gl_FragColor = vec4(color, finalAlpha);
}
