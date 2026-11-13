// Mask editor (Phase 3, image masks wired in Phase 5) — edits the selected
// surface's mask via the store so the existing engine renders it live.
//
//   kinds: none / rect / circle / ellipse / rounded / polygon / freehand /
//          cutout / text / image (image = sampled as luminance from a media
//          library image; white = visible, resolved from IndexedDB).
//   feather / invert / opacity: read from mask.params by the renderer.
//   polygon + freehand: drawn from surface.vertices, NOT from mask params
//          — editing vertices here edits the surface outline (shared with
//          its shape) and mirrors the points into mask.params.vertices.
//   combine modes: the renderer implements NONE, so no combine control is
//   offered — only an honest note.
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudioStore } from '../lib/store';
import type { Surface } from '../lib/schema';
import { listMedia, type MediaMeta } from '../lib/db';
import { mediaKind } from '../lib/media';
import {
  MASK_KINDS, clamp01, getSurfaceMask, maskPatch, simplifyPath,
  type MaskKind, type MaskValue,
} from '../lib/maskTools';
import type { Pt } from '../lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Slider } from './ui/slider';

interface MaskEditorProps {
  /** Defaults to the store's selected surface. */
  surfaceId?: string;
}

export default function MaskEditor({ surfaceId }: MaskEditorProps) {
  const project = useStudioStore((s) => s.project);
  const selectedSurfaceId = useStudioStore((s) => s.selectedSurfaceId);
  const updateSurface = useStudioStore((s) => s.updateSurface);
  const [images, setImages] = useState<MediaMeta[]>([]);
  const [freehandDraft, setFreehandDraft] = useState<Pt[]>([]);
  const drawingRef = useRef(false);
  const freehandCanvasRef = useRef<HTMLCanvasElement>(null);

  const surface = useMemo(
    () => project?.surfaces.find((s) => s.id === (surfaceId ?? selectedSurfaceId)) ?? null,
    [project, surfaceId, selectedSurfaceId],
  );

  useEffect(() => {
    void listMedia().then((list) =>
      setImages(list.filter((m) => mediaKind({ type: m.type, name: m.name }) === 'image')),
    );
  }, []);

  if (!surface) {
    return <p className="text-xs text-zinc-500">Select a surface to edit its mask.</p>;
  }

  const mask = getSurfaceMask(surface);
  const vertices = surface.vertices ?? [];

  const write = (next: MaskValue, extraPatch?: Partial<Surface>) => {
    updateSurface(surface.id, { ...maskPatch(next), ...(extraPatch ?? {}) });
  };

  const setKind = (kind: MaskKind) => {
    write({ kind, params: { ...mask.params } });
  };

  const setParam = <K extends keyof MaskValue['params']>(key: K, value: MaskValue['params'][K]) => {
    write({ kind: mask.kind, params: { ...mask.params, [key]: value } });
  };

  const setVertices = (next: Pt[]) => {
    if (next.length < 3) return;
    write(
      { kind: mask.kind, params: { ...mask.params, vertices: next } },
      { vertices: next },
    );
  };

  const addVertex = () => setVertices([...vertices, { x: 0.5, y: 0.5 }]);
  const removeVertex = (i: number) => {
    if (vertices.length <= 3) return;
    setVertices(vertices.filter((_, j) => j !== i));
  };
  const editVertex = (i: number, axis: 'x' | 'y', v: number) => {
    setVertices(vertices.map((p, j) => (j === i ? { ...p, [axis]: clamp01(v) } : p)));
  };

  const freehandToNormalized = (e: React.PointerEvent): Pt => {
    const rect = freehandCanvasRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const drawFreehandPreview = (pts: Pt[]) => {
    const canvas = freehandCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (pts.length < 2) return;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = p.x * canvas.width;
      const y = p.y * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-zinc-100">
        Mask — {surface.name}
      </p>

      <label className="block text-xs text-zinc-300">
        Mask kind
        <select
          value={mask.kind}
          onChange={(e) => setKind(e.target.value as MaskKind)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
        >
          {MASK_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
              {k.note ? ' — stored only' : ''}
            </option>
          ))}
        </select>
      </label>

      {mask.kind === 'image' && (
        <p className="rounded border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-300" role="note">
          Image masks are sampled as luminance (white = visible) from the chosen media image.
          The image loads from IndexedDB — the surface renders unmasked until it resolves.
        </p>
      )}

      <p className="text-[11px] text-zinc-500">
        The renderer implements a single mask per surface — no combine modes (add / subtract / intersect) exist yet,
        so there is nothing to combine with.
      </p>

      {mask.kind !== 'none' && (
        <>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={mask.params.invert ?? false}
              onChange={(e) => setParam('invert', e.target.checked)}
              className="accent-amber-400"
            />
            Invert mask
          </label>
          <Slider
            label="Feather"
            value={Math.round((mask.params.feather ?? 0) * 100)}
            min={0}
            max={100}
            onChange={(v) => setParam('feather', v / 100)}
            format={(v) => `${v}%`}
          />
          <Slider
            label="Mask opacity"
            value={Math.round((mask.params.opacity ?? 1) * 100)}
            min={0}
            max={100}
            onChange={(v) => setParam('opacity', v / 100)}
            format={(v) => `${v}%`}
          />
        </>
      )}

      {mask.kind === 'text' && (
        <label className="block text-xs text-zinc-300">
          Mask text
          <Input
            value={mask.params.text ?? surface.name}
            onChange={(e) => setParam('text', e.target.value)}
            className="mt-1"
            aria-label="Mask text"
          />
          <span className="mt-1 block text-[11px] text-zinc-500">
            The surface content is clipped to the shape of this text.
          </span>
        </label>
      )}

      {mask.kind === 'image' && (
        <label className="block text-xs text-zinc-300">
          Mask image (from the media library)
          <select
            value={mask.params.mediaId ?? ''}
            onChange={(e) => setParam('mediaId', e.target.value || undefined)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
          >
            <option value="">Choose an image…</option>
            {images.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-zinc-500">
            {images.length === 0
              ? 'No images in the media library yet — upload one on the Library page first.'
              : 'Sampled as luminance: bright areas of the image stay visible.'}
          </span>
        </label>
      )}

      {(mask.kind === 'polygon' || mask.kind === 'freehand') && (
        <section className="space-y-2">
          <p className="text-[11px] text-zinc-500">
            Polygon / freehand masks are drawn from the surface&apos;s outline vertices — editing them here also
            changes the surface shape&apos;s outline.
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {vertices.map((v, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-6 shrink-0 text-[11px] text-zinc-400">#{i + 1}</span>
                <label className="flex flex-1 items-center gap-1 text-[11px] text-zinc-400">
                  x
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    max={1}
                    value={Math.round(v.x * 1000) / 1000}
                    onChange={(e) => editVertex(i, 'x', Number(e.target.value))}
                    className="w-full min-w-0 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                    aria-label={`Vertex ${i + 1} x`}
                  />
                </label>
                <label className="flex flex-1 items-center gap-1 text-[11px] text-zinc-400">
                  y
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    max={1}
                    value={Math.round(v.y * 1000) / 1000}
                    onChange={(e) => editVertex(i, 'y', Number(e.target.value))}
                    className="w-full min-w-0 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                    aria-label={`Vertex ${i + 1} y`}
                  />
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={vertices.length <= 3}
                  onClick={() => removeVertex(i)}
                  aria-label={`Remove vertex ${i + 1}`}
                >
                  ✕
                </Button>
              </div>
            ))}
            {vertices.length === 0 && (
              <p className="text-xs text-zinc-500">
                This surface has no outline vertices yet — the renderer falls back to a default blob shape.
                Draw a freehand outline below to set one.
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={addVertex}>+ Add vertex</Button>

          <div>
            <p className="mb-1 text-xs text-zinc-300">Freehand outline — draw to replace the vertices</p>
            <canvas
              ref={freehandCanvasRef}
              width={320}
              height={180}
              className="w-full cursor-crosshair rounded border border-zinc-700 bg-zinc-900"
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => {
                drawingRef.current = true;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const p = freehandToNormalized(e);
                const pts = [p];
                setFreehandDraft(pts);
                drawFreehandPreview(pts);
              }}
              onPointerMove={(e) => {
                if (!drawingRef.current) return;
                const p = freehandToNormalized(e);
                setFreehandDraft((prev) => {
                  const last = prev[prev.length - 1];
                  const next = last && Math.hypot(p.x - last.x, p.y - last.y) < 0.004 ? prev : [...prev, p];
                  drawFreehandPreview(next);
                  return next;
                });
              }}
              onPointerUp={() => {
                drawingRef.current = false;
                setFreehandDraft((prev) => {
                  if (prev.length >= 3) setVertices(simplifyPath(prev));
                  return [];
                });
                const canvas = freehandCanvasRef.current;
                canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
              }}
              role="application"
              aria-label="Draw freehand mask outline"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Release to apply the drawn path as the surface&apos;s outline vertices (simplified to at most 64 points).
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
