// GLSL shader visual library — Phase 4.
// Every fragment shader is a self-contained GLSL ES 1.00 (WebGL1) string:
// `precision mediump float`, the full uniform block, shared hash/noise/fbm
// helpers, and a void main(). They render a fullscreen quad from
// gl_FragCoord, so no varyings or attributes are needed in the fragment.
// The engine does NOT consume these yet — Phase 5 wires SHADER_VISUALS
// into src/lib/engine/sources.ts (see report). VisualLibrary renders them
// live via the ShaderPreview class below.

export interface ShaderParams {
  speed: number;
  scale: number;
  intensity: number;
  density: number;
  rotation: number;
  distortion: number;
  color1: string;
  color2: string;
}

export type ShaderCategory =
  | 'Gradient'
  | 'Neon'
  | 'Generative'
  | 'Tunnel'
  | 'VJ'
  | 'Fractal'
  | 'Audio';

export interface ShaderVisual {
  id: string;
  name: string;
  category: ShaderCategory;
  fragment: string;
  defaults: ShaderParams;
}

export const SHADER_UNIFORMS = [
  'u_time',
  'u_res',
  'u_audio',
  'u_color1',
  'u_color2',
  'u_speed',
  'u_scale',
  'u_intensity',
  'u_density',
  'u_rotation',
  'u_distortion',
] as const;

const PREFIX = `precision mediump float;
uniform float u_time;
uniform vec2 u_res;
uniform float u_audio;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform float u_speed;
uniform float u_scale;
uniform float u_intensity;
uniform float u_density;
uniform float u_rotation;
uniform float u_distortion;
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i); float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)); float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
vec2 rot2(vec2 p, float a){ float c = cos(a); float s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
vec3 palette(float t){ return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
`;

function S(
  id: string,
  name: string,
  category: ShaderCategory,
  defaults: Partial<ShaderParams>,
  body: string,
): ShaderVisual {
  return {
    id,
    name,
    category,
    fragment: PREFIX + body,
    defaults: {
      speed: 1,
      scale: 1,
      intensity: 1,
      density: 1,
      rotation: 0,
      distortion: 0,
      color1: '#f59e0b',
      color2: '#06b6d4',
      ...defaults,
    },
  };
}

