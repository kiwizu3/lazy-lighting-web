// Drawing model + rasterisation (Phase 3, engine opacity/text added Phase 5).
//
// Workspace stroke shape (stored in drawing assets):
//   { id, tool, points (normalised 0..1), color, size, opacity, text? }
// The engine's draw source (src/lib/engine/sources.ts) consumes:
//   { points, color, size, opacity?, text? }
//   - brush / pencil / line / rect / circle / polygon: polylines, with the
//     stored opacity honoured per stroke,
//   - text: kept as a single-anchor stroke with its text (the engine renders
//     it with fillText at the anchor),
//   - eraser: never stored as a stroke — the workspace deletes the strokes
//     it touches instead, so nothing eraser-shaped reaches the engine.
// Single-point brush/pencil taps are kept as a one-point stroke; the engine
// renders them as a dot.
import { saveMediaBlob, getMediaBlob } from './db';
import { DRAWING_MIME, DRAWING_NAME_SUFFIX } from './media';
import type { Pt } from './types';

export type DrawTool =
  | 'brush'
  | 'pencil'
  | 'eraser'
  | 'line'
  | 'rect'
  | 'circle'
  | 'polygon'
  | 'text';

export interface DrawStroke {
  id: string;
  tool: DrawTool;
  /** Normalised 0..1 points in canvas space. */
  points: Pt[];
  color: string;
  /** Brush width in canvas px at 960px wide (scaled when rasterising). */
  size: number;
  opacity: number; // 0..1 — stored in the asset; the engine ignores it.
  text?: string;
}

/** The stroke shape the engine's draw source renders. */
export interface EngineStroke {
  points: Pt[];
  color: string;
  size: number;
  /** 0..1 — honoured per stroke by the engine (Phase 5). */
  opacity?: number;
  /** Present on text strokes: the engine renders it at points[0]. */
  text?: string;
}

export interface DrawingAsset {
  version: 1;
  name: string;
  width: number;
  height: number;
  strokes: DrawStroke[];
  /** Rendered PNG data URL (thumbnail / preview). */
  pngDataUrl: string;
  createdAt: number;
}

export const DRAW_TOOLS: { id: DrawTool; label: string }[] = [
  { id: 'brush', label: 'Brush' },
  { id: 'pencil', label: 'Pencil' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'line', label: 'Line' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'circle', label: 'Circle' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'text', label: 'Text' },
];

export const DRAW_SWATCHES = [
  '#ffffff', '#f59e0b', '#ef4444', '#22c55e', '#06b6d4',
  '#3b82f6', '#a855f7', '#ec4899', '#000000', '#64748b',
];

