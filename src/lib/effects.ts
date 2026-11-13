// Stackable effects — Phase 4.
// Each EffectDef is a pure offscreen-2D-canvas transform:
//   apply(source, params, time, audioLevel) -> new HTMLCanvasElement.
// The pipeline (effectPipeline.ts) chains enabled effects in order and
// scales their strength by `intensity`. Effects read/write only canvases,
// so the same code works as a texture pre-process step today and can feed
// the WebGL engine later. Nothing here touches the DOM or the store.

export type EffectParamType = 'number' | 'boolean' | 'select';

export interface EffectParamDef {
  key: string;
  label: string;
  type: EffectParamType;
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean | string;
  options?: string[];
}

export interface EffectDef {
  id: string;
  name: string;
  description: string;
  params: EffectParamDef[];
  /** Param keys whose numeric value is multiplied by the effect intensity. */
  intensityParams?: string[];
  /** True when the effect is a colour/filter pass that blends with the source. */
  blend?: boolean;
  apply: (
    source: HTMLCanvasElement,
    params: Record<string, number | boolean | string>,
    time: number,
    audioLevel: number,
  ) => HTMLCanvasElement;
}

export interface EffectInstance {
  type: string;
  enabled?: boolean;
  intensity?: number;
  params?: Record<string, number | boolean | string>;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function out(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');
  return { canvas, ctx };
}

function drawSrc(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, w = src.width, h = src.height): void {
  ctx.drawImage(src, 0, 0, w, h);
}

function withFilter(
  src: HTMLCanvasElement,
  filter: string,
): HTMLCanvasElement {
  const { canvas, ctx } = out(src.width, src.height);
  try {
    ctx.filter = filter;
  } catch {
    // ctx.filter unsupported — draw unfiltered.
  }
  drawSrc(ctx, src);
  try {
    ctx.filter = 'none';
  } catch { /* ignore */ }
  return canvas;
}

const num = (p: Record<string, number | boolean | string>, key: string, fallback: number): number => {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

export const EFFECT_DEFS: EffectDef[] = [
  {
    id: 'crop',
    name: 'Crop',
    description: 'Crop to a percentage rectangle of the frame.',
    params: [
      { key: 'x', label: 'Left %', type: 'number', min: 0, max: 80, step: 1, default: 10 },
      { key: 'y', label: 'Top %', type: 'number', min: 0, max: 80, step: 1, default: 10 },
      { key: 'w', label: 'Width %', type: 'number', min: 10, max: 100, step: 1, default: 80 },
      { key: 'h', label: 'Height %', type: 'number', min: 10, max: 100, step: 1, default: 80 },
    ],
    apply: (src, p) => {
      const x = (num(p, 'x', 10) / 100) * src.width;
      const y = (num(p, 'y', 10) / 100) * src.height;
      const w = Math.max(1, (num(p, 'w', 80) / 100) * src.width);
      const h = Math.max(1, (num(p, 'h', 80) / 100) * src.height);
      const { canvas, ctx } = out(w, h);
      ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
      return canvas;
    },
  },
  {
    id: 'fit',
    name: 'Fit',
    description: 'Scale the frame to fit inside the surface (letterboxed).',
    params: [{ key: 'scale', label: 'Scale %', type: 'number', min: 10, max: 100, step: 1, default: 90 }],
    intensityParams: ['scale'],
    apply: (src, p) => {
      const { canvas, ctx } = out(src.width, src.height);
      const s = num(p, 'scale', 90) / 100;
      const w = src.width * s;
      const h = src.height * s;
      ctx.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h);
      return canvas;
    },
  },
  {
    id: 'zoom',
    name: 'Zoom',
    description: 'Zoom into the centre of the frame.',
    params: [{ key: 'factor', label: 'Zoom', type: 'number', min: 1, max: 4, step: 0.05, default: 1.5 }],
    intensityParams: ['factor'],
    apply: (src, p) => {
      const { canvas, ctx } = out(src.width, src.height);
      const f = Math.max(1, num(p, 'factor', 1.5));
      const w = src.width / f;
      const h = src.height / f;
      ctx.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, src.width, src.height);
      return canvas;
    },
  },
  {
    id: 'rotate',
    name: 'Rotate',
    description: 'Rotate the frame around its centre.',
    params: [{ key: 'angle', label: 'Angle °', type: 'number', min: -180, max: 180, step: 1, default: 15 }],
    intensityParams: ['angle'],
    apply: (src, p) => {
      const { canvas, ctx } = out(src.width, src.height);
      ctx.translate(src.width / 2, src.height / 2);
      ctx.rotate((num(p, 'angle', 15) * Math.PI) / 180);
      ctx.drawImage(src, -src.width / 2, -src.height / 2);
      return canvas;
    },
  },
  {
    id: 'slide',
    name: 'Slide',
    description: 'Shift the frame horizontally / vertically (wraps around).',
    params: [
      { key: 'x', label: 'X %', type: 'number', min: -100, max: 100, step: 1, default: 10 },
      { key: 'y', label: 'Y %', type: 'number', min: -100, max: 100, step: 1, default: 0 },
    ],
    intensityParams: ['x', 'y'],
    apply: (src, p) => {
      const { canvas, ctx } = out(src.width, src.height);
      const dx = (num(p, 'x', 10) / 100) * src.width;
      const dy = (num(p, 'y', 0) / 100) * src.height;
      ctx.drawImage(src, dx, dy);
      ctx.drawImage(src, dx - Math.sign(dx || 1) * src.width, dy);
      ctx.drawImage(src, dx, dy - Math.sign(dy || 1) * src.height);
      ctx.drawImage(src, dx - Math.sign(dx || 1) * src.width, dy - Math.sign(dy || 1) * src.height);
      return canvas;
    },
  },
  {
    id: 'blur',
    name: 'Blur',
    description: 'Gaussian blur (uses ctx.filter; falls back to unfiltered where unsupported).',
    params: [{ key: 'radius', label: 'Radius px', type: 'number', min: 0, max: 30, step: 1, default: 6 }],
    intensityParams: ['radius'],
    blend: true,
    apply: (src, p) => withFilter(src, `blur(${Math.max(0, num(p, 'radius', 6))}px)`),
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    description: 'Desaturate to greyscale.',
    params: [],
    blend: true,
    apply: (src) => withFilter(src, 'grayscale(1)'),
  },
  {
    id: 'invert',
    name: 'Invert',
    description: 'Invert all colours.',
    params: [],
    blend: true,
    apply: (src) => withFilter(src, 'invert(1)'),
  },
  {
    id: 'color-cycle',
    name: 'Color Cycle',
    description: 'Hue-rotate, animated over time.',
    params: [
      { key: 'speed', label: 'Speed', type: 'number', min: 0, max: 5, step: 0.1, default: 1 },
      { key: 'amount', label: 'Hue shift °', type: 'number', min: 0, max: 360, step: 5, default: 120 },
    ],
    blend: true,
    apply: (src, p, time) => {
      const hue = (num(p, 'amount', 120) * 0.5 * (1 + Math.sin(time * num(p, 'speed', 1)))) % 360;
      return withFilter(src, `hue-rotate(${hue}deg)`);
    },
  },
  {
    id: 'kaleidoscope',
    name: 'Kaleidoscope',
    description: 'Mirror the frame into N wedge segments around the centre.',
    params: [{ key: 'segments', label: 'Segments', type: 'number', min: 3, max: 16, step: 1, default: 8 }],
    apply: (src, p) => {
      const { canvas, ctx } = out(src.width, src.height);
      const n = Math.max(3, Math.round(num(p, 'segments', 8)));
      const cx = src.width / 2;
      const cy = src.height / 2;
      const r = Math.hypot(cx, cy);
      // Render the source once into a wedge-sized temp, then stamp it rotated.
      const wedge = makeCanvas(Math.ceil(r), Math.ceil(r));
      const wctx = wedge.getContext('2d');
      if (!wctx) return src;
      wctx.drawImage(src, 0, 0, wedge.width, wedge.height);
      ctx.save();
      ctx.translate(cx, cy);
      for (let i = 0; i < n; i++) {
        ctx.save();
        ctx.rotate((i / n) * Math.PI * 2);
        if (i % 2 === 1) ctx.scale(1, -1);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, 0, (Math.PI * 2) / n + 0.05);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(wedge, 0, 0, r, r, 0, 0, r, r);
        ctx.restore();
      }
      ctx.restore();
      return canvas;
    },
  },
  {
    id: 'tile',
    name: 'Tile',
    description: 'Repeat the frame in an N×M grid.',
    params: [
      { key: 'cols', label: 'Columns', type: 'number', min: 1, max: 8, step: 1, default: 3 },
      { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 8, step: 1, default: 2 },
    ],
    apply: (src, p) => {
      const { canvas, ctx } = out(src.width, src.height);
      const cols = Math.max(1, Math.round(num(p, 'cols', 3)));
      const rows = Math.max(1, Math.round(num(p, 'rows', 2)));
      const tw = src.width / cols;
      const th = src.height / rows;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          ctx.drawImage(src, x * tw, y * th, tw, th);
        }
      }
      return canvas;
    },
  },
  {
    id: 'distortion',
    name: 'Distortion',
    description: 'Slice-based wave offset — horizontal slices shift with a sine wave.',
    params: [
      { key: 'amount', label: 'Amount px', type: 'number', min: 0, max: 60, step: 1, default: 18 },
      { key: 'frequency', label: 'Frequency', type: 'number', min: 1, max: 20, step: 0.5, default: 6 },
      { key: 'speed', label: 'Speed', type: 'number', min: 0, max: 5, step: 0.1, default: 1 },
    ],
    intensityParams: ['amount'],
    apply: (src, p, time) => {
      const { canvas, ctx } = out(src.width, src.height);
      const amount = num(p, 'amount', 18);
      const freq = num(p, 'frequency', 6);
      const speed = num(p, 'speed', 1);
      const sliceH = 8;
      for (let y = 0; y < src.height; y += sliceH) {
        const off = Math.sin((y / src.height) * Math.PI * freq + time * speed * 2) * amount;
        ctx.drawImage(src, 0, y, src.width, sliceH, off, y, src.width, sliceH);
      }
      return canvas;
    },
  },
  {
    id: 'rgb-split',
    name: 'RGB Split',
    description: 'Shift the red/blue channels apart for a chromatic-aberration look.',
    params: [{ key: 'offset', label: 'Offset px', type: 'number', min: 0, max: 30, step: 1, default: 8 }],
    intensityParams: ['offset'],
    apply: (src, p) => {
      const { canvas, ctx } = out(src.width, src.height);
      const off = num(p, 'offset', 8);
      // Channel-isolated copies: source multiplied by a pure channel colour
      // keeps only that channel. Shift red left / blue right, composite
      // additively over the centred green channel.
      const channel = (color: string): HTMLCanvasElement => {
        const c = makeCanvas(src.width, src.height);
        const cctx = c.getContext('2d');
        if (!cctx) return c;
        cctx.drawImage(src, 0, 0);
        cctx.globalCompositeOperation = 'multiply';
        cctx.fillStyle = color;
        cctx.fillRect(0, 0, src.width, src.height);
        return c;
      };
      const red = channel('#ff0000');
      const green = channel('#00ff00');
      const blue = channel('#0000ff');
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(red, -off, 0);
      ctx.drawImage(green, 0, 0);
      ctx.drawImage(blue, off, 0);
      ctx.globalCompositeOperation = 'source-over';
      return canvas;
    },
  },
  {
    id: 'glow',
    name: 'Glow',
    description: 'Soft bloom: blurred copy composited with screen blend.',
    params: [
      { key: 'radius', label: 'Blur px', type: 'number', min: 0, max: 30, step: 1, default: 10 },
      { key: 'strength', label: 'Strength', type: 'number', min: 0, max: 2, step: 0.1, default: 0.8 },
    ],
    intensityParams: ['strength'],
    apply: (src, p) => {
      const { canvas, ctx } = out(src.width, src.height);
      drawSrc(ctx, src);
      const blurred = withFilter(src, `blur(${Math.max(0, num(p, 'radius', 10))}px)`);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, Math.max(0, num(p, 'strength', 0.8)));
      ctx.drawImage(blurred, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      return canvas;
    },
  },
  {
    id: 'pixelate',
    name: 'Pixelation',
    description: 'Downscale then upscale with smoothing off for chunky pixels.',
    params: [{ key: 'size', label: 'Pixel size', type: 'number', min: 2, max: 64, step: 1, default: 12 }],
    intensityParams: ['size'],
    apply: (src, p) => {
      const size = Math.max(2, Math.round(num(p, 'size', 12)));
      const small = makeCanvas(Math.max(1, Math.floor(src.width / size)), Math.max(1, Math.floor(src.height / size)));
      const sctx = small.getContext('2d');
      if (!sctx) return src;
      sctx.drawImage(src, 0, 0, small.width, small.height);
      const { canvas, ctx } = out(src.width, src.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, src.width, src.height);
      return canvas;
    },
  },
  {
    id: 'wave',
    name: 'Wave Distortion',
    description: 'Smooth sine-wave warp of the whole frame.',
    params: [
      { key: 'amplitude', label: 'Amplitude px', type: 'number', min: 0, max: 60, step: 1, default: 14 },
      { key: 'frequency', label: 'Frequency', type: 'number', min: 1, max: 20, step: 0.5, default: 4 },
      { key: 'speed', label: 'Speed', type: 'number', min: 0, max: 5, step: 0.1, default: 1 },
    ],
    intensityParams: ['amplitude'],
    apply: (src, p, time) => {
      const { canvas, ctx } = out(src.width, src.height);
      const amp = num(p, 'amplitude', 14);
      const freq = num(p, 'frequency', 4);
      const speed = num(p, 'speed', 1);
      const sliceH = 4;
      for (let y = 0; y < src.height; y += sliceH) {
        const off = Math.sin((y / src.height) * Math.PI * freq + time * speed * 2.5) * amp;
        ctx.drawImage(src, 0, y, src.width, sliceH, off, y, src.width, sliceH);
      }
      return canvas;
    },
  },
  {
    id: 'contrast',
    name: 'Contrast',
    description: 'Adjust contrast.',
    params: [{ key: 'amount', label: 'Contrast', type: 'number', min: 0, max: 2, step: 0.05, default: 1.4 }],
    blend: true,
    apply: (src, p) => withFilter(src, `contrast(${Math.max(0, num(p, 'amount', 1.4))})`),
  },
  {
    id: 'brightness',
    name: 'Brightness',
    description: 'Adjust brightness.',
    params: [{ key: 'amount', label: 'Brightness', type: 'number', min: 0, max: 2, step: 0.05, default: 1.3 }],
    blend: true,
    apply: (src, p) => withFilter(src, `brightness(${Math.max(0, num(p, 'amount', 1.3))})`),
  },
  {
    id: 'saturation',
    name: 'Saturation',
    description: 'Adjust colour saturation.',
    params: [{ key: 'amount', label: 'Saturation', type: 'number', min: 0, max: 3, step: 0.1, default: 1.8 }],
    blend: true,
    apply: (src, p) => withFilter(src, `saturate(${Math.max(0, num(p, 'amount', 1.8))})`),
  },
  {
    id: 'hue',
    name: 'Hue',
    description: 'Shift hue by a fixed amount.',
    params: [{ key: 'degrees', label: 'Hue °', type: 'number', min: -180, max: 180, step: 5, default: 90 }],
    blend: true,
    apply: (src, p) => withFilter(src, `hue-rotate(${num(p, 'degrees', 90)}deg)`),
  },
];

export function getEffectDef(id: string): EffectDef | undefined {
  return EFFECT_DEFS.find((d) => d.id === id);
}

export function defaultEffectParams(def: EffectDef): Record<string, number | boolean | string> {
  const params: Record<string, number | boolean | string> = {};
  for (const p of def.params) params[p.key] = p.default;
  return params;
}

export function createEffectInstance(type: string): EffectInstance | null {
  const def = getEffectDef(type);
  if (!def) return null;
  return { type, enabled: true, intensity: 1, params: defaultEffectParams(def) };
}
