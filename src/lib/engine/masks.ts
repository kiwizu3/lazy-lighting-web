// Rendering-side masks: build an alpha-mask canvas for a surface and a
// ShaderMaterial that multiplies the content texture's alpha by it.
// Mask kinds implemented: rect, circle/ellipse, rounded, polygon/freehand
// (from surface.vertices), cutout, text, image (mediaId / data URL, sampled
// as luminance — white = visible — resolved from IndexedDB, cached).
import * as THREE from 'three';
import type { Surface } from '../schema';
import { defaultBlobPoints } from '../warp';
import { getMediaBlob } from '../db';

export type MaskKind =
  | 'none'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'rounded'
  | 'polygon'
  | 'freehand'
  | 'cutout'
  | 'text'
  | 'image';

export interface MaskSpec {
  kind: MaskKind;
  feather: number; // 0..1 -> blur px on the mask canvas
  invert: boolean;
  opacity: number; // 0..1, how strongly the mask applies
}

export function getMaskSpec(surface: Surface): MaskSpec | null {
  const raw = (surface as unknown as { mask?: unknown }).mask;
  if (!raw) return null;
  let kind = 'none';
  let params: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    kind = raw;
  } else if (typeof raw === 'object') {
    kind = String((raw as { kind?: unknown }).kind ?? 'none');
    params = ((raw as { params?: unknown }).params as Record<string, unknown>) ?? {};
  }
  if (kind === 'none' || kind === '') return null;
  return {
    kind: kind as MaskKind,
    feather: clampNum(params.feather, 0, 1, 0),
    invert: params.invert === true,
    opacity: clampNum(params.opacity, 0, 1, 1),
  };
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

// ---- image masks (Phase 5) ----
// Processed (luminance) mask canvases, keyed by mediaId or data-URL prefix.
// The shader samples the mask texture's red channel, so the image is
// converted to greyscale luminance once, when it loads.
const imageMaskCache = new Map<string, HTMLCanvasElement>();
const imageMaskPending = new Set<string>();

function maskImageKey(surface: Surface): string | null {
  const params = ((surface.mask as { params?: Record<string, unknown> } | undefined)?.params ?? {}) as Record<string, unknown>;
  const mediaId = typeof params.mediaId === 'string' ? params.mediaId : null;
  if (mediaId) return `media:${mediaId}`;
  const dataUrl = typeof params.dataUrl === 'string' ? params.dataUrl : typeof params.imageDataUrl === 'string' ? params.imageDataUrl : null;
  if (dataUrl) return `data:${dataUrl.slice(0, 80)}`;
  return null;
}

