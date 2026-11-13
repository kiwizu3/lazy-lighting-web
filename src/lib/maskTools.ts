// Mask editing helpers (Phase 3) — mirrors exactly what the Phase 2
// renderer implements in src/lib/engine/masks.ts. Do NOT offer anything
// beyond this list in the UI.
//
// Implemented kinds (buildMaskCanvas): rect, circle, ellipse, rounded,
// polygon, freehand, cutout, text. `image` is a recognised kind that the
// renderer does NOT apply — a surface asking for one renders unmasked and
// logs a console warning (Phase 5 integration).
// Combine modes: the renderer implements NONE — there is no add /
// subtract / intersect in masks.ts, and getMaskSpec reads only
// kind/feather/invert/opacity. SUPPORTED_COMBINE_MODES is therefore empty
// on purpose; the editor shows an honest note instead of a fake select.
//
// Shape source of truth: polygon / freehand masks are drawn from
// surface.vertices (not from mask params) — the editor edits
// surface.vertices for those kinds and mirrors the points into
// mask.params.vertices for readability only.
import type { Surface } from './schema';
import type { Pt } from './types';

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

export interface MaskParams {
  feather?: number; // 0..1
  invert?: boolean;
  opacity?: number; // 0..1
  text?: string;
  mediaId?: string;
  /** Mirror of the polygon/freehand outline (renderer reads surface.vertices). */
  vertices?: Pt[];
}

export interface MaskValue {
  kind: MaskKind;
  params: MaskParams;
}

/** Deliberately empty: the renderer has no combine modes. */
export const SUPPORTED_COMBINE_MODES: string[] = [];

export const MASK_KINDS: { id: MaskKind; label: string; note?: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'rect', label: 'Rectangle (full surface)' },
  { id: 'circle', label: 'Circle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'rounded', label: 'Rounded rectangle' },
  { id: 'polygon', label: 'Polygon (surface outline vertices)' },
  { id: 'freehand', label: 'Freehand (surface outline vertices)' },
  { id: 'cutout', label: 'Cutout (rect with centre hole)' },
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Image', note: 'Stored only — the renderer does not apply image masks yet.' },
];

export function defaultMask(kind: MaskKind): MaskValue {
  return { kind, params: { feather: 0, invert: false, opacity: 1 } };
}

export function getSurfaceMask(surface: Surface | null | undefined): MaskValue {
  if (!surface?.mask) return defaultMask('none');
  const raw = surface.mask as unknown as { kind?: unknown; params?: unknown };
  const kind = String(raw.kind ?? 'none') as MaskKind;
  const params = (raw.params as MaskParams | undefined) ?? {};
  return {
    kind: (MASK_KINDS.some((k) => k.id === kind) ? kind : 'none') as MaskKind,
    params: {
      feather: typeof params.feather === 'number' ? params.feather : 0,
      invert: params.invert === true,
      opacity: typeof params.opacity === 'number' ? params.opacity : 1,
      text: typeof params.text === 'string' ? params.text : undefined,
      mediaId: typeof params.mediaId === 'string' ? params.mediaId : undefined,
      vertices: Array.isArray(params.vertices) ? (params.vertices as Pt[]) : undefined,
    },
  };
}

/** Patch object for store.updateSurface — keeps mask in the schema's passthrough shape. */
export function maskPatch(mask: MaskValue): Partial<Surface> {
  return { mask: { kind: mask.kind, params: { ...mask.params } } as Surface['mask'] };
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Sample a freehand point list down to at most `max` vertices. */
export function simplifyPath(points: Pt[], max = 64): Pt[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: Pt[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  return out;
}
