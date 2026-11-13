// Depth mode — Phase 6.
// The depth map here is ESTIMATED from a photo's brightness (luminance +
// edges), NOT AI depth estimation. Every UI surface that shows one must
// carry the label below. A user may also import a real grayscale depth
// map, which is used instead of the estimate.
//
// Presets are plain Canvas 2D visuals that sample the depth map — no
// shader stage is needed, so they run through the same content canvas the
// engine already uploads as a texture.
'use client';

export const DEPTH_ESTIMATE_LABEL =
  'Estimated depth — computed from brightness, not AI depth estimation';

export type DepthPresetId =
  | 'depth-waves'
  | 'depth-displacement'
  | 'pulse'
  | 'neon-contours'
  | 'depth-particles'
  | 'animated-lighting'
  | 'depth-color';

export interface DepthPreset {
  id: DepthPresetId;
  label: string;
  blurb: string;
}

export const DEPTH_PRESETS: DepthPreset[] = [
  { id: 'depth-waves', label: 'Depth waves', blurb: 'Horizontal slices ripple with a phase set by depth — near slices move first.' },
  { id: 'depth-displacement', label: 'Depth displacement', blurb: 'Vertical slices shift sideways by depth, like a lenticular print.' },
  { id: 'pulse', label: 'Pulse', blurb: 'Rings expand from the focus point and wash over the photo.' },
  { id: 'neon-contours', label: 'Neon contours', blurb: 'Glowing iso-depth contour lines traced from the depth map.' },
  { id: 'depth-particles', label: 'Depth particles', blurb: 'Particles sampled from the depth map — near areas are denser and brighter.' },
  { id: 'animated-lighting', label: 'Animated lighting', blurb: 'A soft light sweeps across the photo, brighter where the depth map is near.' },
  { id: 'depth-color', label: 'Depth color', blurb: 'The photo is tinted by a two-colour gradient driven by depth, slowly shifting.' },
];

export interface DepthParams {
  preset: DepthPresetId;
  /** Overall strength multiplier, 0..2. */
  intensity: number;
  /** Max slice displacement in px (at the content-canvas scale), 0..60. */
  displacement: number;
  /** Focus point, normalised 0..1 (pulse rings + light originate here). */
  focusX: number;
  focusY: number;
  /** Mouse parallax offset, normalised -1..1 (preview only). */
  parallaxX: number;
  parallaxY: number;
  color1: string;
  color2: string;
}

export const DEFAULT_DEPTH_PARAMS: DepthParams = {
  preset: 'depth-waves',
  intensity: 1,
  displacement: 18,
  focusX: 0.5,
  focusY: 0.5,
  parallaxX: 0,
  parallaxY: 0,
  color1: '#22d3ee',
  color2: '#f472b6',
};

export function coerceDepthParams(raw: unknown): DepthParams {
  const r = (raw ?? {}) as Partial<DepthParams>;
  const preset = DEPTH_PRESETS.some((p) => p.id === r.preset) ? (r.preset as DepthPresetId) : 'depth-waves';
  const clamp01 = (v: unknown, d: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
    return Math.min(1, Math.max(0, n));
  };
  return {
    preset,
    intensity: typeof r.intensity === 'number' && Number.isFinite(r.intensity) ? Math.min(2, Math.max(0, r.intensity)) : 1,
    displacement: typeof r.displacement === 'number' && Number.isFinite(r.displacement) ? Math.min(60, Math.max(0, r.displacement)) : 18,
    focusX: clamp01(r.focusX, 0.5),
    focusY: clamp01(r.focusY, 0.5),
    parallaxX: typeof r.parallaxX === 'number' && Number.isFinite(r.parallaxX) ? Math.min(1, Math.max(-1, r.parallaxX)) : 0,
    parallaxY: typeof r.parallaxY === 'number' && Number.isFinite(r.parallaxY) ? Math.min(1, Math.max(-1, r.parallaxY)) : 0,
    color1: typeof r.color1 === 'string' ? r.color1 : '#22d3ee',
    color2: typeof r.color2 === 'string' ? r.color2 : '#f472b6',
  };
}