function processMaskImage(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  // Cover-fit the image.
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  // Luminance -> greyscale, so the shader's .r sample is brightness.
  try {
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      px[i] = lum;
      px[i + 1] = lum;
      px[i + 2] = lum;
      px[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
  } catch {
    // getImageData can throw for tainted canvases — keep the raw image.
  }
  return canvas;
}

/** Kick off an async load of the mask image; cached when ready. */
export function preloadImageMask(surface: Surface): void {
  const key = maskImageKey(surface);
  if (!key || imageMaskCache.has(key) || imageMaskPending.has(key)) return;
  imageMaskPending.add(key);
  const params = ((surface.mask as { params?: Record<string, unknown> } | undefined)?.params ?? {}) as Record<string, unknown>;
  const mediaId = typeof params.mediaId === 'string' ? params.mediaId : null;
  const loadImg = (src: string) => {
    const img = new Image();
    img.onload = () => {
      imageMaskCache.set(key, processMaskImage(img, 256, 256));
      imageMaskPending.delete(key);
    };
    img.onerror = () => imageMaskPending.delete(key);
    img.src = src;
  };
  if (mediaId) {
    void getMediaBlob(mediaId).then((rec) => {
      if (!rec) {
        imageMaskPending.delete(key);
        return;
      }
      loadImg(URL.createObjectURL(rec.blob));
    });
  } else {
    const dataUrl = typeof params.dataUrl === 'string' ? params.dataUrl : typeof params.imageDataUrl === 'string' ? params.imageDataUrl : null;
    if (dataUrl) loadImg(dataUrl);
    else imageMaskPending.delete(key);
  }
}

/**
 * Signature for change detection: kind + params + whether the image mask
 * has resolved. surfaces.ts rebuilds the mask texture when it changes, so
 * an image mask appears as soon as its async load finishes.
 */
export function maskSignature(surface: Surface): string {
  const spec = getMaskSpec(surface);
  if (!spec) return 'none';
  if (spec.kind === 'image') {
    const key = maskImageKey(surface);
    const ready = key ? imageMaskCache.has(key) : false;
    return `image|${key ?? ''}|${ready ? 'ready' : 'pending'}|f${spec.feather}|i${spec.invert ? 1 : 0}|o${spec.opacity}`;
  }
  return JSON.stringify({ kind: spec.kind, feather: spec.feather, invert: spec.invert, opacity: spec.opacity, vertices: surface.vertices ?? null });
}

export function clearImageMaskCache(): void {
  imageMaskCache.clear();
  imageMaskPending.clear();
}

/**
 * Draw the mask shape (white on black) into a canvas of size w x h, in
 * surface-local space (0..1 maps to the full canvas). Returns null when the
 * surface has no mask, or when an image mask has not finished loading yet
 * (the caller retries — see maskSignature — and the surface renders
 * unmasked meanwhile).
 */
export function buildMaskCanvas(surface: Surface, w = 256, h = 256): HTMLCanvasElement | null {
  const spec = getMaskSpec(surface);
  if (!spec) return null;
  if (spec.kind === 'image') {
    const key = maskImageKey(surface);
    const cached = key ? imageMaskCache.get(key) : undefined;
    if (!cached) {
      preloadImageMask(surface);
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(cached, 0, 0, w, h);
    return canvas;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  // Feather: blur the white shape's edge. ctx.filter is supported in
  // Chromium/Firefox; where it is not, the shape is drawn sharp.
  const blurPx = spec.feather * 24;
  if (blurPx > 0) {
    try {
      (ctx as CanvasRenderingContext2D & { filter: string }).filter = `blur(${blurPx.toFixed(1)}px)`;
    } catch {
      /* ignore — sharp edge fallback */
    }
  }
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  const pts = surface.vertices && surface.vertices.length >= 3 ? surface.vertices : defaultBlobPoints();
  switch (spec.kind) {
    case 'rect':
      ctx.fillRect(0, 0, w, h);
      break;
    case 'circle':
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'rounded': {
      const r = Math.min(w, h) * 0.18;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, r);
      ctx.fill();
      break;
    }
    case 'polygon':
    case 'freehand':
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = p.x * w;
        const y = p.y * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      break;
    case 'cutout':
      // Full rect with a rectangular hole (even-odd).
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(w * 0.3, h * 0.3, w * 0.4, h * 0.4);
      ctx.fill('evenodd');
      break;
    case 'text': {
      const params = ((surface.mask as { params?: Record<string, unknown> } | undefined)?.params ?? {}) as Record<string, unknown>;
      const text = String(params.text ?? (surface.content as { text?: string }).text ?? surface.name);
      ctx.font = `bold ${Math.floor(h * 0.6)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2);
      break;
    }
    default:
      ctx.fillRect(0, 0, w, h);
      break;
  }
  try {
    (ctx as CanvasRenderingContext2D & { filter: string }).filter = 'none';
  } catch {
    /* ignore */
  }
  return canvas;
}

export function createMaskTexture(surface: Surface): THREE.CanvasTexture | null {
  const canvas = buildMaskCanvas(surface);
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

const SURFACE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SURFACE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uMask;
  uniform float uUseMask;
  uniform float uInvertMask;
  uniform float uMaskOpacity;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uMap, vUv);
    float m = 1.0;
    if (uUseMask > 0.5) {
      float mv = texture2D(uMask, vUv).r;
      if (uInvertMask > 0.5) mv = 1.0 - mv;
      m = mix(1.0, mv, uMaskOpacity);
    }
    float a = c.a * m * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(c.rgb, a);
  }
`;

/** Map a surface blend-mode string to a three.js blending constant. */
export function blendModeToThree(mode: string): number {
  switch ((mode ?? 'normal').toLowerCase()) {
    case 'add':
    case 'additive':
      return THREE.AdditiveBlending;
    case 'multiply':
      return THREE.MultiplyBlending;
    case 'subtract':
    case 'subtractive':
      return THREE.SubtractiveBlending;
    // three.js core has no Screen/Overlay/Difference blending constants;
    // those fall back to normal rather than silently doing the wrong thing.
    default:
      return THREE.NormalBlending;
  }
}

export interface MaskedMaterialOpts {
  opacity: number;
  blendMode: string;
}

/** ShaderMaterial sampling the content texture, multiplied by the mask. */
export function createMaskedMaterial(
  texture: THREE.Texture,
  maskTexture: THREE.CanvasTexture | null,
  spec: MaskSpec | null,
  opts: MaskedMaterialOpts,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uMask: { value: maskTexture ?? new THREE.Texture() },
      uUseMask: { value: maskTexture ? 1 : 0 },
      uInvertMask: { value: spec?.invert ? 1 : 0 },
      uMaskOpacity: { value: spec?.opacity ?? 1 },
      uOpacity: { value: opts.opacity },
    },
    vertexShader: SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: blendModeToThree(opts.blendMode),
  });
}

export function updateMaskedMaterial(
  mat: THREE.ShaderMaterial,
  texture: THREE.Texture,
  maskTexture: THREE.CanvasTexture | null,
  spec: MaskSpec | null,
  opts: MaskedMaterialOpts,
): void {
  mat.uniforms.uMap.value = texture;
  mat.uniforms.uMask.value = maskTexture ?? new THREE.Texture();
  mat.uniforms.uUseMask.value = maskTexture ? 1 : 0;
  mat.uniforms.uInvertMask.value = spec?.invert ? 1 : 0;
  mat.uniforms.uMaskOpacity.value = spec?.opacity ?? 1;
  mat.uniforms.uOpacity.value = opts.opacity;
  const nextBlending = blendModeToThree(opts.blendMode);
  if (mat.blending !== nextBlending) {
    mat.blending = nextBlending;
    mat.needsUpdate = true; // blending change needs a program recompile
  }
}