export const SHADER_VISUALS: ShaderVisual[] = [
  S('shader-gradient', 'Animated Gradient', 'Gradient',
    { color1: '#7c3aed', color2: '#06b6d4' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float t = u_time * 0.25 * u_speed;
  float w = sin(uv.x * 3.0 * u_scale + t) * 0.5 + sin(uv.y * 4.0 * u_scale - t * 1.3) * 0.5;
  w += u_distortion * sin((uv.x + uv.y) * 8.0 + t * 2.0) * 0.5;
  vec3 col = mix(u_color1, u_color2, clamp(0.5 + w * 0.6 * u_intensity, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-neon-waves', 'Neon Waves', 'Neon',
    { color1: '#22d3ee', color2: '#f472b6' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float y = sin(uv.x * (3.0 + fi) * u_scale + u_time * u_speed * (1.0 + fi * 0.4) + fi * 1.7) * 0.12;
    y += u_distortion * sin(uv.x * 9.0 + u_time * 2.0) * 0.05;
    float d = abs(uv.y - y * (1.0 + u_audio * 0.6) + (fi - 1.5) * 0.14);
    float line = 0.008 / (d + 0.008);
    vec3 c = mix(u_color1, u_color2, fi / 3.0);
    col += c * line * 0.35 * u_intensity;
  }
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-plasma', 'Plasma', 'Generative',
    { color1: '#a855f7', color2: '#22d3ee' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float t = u_time * u_speed;
  vec2 p = uv * 3.0 * u_scale;
  float v = sin(p.x + t) + sin(p.y - t * 1.3) + sin((p.x + p.y) * 0.8 + t * 0.7);
  v += u_distortion * sin(length(p) * 4.0 - t * 2.0);
  v += u_audio * sin(p.x * 5.0 + t * 3.0);
  vec3 col = mix(u_color1, u_color2, 0.5 + 0.5 * sin(v * 1.4));
  col = mix(col, palette(v * 0.12 + t * 0.05), 0.35 * u_intensity);
  gl_FragColor = vec4(col * (0.75 + 0.25 * u_intensity), 1.0);
}`),
  S('shader-fluid', 'Fluid Warp', 'Generative',
    { color1: '#10b981', color2: '#0ea5e9' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float t = u_time * 0.3 * u_speed;
  vec2 p = uv * 2.5 * u_scale;
  vec2 q = vec2(fbm(p + vec2(t, 0.0)), fbm(p + vec2(5.2, 1.3 - t)));
  vec2 r = vec2(fbm(p + 2.0 * q + vec2(1.7, 9.2) + 0.15 * t), fbm(p + 2.0 * q + vec2(8.3, 2.8) - 0.12 * t));
  float f = fbm(p + (2.0 + u_distortion * 3.0) * r);
  vec3 col = mix(u_color1, u_color2, clamp(f * 1.4, 0.0, 1.0));
  col = mix(col, vec3(f), 0.25);
  col *= 0.7 + 0.6 * u_intensity * f + u_audio * 0.3;
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-particles', 'Particle Field', 'Generative',
    { color1: '#f8fafc', color2: '#38bdf8', density: 1 },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  vec2 gv = uv * (4.0 + 4.0 * u_density) * u_scale;
  vec2 id = floor(gv);
  vec2 f = fract(gv);
  float rnd = hash21(id);
  vec2 off = vec2(hash21(id + 1.0), hash21(id + 2.0));
  off = 0.5 + 0.4 * sin(u_time * u_speed * (0.5 + rnd) + off * 6.28318);
  float d = length(f - off);
  float tw = 0.6 + 0.4 * sin(u_time * 3.0 * u_speed + rnd * 40.0);
  float pt = smoothstep(0.12, 0.0, d) * tw;
  vec3 col = mix(u_color2, u_color1, rnd) * pt * u_intensity;
  col += u_audio * vec3(0.3, 0.1, 0.0) * pt;
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-tunnel', 'Tunnel', 'Tunnel',
    { color1: '#e879f9', color2: '#22d3ee' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float r = length(uv) * 2.0;
  float a = atan(uv.y, uv.x);
  float t = u_time * u_speed;
  float rings = sin((r * 10.0 - t * 2.0) * u_scale);
  float rays = sin(a * 8.0 + t);
  float depth = 1.0 / (0.2 + r * r);
  float v = rings * 0.5 + rays * 0.5;
  v += u_distortion * sin(a * 3.0 + r * 12.0 - t * 3.0) * 0.5;
  vec3 col = mix(u_color1, u_color2, 0.5 + 0.5 * v);
  col *= (0.35 + 0.65 * smoothstep(1.4, 0.0, r)) * depth * 0.45 * u_intensity;
  col += u_audio * u_color2 * 0.25 * smoothstep(1.0, 0.0, r);
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-geometric', 'Geometric Patterns', 'Generative',
    { color1: '#f59e0b', color2: '#8b5cf6' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  vec2 g = uv * (3.0 + 3.0 * u_density) * u_scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float rnd = hash21(id);
  float t = u_time * u_speed;
  float shape = 0.0;
  if (rnd < 0.33) {
    shape = smoothstep(0.32, 0.3, length(f));
  } else if (rnd < 0.66) {
    shape = smoothstep(0.32, 0.3, max(abs(f.x), abs(f.y)));
  } else {
    float a = atan(f.y, f.x) + t * (rnd - 0.5);
    shape = smoothstep(0.3, 0.28, length(f) * (1.0 + 0.25 * sin(a * 3.0)));
  }
  float pulse = 0.6 + 0.4 * sin(t * 2.0 + rnd * 20.0 + u_audio * 4.0);
  vec3 col = mix(u_color1, u_color2, rnd) * shape * pulse * u_intensity;
  col += u_distortion * vec3(0.1) * shape;
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-kaleidoscope', 'Kaleidoscope', 'VJ',
    { color1: '#f472b6', color2: '#22d3ee' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float segs = 6.0 + 6.0 * fract(u_density * 0.5);
  float a = atan(uv.y, uv.x);
  float r = length(uv);
  a = mod(a, 6.28318 / segs);
  a = abs(a - 3.14159 / segs);
  vec2 p = vec2(cos(a), sin(a)) * r;
  float t = u_time * u_speed;
  float v = fbm(p * 3.0 * u_scale + vec2(t * 0.2, -t * 0.15));
  v += u_distortion * 0.4 * sin(p.x * 14.0 + t * 2.0);
  vec3 col = mix(u_color1, u_color2, clamp(v * 1.5, 0.0, 1.0));
  col *= 0.6 + 0.8 * u_intensity * v + u_audio * 0.3;
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-fractal', 'Julia Fractal', 'Fractal',
    { color1: '#facc15', color2: '#7c3aed' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float zoom = 1.2 + u_scale * 0.8 + u_audio * 0.4;
  vec2 z = uv * zoom;
  vec2 c = vec2(-0.7 + 0.25 * cos(u_time * 0.2 * u_speed), 0.27 + 0.25 * sin(u_time * 0.23 * u_speed));
  float it = 0.0;
  for (int i = 0; i < 64; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 4.0) break;
    it += 1.0;
  }
  float v = it / 64.0;
  vec3 col = mix(u_color1, u_color2, v);
  col = mix(col, palette(v * 2.0 + u_time * 0.02), 0.4 * u_intensity);
  col *= 0.4 + 0.6 * step(0.01, v);
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-wave-distortion', 'Wave Distortion', 'VJ',
    { color1: '#06b6d4', color2: '#f97316', distortion: 0.5 },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float t = u_time * u_speed;
  float amt = 0.08 + u_distortion * 0.25;
  uv.x += sin(uv.y * 10.0 * u_scale + t * 2.0) * amt;
  uv.y += cos(uv.x * 8.0 * u_scale - t * 1.6) * amt;
  float bands = sin((uv.x + uv.y) * 12.0 * u_scale + t);
  float v = 0.5 + 0.5 * bands;
  vec3 col = mix(u_color1, u_color2, v);
  col *= 0.7 + 0.5 * u_intensity * v + u_audio * 0.25;
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-glowing-shapes', 'Glowing Shapes', 'Neon',
    { color1: '#a78bfa', color2: '#34d399' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float t = u_time * u_speed;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(t * 0.7 + fi * 1.9) * 0.35, cos(t * 0.55 + fi * 2.6) * 0.3);
    float r = 0.14 + 0.06 * sin(t + fi * 3.0) + u_audio * 0.05;
    float d = length(uv - c);
    float glow = 0.02 / (d * d + 0.004);
    vec3 cc = mix(u_color1, u_color2, fi / 3.0);
    col += cc * glow * 0.06 * u_intensity * smoothstep(r * 2.2, r * 0.4, d);
    col += cc * smoothstep(r, r * 0.7, d) * 0.5;
  }
  col += u_distortion * fbm(uv * 4.0 + t * 0.1) * 0.2;
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-energy-field', 'Energy Field', 'Generative',
    { color1: '#38bdf8', color2: '#f43f5e' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float t = u_time * u_speed;
  vec2 p = uv * 2.0 * u_scale;
  float n = fbm(p * 2.0 + vec2(t * 0.4, -t * 0.3));
  float r = length(uv);
  float pulse = 0.5 + 0.5 * sin(t * 2.0 - r * 9.0 + n * 6.0);
  float core = smoothstep(0.55, 0.0, r) * (0.5 + u_audio);
  vec3 col = mix(u_color1, u_color2, n);
  col *= (0.25 + 0.9 * pulse * u_intensity);
  col += u_color2 * core * 0.8;
  col += u_distortion * vec3(n * 0.2);
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-vj-rings', 'VJ Pulsing Rings', 'VJ',
    { color1: '#f472b6', color2: '#22d3ee' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float r = length(uv);
  float t = u_time * u_speed;
  float beat = 1.0 + u_audio * 1.5;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float rr = fract(t * 0.25 * beat + fi / 6.0);
    float ring = smoothstep(0.06, 0.0, abs(r - rr * 0.75));
    float fade = 1.0 - rr;
    vec3 c = mix(u_color1, u_color2, fi / 5.0);
    col += c * ring * fade * 0.5 * u_intensity;
  }
  float a = atan(uv.y, uv.x);
  col += u_color1 * 0.12 * sin(a * 6.0 + t * 3.0) * smoothstep(0.7, 0.0, r);
  col += u_distortion * fbm(uv * 5.0) * 0.15;
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-color-cycle', 'Color Cycling', 'Gradient',
    { color1: '#f59e0b', color2: '#06b6d4' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float t = u_time * u_speed;
  float v = fbm(uv * 2.5 * u_scale + vec2(t * 0.15, -t * 0.1));
  float hue = fract(v + t * 0.05 + u_audio * 0.1);
  vec3 col = palette(hue);
  col = mix(col, mix(u_color1, u_color2, v), 0.45);
  col *= 0.7 + 0.5 * u_intensity * v;
  col += u_distortion * 0.1 * sin(uv.x * 20.0 + t * 4.0);
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-audio-particles', 'Audio Particles', 'Audio',
    { color1: '#fde047', color2: '#a855f7', density: 1 },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float dens = 3.0 + 5.0 * u_density + u_audio * 6.0;
  vec2 gv = uv * dens * u_scale;
  vec2 id = floor(gv);
  vec2 f = fract(gv);
  float rnd = hash21(id);
  vec2 off = 0.5 + 0.35 * sin(u_time * u_speed * (1.0 + rnd * 2.0) + rnd * 40.0);
  float size = 0.06 + 0.16 * u_audio + 0.05 * sin(u_time * 4.0 + rnd * 20.0);
  float d = length(f - off);
  float pt = smoothstep(size, size * 0.3, d);
  float gate = step(rnd, 0.35 + 0.6 * u_audio);
  vec3 col = mix(u_color2, u_color1, rnd) * pt * gate * u_intensity * 1.4;
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-animated-noise', 'Animated Noise', 'Generative',
    { color1: '#94a3b8', color2: '#1e293b' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float t = u_time * u_speed;
  float n = fbm(uv * 3.0 * u_scale + vec2(t * 0.35, t * 0.22));
  float n2 = fbm(uv * 6.0 * u_scale - vec2(t * 0.2, t * 0.3));
  float v = n * 0.7 + n2 * 0.3;
  v += u_distortion * 0.3 * sin(uv.x * 18.0 + t * 2.0);
  vec3 col = mix(u_color2, u_color1, clamp(v * 1.3, 0.0, 1.0));
  col *= 0.6 + 0.7 * u_intensity * v + u_audio * 0.2;
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-light-trails', 'Light Trails', 'Neon',
    { color1: '#22d3ee', color2: '#e879f9' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float t = u_time * u_speed;
  vec2 p = vec2(uv.x * 2.0, uv.y * 10.0 * u_scale);
  float n = fbm(p + vec2(t * 0.6, 0.0));
  float trail = smoothstep(0.55, 0.9, n);
  float streak = smoothstep(0.4, 0.0, abs(uv.y - sin(uv.x * 3.0 + t) * 0.25));
  vec3 col = mix(u_color1, u_color2, n) * trail * (0.5 + streak);
  col *= u_intensity * (1.0 + u_audio);
  col += u_distortion * vec3(0.08) * trail;
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-spiral', 'Spiral', 'Tunnel',
    { color1: '#fb923c', color2: '#7c3aed' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = u_time * u_speed;
  float arms = 3.0 + floor(u_density * 3.0);
  float s = sin(a * arms + r * 14.0 * u_scale - t * 2.5);
  s += u_distortion * sin(a * 2.0 + r * 20.0);
  float v = smoothstep(0.0, 0.4, s) * smoothstep(1.1, 0.15, r);
  vec3 col = mix(u_color1, u_color2, 0.5 + 0.5 * sin(r * 10.0 - t));
  col *= v * u_intensity * (1.0 + u_audio * 0.5);
  gl_FragColor = vec4(col, 1.0);
}`),
  S('shader-grid-pulse', 'Grid Pulse', 'VJ',
    { color1: '#22d3ee', color2: '#f43f5e' },
    `void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = rot2(uv, u_rotation);
  vec2 g = uv * (5.0 + 4.0 * u_density) * u_scale;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float rnd = hash21(id);
  float d = length(uv);
  float wave = sin(d * 14.0 - u_time * 3.0 * u_speed) * 0.5 + 0.5;
  float on = step(0.45, fract(rnd + wave * 0.6 + u_audio * 0.4));
  float cell = smoothstep(0.5, 0.48, max(abs(f.x - 0.5), abs(f.y - 0.5)));
  vec3 col = mix(u_color1, u_color2, rnd) * cell * on * u_intensity;
  col += u_distortion * 0.1 * cell;
  gl_FragColor = vec4(col, 1.0);
}`),
];

export function getShaderVisual(id: string): ShaderVisual | undefined {
  return SHADER_VISUALS.find((v) => v.id === id);
}

export const SHADER_CATEGORIES: ShaderCategory[] = [
  'Gradient',
  'Neon',
  'Generative',
  'Tunnel',
  'VJ',
  'Fractal',
  'Audio',
];

/** Hex (#rgb / #rrggbb) -> [r, g, b] 0..1. Falls back to white on bad input. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [1, 1, 1];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Static validation (no GPU): the fragment must define main() and every uniform. */
export function validateShaderSource(fragment: string): string | null {
  if (!fragment.includes('void main')) return 'Shader is missing void main()';
  for (const u of SHADER_UNIFORMS) {
    if (!fragment.includes(u)) return `Shader is missing uniform ${u}`;
  }
  return null;
}

export type CompileResult =
  | { program: WebGLProgram; error: null }
  | { program: null; error: string };

const VERTEX_SRC = `attribute vec2 a_position;
void main(){ gl_Position = vec4(a_position, 0.0, 1.0); }`;

/** Compile + link a fullscreen-quad program for a fragment shader. */
export function compileShader(gl: WebGLRenderingContext, fragment: string): CompileResult {
  const compile = (type: number, src: string): WebGLShader | string => {
    const sh = gl.createShader(type);
    if (!sh) return 'Could not create shader object';
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) ?? 'unknown compile error';
      gl.deleteShader(sh);
      return log;
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC);
  if (typeof vs === 'string') return { program: null, error: `Vertex shader failed: ${vs}` };
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  if (typeof fs === 'string') {
    gl.deleteShader(vs);
    return { program: null, error: `Fragment shader failed: ${fs}` };
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { program: null, error: 'Could not create program object' };
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
    gl.deleteProgram(program);
    return { program: null, error: `Link failed: ${log}` };
  }
  return { program, error: null };
}

/**
 * Live WebGL preview renderer for one canvas. Owns its context, program and
 * fullscreen-quad buffer; call setShader() then render(timeSeconds) each frame.
 * Falls back gracefully: if WebGL is unavailable, `error` is set and render()
 * is a no-op — callers should show the error instead of a blank canvas.
 */
export class ShaderPreview {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private buffer: WebGLBuffer | null = null;
  error: string | null = null;
  shaderId: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: false }) ??
      canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    if (!gl) {
      this.error = 'WebGL is not available in this browser';
      return;
    }
    this.gl = gl;
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }

  setShader(visual: ShaderVisual): boolean {
    const gl = this.gl;
    if (!gl) return false;
    const result = compileShader(gl, visual.fragment);
    if (result.error) {
      this.error = result.error;
      return false;
    }
    if (this.program) gl.deleteProgram(this.program);
    this.program = result.program;
    this.shaderId = visual.id;
    this.error = null;
    this.uniforms = {};
    for (const name of SHADER_UNIFORMS) {
      this.uniforms[name] = this.program ? gl.getUniformLocation(this.program, name) : null;
    }
    return true;
  }

  render(timeSeconds: number, params: ShaderParams, audioLevel = 0): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.buffer) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (gl.canvas.width !== w || gl.canvas.height !== h) {
      // Canvas backing size is set by the caller; keep the viewport in sync.
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    const loc = (name: string) => this.uniforms[name] ?? null;
    gl.uniform1f(loc('u_time'), timeSeconds);
    gl.uniform2f(loc('u_res'), w, h);
    gl.uniform1f(loc('u_audio'), audioLevel);
    const [r1, g1, b1] = hexToRgb(params.color1);
    const [r2, g2, b2] = hexToRgb(params.color2);
    gl.uniform3f(loc('u_color1'), r1, g1, b1);
    gl.uniform3f(loc('u_color2'), r2, g2, b2);
    gl.uniform1f(loc('u_speed'), params.speed);
    gl.uniform1f(loc('u_scale'), params.scale);
    gl.uniform1f(loc('u_intensity'), params.intensity);
    gl.uniform1f(loc('u_density'), params.density);
    gl.uniform1f(loc('u_rotation'), params.rotation);
    gl.uniform1f(loc('u_distortion'), params.distortion);
    const pos = gl.getAttribLocation(this.program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.buffer) gl.deleteBuffer(this.buffer);
    }
    this.program = null;
    this.buffer = null;
    this.gl = null;
  }
}

