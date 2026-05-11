varying float vOpacity;
varying float vHighBand;

void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  // Very soft gaussian falloff — wide haze rather than visible dots
  float alpha = smoothstep(0.5, 0.0, dist);
  alpha *= (0.018 + vHighBand * 0.35);

  vec3 color = vec3(0.922, 0.922, 0.922); // #ebebeb — always off-white

  float finalAlpha = alpha * vOpacity;
  if (finalAlpha < 0.001) discard;

  gl_FragColor = vec4(color, finalAlpha);
}
