// PropertiesPanel — inspector for the selected surface: transform (bbox +
// rotation + per-corner coordinates), opacity, blend mode, visibility/lock,
// content assignment (visual picker grouped by category, or image / video /
// camera / draw), curve amount, duplicate / delete.
// NOTE: transform inputs edit the axis-aligned bounding box; on a warped
// quad they re-square the corners (use the stage corner handles to keep a
// warp). Rotation is derived from the TL->TR edge and applied as a delta.
'use client';
import { useRef, useState } from 'react';
import { useStudioStore } from '../lib/store';
import type { Surface } from '../lib/schema';
import { VISUALS, VISUAL_CATEGORIES } from '../lib/visuals';
import { requestCamera, stopCamera, getCameraStream } from '../lib/engine/cameraBus';
import type { Pt } from '../lib/homography';
import { Button } from './ui/button';
import { Slider } from './ui/slider';

function bboxOf(corners: Pt[]): { x: number; y: number; w: number; h: number } {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function cornersFromBbox(b: { x: number; y: number; w: number; h: number }): Pt[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
}

function rotationDeg(corners: Pt[]): number {
  const [tl, tr] = corners;
  return (Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI;
}

function rotateCorners(corners: Pt[], deltaDeg: number): Pt[] {
  const c = {
    x: (corners[0].x + corners[2].x) / 2,
    y: (corners[0].y + corners[2].y) / 2,
  };
  const a = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return corners.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
  });
}

function curveOf(s: Surface): number {
  const c = (s as unknown as { curve?: unknown }).curve;
  return typeof c === 'number' ? c : 0;
}

const BLEND_MODES = ['normal', 'add', 'multiply', 'screen'];
const CONTENT_KINDS = ['visual', 'image', 'video', 'camera', 'draw'] as const;