export function newStrokeId(): string {
  return `stroke_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

function sampleCircle(center: Pt, radius: Pt, segments = 40): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: center.x + Math.cos(a) * radius.x, y: center.y + Math.sin(a) * radius.y });
  }
  return pts;
}

/** Convert workspace strokes to the shape the engine renders (opacity + text included). */
export function toEngineStrokes(strokes: DrawStroke[]): EngineStroke[] {
  const out: EngineStroke[] = [];
  for (const s of strokes) {
    if (s.tool === 'eraser') continue; // see header note
    if (s.tool === 'text') {
      if (s.points.length >= 1 && s.text) {
        out.push({ points: [s.points[0]], color: s.color, size: s.size, opacity: s.opacity, text: s.text });
      }
      continue;
    }
    if (s.tool === 'rect' && s.points.length >= 2) {
      const [a, b] = s.points;
      const pts = [
        { x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y },
        { x: a.x, y: b.y }, { x: a.x, y: a.y },
      ];
      out.push({ points: pts, color: s.color, size: s.size, opacity: s.opacity });
    } else if (s.tool === 'circle' && s.points.length >= 2) {
      const [a, b] = s.points;
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const radius = { x: Math.abs(b.x - a.x) / 2, y: Math.abs(b.y - a.y) / 2 };
      out.push({ points: sampleCircle(center, radius), color: s.color, size: s.size, opacity: s.opacity });
    } else if (s.tool === 'polygon' && s.points.length >= 2) {
      out.push({ points: [...s.points, s.points[0]], color: s.color, size: s.size, opacity: s.opacity });
    } else if (s.points.length >= 1) {
      out.push({ points: s.points, color: s.color, size: s.size, opacity: s.opacity });
    }
  }
  return out;
}

/** Draw one workspace stroke onto a 2D context (canvas w x h px). */
export function drawStrokeOnCanvas(
  ctx: CanvasRenderingContext2D,
  stroke: DrawStroke,
  w: number,
  h: number,
): void {
  const scale = w / 960; // size is authored at 960px wide
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, stroke.opacity));
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = Math.max(1, stroke.size * scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const px = (p: Pt) => ({ x: p.x * w, y: p.y * h });
  if (stroke.tool === 'text') {
    const anchor = stroke.points[0];
    if (anchor && stroke.text) {
      const p = px(anchor);
      ctx.font = `${Math.max(12, stroke.size * 4 * scale)}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(stroke.text, p.x, p.y);
    }
    ctx.restore();
    return;
  }
  const pts = toEngineStrokes([stroke])[0]?.points;
  if (!pts || pts.length === 0) {
    ctx.restore();
    return;
  }
  if (pts.length === 1) {
    const p = px(pts[0]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1, stroke.size * scale) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  pts.forEach((p, i) => {
    const q = px(p);
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  });
  ctx.stroke();
  ctx.restore();
}

/** Render strokes to an offscreen canvas (used for PNG export + thumbnails). */
export function renderStrokesToCanvas(
  strokes: DrawStroke[],
  width = 960,
  height = 540,
  background = '#0f172a',
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  for (const s of strokes) drawStrokeOnCanvas(ctx, s, width, height);
  return canvas;
}

export function strokesToPngDataUrl(strokes: DrawStroke[], width = 960, height = 540): string {
  return renderStrokesToCanvas(strokes, width, height).toDataURL('image/png');
}

export function serializeDrawingAsset(
  name: string,
  strokes: DrawStroke[],
  width = 960,
  height = 540,
): DrawingAsset {
  return {
    version: 1,
    name,
    width,
    height,
    strokes,
    pngDataUrl: strokesToPngDataUrl(strokes, width, height),
    createdAt: Date.now(),
  };
}

/** Save a drawing as a media asset (JSON blob in IndexedDB). Returns its media id. */
export async function saveDrawingAsset(
  name: string,
  strokes: DrawStroke[],
  width = 960,
  height = 540,
): Promise<string | null> {
  const asset = serializeDrawingAsset(name, strokes, width, height);
  const blob = new Blob([JSON.stringify(asset)], { type: DRAWING_MIME });
  const fileName = `${name.replace(/[^\w\-]+/g, '-').toLowerCase() || 'drawing'}${DRAWING_NAME_SUFFIX}`;
  const rec = await saveMediaBlob(blob, fileName);
  return rec?.id ?? null;
}

/** Load a drawing asset's strokes + metadata back from IndexedDB. */
export async function loadDrawingAsset(mediaId: string): Promise<DrawingAsset | null> {
  const rec = await getMediaBlob(mediaId);
  if (!rec) return null;
  try {
    const parsed: unknown = JSON.parse(await rec.blob.text());
    const a = parsed as Partial<DrawingAsset>;
    if (!Array.isArray(a.strokes)) return null;
    return {
      version: 1,
      name: a.name ?? rec.name,
      width: a.width ?? 960,
      height: a.height ?? 540,
      strokes: a.strokes as DrawStroke[],
      pngDataUrl: a.pngDataUrl ?? '',
      createdAt: a.createdAt ?? rec.createdAt,
    };
  } catch {
    return null;
  }
}