// ---------------------------------------------------------------------------
// Estimated depth map: luminance + edges.
// ---------------------------------------------------------------------------

/**
 * Build a grayscale estimated depth map from a photo. Luminance (blurred,
 * contrast-stretched) is the depth signal; strong edges darken the map a
 * little, since edges usually mark a depth discontinuity. This is a
 * heuristic, not a learned model — see DEPTH_ESTIMATE_LABEL.
 */
export function estimateDepthMap(
  source: HTMLImageElement | HTMLCanvasElement,
  width = 256,
  height = 144,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const lum = new Float32Array(width * height);
  for (let i = 0; i < lum.length; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  // Two passes of a 3x3 box blur to smooth the luminance field.
  const blurred = new Float32Array(lum.length);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? lum : blurred;
    const dst = pass === 0 ? blurred : lum;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            sum += src[yy * width + xx];
            n++;
          }
        }
        dst[y * width + x] = sum / n;
      }
    }
  }
  const smooth = blurred;
  // Sobel edge magnitude on the smoothed luminance.
  const edge = new Float32Array(width * height);
  let edgeMax = 1;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        -smooth[(y - 1) * width + x - 1] - 2 * smooth[y * width + x - 1] - smooth[(y + 1) * width + x - 1] +
        smooth[(y - 1) * width + x + 1] + 2 * smooth[y * width + x + 1] + smooth[(y + 1) * width + x + 1];
      const gy =
        -smooth[(y - 1) * width + x - 1] - 2 * smooth[(y - 1) * width + x] - smooth[(y - 1) * width + x + 1] +
        smooth[(y + 1) * width + x - 1] + 2 * smooth[(y + 1) * width + x] + smooth[(y + 1) * width + x + 1];
      const m = Math.sqrt(gx * gx + gy * gy);
      edge[y * width + x] = m;
      if (m > edgeMax) edgeMax = m;
    }
  }
  // Combine: depth = blurred luminance, edges pull slightly darker.
  // Contrast-stretch to the full 0..255 range.
  let lo = 255;
  let hi = 0;
  const depth = new Float32Array(width * height);
  for (let i = 0; i < depth.length; i++) {
    const v = smooth[i] * (1 - 0.22 * (edge[i] / edgeMax));
    depth[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(1, hi - lo);
  const out = ctx.createImageData(width, height);
  for (let i = 0; i < depth.length; i++) {
    const v = Math.round(((depth[i] - lo) / span) * 255);
    out.data[i * 4] = v;
    out.data[i * 4 + 1] = v;
    out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

export function depthMapToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

// ---------------------------------------------------------------------------
// Depth sampling (cached per depth canvas so per-frame draws stay cheap).
// ---------------------------------------------------------------------------

interface DepthGrid {
  w: number;
  h: number;
  /** Normalised depth 0..1, row-major. */
  values: Float32Array;
}

const gridCache = new WeakMap<HTMLCanvasElement | HTMLImageElement, DepthGrid>();

function depthGrid(source: HTMLCanvasElement | HTMLImageElement, gw: number, gh: number): DepthGrid {
  const cached = gridCache.get(source);
  if (cached && cached.w === gw && cached.h === gh) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = gw;
  canvas.height = gh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, gw, gh);
  const data = ctx.getImageData(0, 0, gw, gh).data;
  const values = new Float32Array(gw * gh);
  for (let i = 0; i < values.length; i++) values[i] = data[i * 4] / 255;
  const grid = { w: gw, h: gh, values };
  gridCache.set(source, grid);
  return grid;
}

/** Bilinear sample of the depth grid at normalised (u, v). */
function sampleGrid(grid: DepthGrid, u: number, v: number): number {
  const x = Math.min(grid.w - 1.001, Math.max(0, u * grid.w));
  const y = Math.min(grid.h - 1.001, Math.max(0, v * grid.h));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = (xx: number, yy: number) => grid.values[yy * grid.w + xx];
  const top = i(x0, y0) * (1 - fx) + i(x0 + 1, y0) * fx;
  const bot = i(x0, y0 + 1) * (1 - fx) + i(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}

function lerpColor(a: string, b: string, f: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * f);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * f);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * f);
  return `rgb(${r},${g},${bl})`;
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ---------------------------------------------------------------------------
// Preset rendering. `photo` may be null (depth map only) — then the depth
// map itself is the image source.
// ---------------------------------------------------------------------------

export interface DrawDepthOpts {
  photo: HTMLImageElement | HTMLCanvasElement | null;
  /** Grayscale depth map (estimated or user-imported). */
  depth: HTMLCanvasElement | HTMLImageElement | null;
  params: DepthParams;
}

export function drawDepthVisual(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  opts: DrawDepthOpts,
): void {
  const { photo, depth, params } = opts;
  const img = photo ?? depth;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (!img) {
    // No image at all: draw a neutral depth-gradient placeholder.
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, params.color1);
    g.addColorStop(1, params.color2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
  const grid = depth ? depthGrid(depth, 96, 54) : null;
  const disp = params.displacement * params.intensity;
  const px = params.parallaxX * 12;
  const py = params.parallaxY * 12;

  switch (params.preset) {
    case 'depth-waves': {
      const rows = 24;
      const rh = h / rows;
      for (let i = 0; i < rows; i++) {
        const v = (i + 0.5) / rows;
        const d = grid ? sampleGrid(grid, 0.5, v) : 0.5;
        const off = Math.sin(t * 1.6 + d * 6) * disp * (0.3 + d) + px * d;
        ctx.drawImage(img, 0, i * rh, w, rh, off, i * rh + py * d * 0.3, w, rh);
      }
      break;
    }
    case 'depth-displacement': {
      const cols = 32;
      const cw = w / cols;
      for (let i = 0; i < cols; i++) {
        const u = (i + 0.5) / cols;
        const d = grid ? sampleGrid(grid, u, 0.5) : 0.5;
        const off = (d - 0.5) * disp * 2 + px * d;
        ctx.drawImage(img, i * cw, 0, cw, h, i * cw + off, py * (d - 0.5), cw, h);
      }
      break;
    }
    case 'pulse': {
      ctx.drawImage(img, 0, 0, w, h);
      const fx = (params.focusX + params.parallaxX * 0.08) * w;
      const fy = (params.focusY + params.parallaxY * 0.08) * h;
      const maxR = Math.hypot(w, h) * 0.75;
      const rings = 4;
      for (let i = 0; i < rings; i++) {
        const p = ((t * 0.35 + i / rings) % 1);
        const r = p * maxR;
        const alpha = (1 - p) * 0.55 * params.intensity;
        ctx.beginPath();
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        ctx.strokeStyle = i % 2 === 0 ? params.color1 : params.color2;
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.lineWidth = 2 + 3 * (1 - p);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Soft glow at the focus point, pulsing with time.
      const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, maxR * 0.35);
      const pulse = 0.10 + 0.08 * Math.sin(t * 3);
      glow.addColorStop(0, params.color1);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = Math.max(0, pulse * params.intensity);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'neon-contours': {
      // Faint photo underneath so the contours sit on the scene.
      if (photo) {
        ctx.globalAlpha = 0.22;
        ctx.drawImage(photo, 0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      if (!grid) break;
      const thresholds = [0.3, 0.52, 0.74].map((th) => th + 0.05 * Math.sin(t * 0.7));
      const colors = [params.color1, params.color2, '#fbbf24'];
      // Marching squares on the depth grid.
      for (let ti = 0; ti < thresholds.length; ti++) {
        const th = thresholds[ti];
        ctx.strokeStyle = colors[ti % colors.length];
        ctx.globalAlpha = 0.9 * params.intensity;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        const cw = w / grid.w;
        const ch = h / grid.h;
        for (let gy = 0; gy < grid.h - 1; gy++) {
          for (let gx = 0; gx < grid.w - 1; gx++) {
            const a = grid.values[gy * grid.w + gx] > th ? 1 : 0;
            const b = grid.values[gy * grid.w + gx + 1] > th ? 1 : 0;
            const c = grid.values[(gy + 1) * grid.w + gx + 1] > th ? 1 : 0;
            const d = grid.values[(gy + 1) * grid.w + gx] > th ? 1 : 0;
            const idx = a * 8 + b * 4 + c * 2 + d;
            if (idx === 0 || idx === 15) continue;
            const x = gx * cw;
            const y = gy * ch;
            const top: [number, number] = [x + cw / 2, y];
            const right: [number, number] = [x + cw, y + ch / 2];
            const bot: [number, number] = [x + cw / 2, y + ch];
            const left: [number, number] = [x, y + ch / 2];
            const seg = (p1: [number, number], p2: [number, number]) => {
              ctx.moveTo(p1[0], p1[1]);
              ctx.lineTo(p2[0], p2[1]);
            };
            switch (idx) {
              case 1: case 14: seg(left, bot); break;
              case 2: case 13: seg(bot, right); break;
              case 3: case 12: seg(left, right); break;
              case 4: case 11: seg(top, right); break;
              case 5: seg(top, left); seg(bot, right); break;
              case 6: case 10: seg(top, bot); break;
              case 7: case 8: seg(top, left); break;
              case 9: seg(top, right); seg(left, bot); break;
              default: break;
            }
          }
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'depth-particles': {
      ctx.fillStyle = '#050508';
      ctx.fillRect(0, 0, w, h);
      if (!grid) break;
      const count = 320;
      for (let i = 0; i < count; i++) {
        // Deterministic pseudo-random seed per particle.
        const s1 = Math.sin(i * 127.1 + 311.7) * 43758.5453;
        const s2 = Math.sin(i * 269.5 + 183.3) * 28001.8384;
        const u = s1 - Math.floor(s1);
        const v0 = s2 - Math.floor(s2);
        // Drift upward over time; depth sets speed.
        const d0 = sampleGrid(grid, u, v0);
        const speed = (0.02 + d0 * 0.10) * params.intensity;
        const v = (v0 - t * speed) % 1;
        const vv = v < 0 ? v + 1 : v;
        const d = sampleGrid(grid, u, vv);
        const size = 0.8 + d * 3.2 * params.intensity;
        const alpha = 0.25 + d * 0.65;
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.fillStyle = lerpColor(params.color1, params.color2, d);
        ctx.beginPath();
        ctx.arc(u * w + px * d, vv * h + py * d, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'animated-lighting': {
      ctx.drawImage(img, 0, 0, w, h);
      const lx = (0.5 + 0.35 * Math.sin(t * 0.5) + params.parallaxX * 0.15) * w;
      const ly = (0.5 + 0.3 * Math.sin(t * 0.83 + 1.2) + params.parallaxY * 0.15) * h;
      const r = Math.max(w, h) * 0.55;
      const light = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
      light.addColorStop(0, 'rgba(255,255,255,0.85)');
      light.addColorStop(0.5, 'rgba(255,255,255,0.18)');
      light.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.55 * params.intensity;
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, w, h);
      // Near-depth areas catch more light: screen-blend the depth map.
      if (depth) {
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.18 * params.intensity;
        ctx.drawImage(depth, 0, 0, w, h);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      // Vignette.
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'depth-color': {
      ctx.drawImage(img, 0, 0, w, h);
      if (!grid) break;
      // Desaturate the photo, then tint by depth with a slowly shifting hue.
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const hueShift = Math.sin(t * 0.4) * 0.12;
      const bandH = h / 8;
      for (let i = 0; i < 8; i++) {
        const v = (i + 0.5) / 8;
        const d = sampleGrid(grid, 0.5, v);
        const f = Math.min(1, Math.max(0, d + hueShift));
        ctx.globalAlpha = (0.28 + 0.22 * d) * params.intensity;
        ctx.fillStyle = lerpColor(params.color1, params.color2, f);
        ctx.fillRect(0, i * bandH, w, bandH + 1);
      }
      ctx.globalAlpha = 1;
      break;
    }
    default:
      ctx.drawImage(img, 0, 0, w, h);
      break;
  }
  ctx.restore();
}