export interface VisualPreset {
  id: string;
  name: string;
  shaderId: string;
  params: ShaderParams;
}

export const VISUAL_PRESETS: VisualPreset[] = [
  {
    id: 'midnight-tunnel', name: 'Midnight Tunnel', shaderId: 'shader-tunnel',
    params: { speed: 0.8, scale: 1.2, intensity: 1.2, density: 1, rotation: 0, distortion: 0.2, color1: '#312e81', color2: '#22d3ee' },
  },
  {
    id: 'acid-plasma', name: 'Acid Plasma', shaderId: 'shader-plasma',
    params: { speed: 1.4, scale: 1.1, intensity: 1.3, density: 1, rotation: 0, distortion: 0.4, color1: '#a3e635', color2: '#d946ef' },
  },
  {
    id: 'neon-rain', name: 'Neon Rain', shaderId: 'shader-neon-waves',
    params: { speed: 1.6, scale: 1.3, intensity: 1.1, density: 1, rotation: 0, distortion: 0.5, color1: '#22d3ee', color2: '#f472b6' },
  },
  {
    id: 'ember-fluid', name: 'Ember Fluid', shaderId: 'shader-fluid',
    params: { speed: 0.7, scale: 1, intensity: 1.1, density: 1, rotation: 0, distortion: 0.6, color1: '#f97316', color2: '#7c2d12' },
  },
  {
    id: 'deep-kaleidoscope', name: 'Deep Kaleidoscope', shaderId: 'shader-kaleidoscope',
    params: { speed: 0.6, scale: 1.4, intensity: 1, density: 1.5, rotation: 0.4, distortion: 0.3, color1: '#8b5cf6', color2: '#06b6d4' },
  },
  {
    id: 'solar-fractal', name: 'Solar Fractal', shaderId: 'shader-fractal',
    params: { speed: 0.5, scale: 1.2, intensity: 1.2, density: 1, rotation: 0, distortion: 0, color1: '#facc15', color2: '#7c3aed' },
  },
  {
    id: 'bass-particles', name: 'Bass Particles', shaderId: 'shader-audio-particles',
    params: { speed: 1.2, scale: 1, intensity: 1.4, density: 1.4, rotation: 0, distortion: 0, color1: '#fde047', color2: '#a855f7' },
  },
  {
    id: 'violet-spiral', name: 'Violet Spiral', shaderId: 'shader-spiral',
    params: { speed: 1, scale: 1.1, intensity: 1.2, density: 1.2, rotation: 0.6, distortion: 0.2, color1: '#fb923c', color2: '#7c3aed' },
  },
  {
    id: 'grid-rave', name: 'Grid Rave', shaderId: 'shader-grid-pulse',
    params: { speed: 1.5, scale: 1, intensity: 1.2, density: 1.6, rotation: 0, distortion: 0.1, color1: '#22d3ee', color2: '#f43f5e' },
  },
];