export default function PropertiesPanel() {
  const surface = useStudioStore((s) => s.project?.surfaces.find((x) => x.id === s.selectedSurfaceId) ?? null);
  const updateSurface = useStudioStore((s) => s.updateSurface);
  const duplicateSurface = useStudioStore((s) => s.duplicateSurface);
  const removeSurface = useStudioStore((s) => s.removeSurface);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [cameraOn, setCameraOn] = useState(() => getCameraStream() !== null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  if (!surface) {
    return <p className="text-xs text-zinc-500">Select a surface to edit its properties.</p>;
  }

  const bbox = bboxOf(surface.corners);
  const rot = rotationDeg(surface.corners);
  const content = surface.content ?? { kind: 'visual' as const };
  const extra = content as unknown as Record<string, unknown>;

  const setBbox = (patch: Partial<{ x: number; y: number; w: number; h: number }>) => {
    updateSurface(surface.id, { corners: cornersFromBbox({ ...bbox, ...patch }) });
  };

  const setCorner = (i: number, axis: 'x' | 'y', v: number) => {
    const corners = surface.corners.map((c, j) => (j === i ? { ...c, [axis]: v } : c));
    updateSurface(surface.id, { corners });
  };

  const onImageFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateSurface(surface.id, {
        content: { ...surface.content, kind: 'image', imageDataUrl: String(reader.result) } as Surface['content'],
      });
    };
    reader.readAsDataURL(file);
  };

  const onVideoFile = (file: File | undefined) => {
    if (!file) return;
    // Object URLs do not survive a reload — the video must be re-picked
    // after reopening the project (full media library is Phase 3).
    const url = URL.createObjectURL(file);
    updateSurface(surface.id, {
      content: { ...surface.content, kind: 'video', videoObjectUrl: url } as Surface['content'],
    });
  };

  const toggleCamera = async () => {
    if (cameraOn) {
      stopCamera();
      setCameraOn(false);
      return;
    }
    setCameraError(null);
    const stream = await requestCamera();
    if (stream) setCameraOn(true);
    else setCameraError('Camera unavailable or permission denied.');
  };

  const num = (label: string, value: number, step: number, onChange: (v: number) => void, suffix = '') => (
    <label className="flex items-center gap-1 text-[11px] text-zinc-400">
      <span className="w-8 shrink-0">{label}</span>
      <input
        type="number"
        step={step}
        value={Math.round(value * 1000) / 1000}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-full min-w-0 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
      />
      {suffix && <span>{suffix}</span>}
    </label>
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-zinc-100">{surface.name}</p>
        <p className="text-xs text-zinc-500">
          {surface.shape} · z {surface.z}
        </p>
      </div>

      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Transform</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {num('X', bbox.x, 0.01, (v) => setBbox({ x: v }))}
          {num('Y', bbox.y, 0.01, (v) => setBbox({ y: v }))}
          {num('W', bbox.w, 0.01, (v) => setBbox({ w: Math.max(0.01, v) }))}
          {num('H', bbox.h, 0.01, (v) => setBbox({ h: Math.max(0.01, v) }))}
        </div>
        <div className="mt-1.5">
          {num('Rot°', Math.round(rot * 10) / 10, 1, (v) => updateSurface(surface.id, { corners: rotateCorners(surface.corners, v - rot) }))}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">Position/size are normalized 0–1. Editing them re-squares a warped quad.</p>
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Corners</h3>
        <div className="space-y-1.5">
          {(['TL', 'TR', 'BR', 'BL'] as const).map((label, i) => (
            <div key={label} className="grid grid-cols-2 gap-1.5">
              {num(`${label} x`, surface.corners[i].x, 0.01, (v) => setCorner(i, 'x', v))}
              {num(`${label} y`, surface.corners[i].y, 0.01, (v) => setCorner(i, 'y', v))}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <Slider
          label="Opacity"
          value={Math.round(surface.opacity * 100)}
          min={0}
          max={100}
          onChange={(v) => updateSurface(surface.id, { opacity: v / 100 })}
          format={(v) => `${v}%`}
        />
        <label className="block text-xs text-zinc-300">
          Blend mode
          <select
            value={surface.blendMode ?? 'normal'}
            onChange={(e) => updateSurface(surface.id, { blendMode: e.target.value })}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
                {m === 'screen' ? ' (falls back to normal — no three.js constant)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={surface.visible}
              onChange={(e) => updateSurface(surface.id, { visible: e.target.checked })}
              className="accent-amber-400"
            />
            Visible
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={surface.locked}
              onChange={(e) => updateSurface(surface.id, { locked: e.target.checked })}
              className="accent-amber-400"
            />
            Locked
          </label>
        </div>
        {(surface.shape === 'curved' || curveOf(surface) !== 0) && (
          <Slider
            label="Curve"
            value={Math.round(curveOf(surface) * 100)}
            min={-100}
            max={100}
            onChange={(v) =>
              updateSurface(surface.id, { curve: v / 100 } as unknown as Partial<Surface>)
            }
            format={(v) => `${v}%`}
          />
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Content</h3>
        <label className="block text-xs text-zinc-300">
          Source
          <select
            value={content.kind}
            onChange={(e) =>
              updateSurface(surface.id, { content: { ...surface.content, kind: e.target.value } as Surface['content'] })
            }
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
          >
            {CONTENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        {content.kind === 'visual' && (
          <label className="block text-xs text-zinc-300">
            Visual
            <select
              value={(content as { visualId?: string }).visualId ?? 'aurora'}
              onChange={(e) =>
                updateSurface(surface.id, { content: { ...surface.content, visualId: e.target.value } as Surface['content'] })
              }
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
            >
              {VISUAL_CATEGORIES.map((cat) => (
                <optgroup key={cat} label={cat}>
                  {VISUALS.filter((v) => v.category === cat).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {content.kind === 'image' && (
          <div>
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onImageFile(e.target.files?.[0])} />
            <Button variant="outline" size="sm" onClick={() => imageInputRef.current?.click()}>
              {extra.imageDataUrl ? 'Replace image…' : 'Choose image…'}
            </Button>
            <p className="mt-1 text-[11px] text-zinc-500">Stored as a data URL on the surface (full media library is Phase 3).</p>
          </div>
        )}
        {content.kind === 'video' && (
          <div>
            <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => onVideoFile(e.target.files?.[0])} />
            <Button variant="outline" size="sm" onClick={() => videoInputRef.current?.click()}>
              {extra.videoObjectUrl ? 'Replace video…' : 'Choose video…'}
            </Button>
            <p className="mt-1 text-[11px] text-zinc-500">Loops muted. Object URLs don&apos;t survive reload — re-pick after reopening.</p>
          </div>
        )}
        {content.kind === 'camera' && (
          <div>
            <Button variant="outline" size="sm" onClick={() => void toggleCamera()}>
              {cameraOn ? 'Stop camera' : 'Enable camera'}
            </Button>
            {cameraError && <p className="mt-1 text-[11px] text-red-300">{cameraError}</p>}
          </div>
        )}
        {content.kind === 'draw' && (
          <p className="text-[11px] text-zinc-500">
            {(extra.strokes as unknown[])?.length ?? 0} stored stroke(s). Drawing on the stage arrives in a later phase.
          </p>
        )}
        {surface.shape === 'text' && (
          <label className="block text-xs text-zinc-300">
            Text
            <input
              type="text"
              value={(content as { text?: string }).text ?? surface.name}
              onChange={(e) =>
                updateSurface(surface.id, { content: { ...surface.content, text: e.target.value } as Surface['content'] })
              }
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
            />
          </label>
        )}
      </section>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={() => duplicateSurface(surface.id)}>
          Duplicate
        </Button>
        <Button variant="destructive" size="sm" onClick={() => removeSurface(surface.id)}>
          Delete
        </Button>
      </div>
    </div>
  );
}
