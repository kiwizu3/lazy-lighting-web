// Effects panel — Phase 4.
// Reads/writes the selected surface's `effects` stack via the store.
// The live preview renders the selected surface's current content thumbnail
// (classic canvas visual, or a gradient stand-in for shader / media kinds)
// through the full pipeline every animation frame, so every effect visibly
// changes the preview. Writes are debounced 400 ms so slider drags don't
// flood the undo stack.
'use client';
import { useEffect, useRef, useState } from 'react';
import { useStudioStore } from '../lib/store';
import {
  EFFECT_DEFS,
  createEffectInstance,
  defaultEffectParams,
  getEffectDef,
  type EffectInstance,
} from '../lib/effects';
import { applyEffects, resolveEffectParams } from '../lib/effectPipeline';
import { getVisual } from '../lib/visuals';
import { getShaderVisual } from '../lib/shaders';
import { Button } from './ui/button';
import { Slider } from './ui/slider';

const PREVIEW_W = 320;
const PREVIEW_H = 180;

function drawSourceThumbnail(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  visualId: string | undefined,
  time: number,
): void {
  const visual = visualId ? getVisual(visualId) : null;
  const isClassic = visualId !== undefined && visual !== null && visual.id === visualId;
  if (isClassic && visual) {
    visual.draw(ctx, w, h, time, { audioLevel: 0.2, hueShift: 0, speed: 1, colors: ['#f59e0b', '#06b6d4'] });
    return;
  }
  const shader = visualId ? getShaderVisual(visualId) : undefined;
  const g = ctx.createLinearGradient(0, 0, w, h);
  if (shader) {
    g.addColorStop(0, shader.defaults.color1);
    g.addColorStop(1, shader.defaults.color2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Shader: ${shader.name}`, w / 2, h / 2 - 6);
    ctx.font = '11px sans-serif';
    ctx.fillText('preview stand-in — the stage renders the live shader', w / 2, h / 2 + 12);
    return;
  }
  g.addColorStop(0, '#312e81');
  g.addColorStop(1, '#0e7490');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('No classic visual — effects preview on a stand-in', w / 2, h / 2);
}

export default function EffectsPanel() {
  const surface = useStudioStore((s) => s.project?.surfaces.find((x) => x.id === s.selectedSurfaceId) ?? null);
  const updateSurface = useStudioStore((s) => s.updateSurface);
  const [effects, setEffects] = useState<EffectInstance[]>([]);
  const [addType, setAddType] = useState<string>(EFFECT_DEFS[0].id);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const effectsRef = useRef(effects);
  effectsRef.current = effects;
  const visualIdRef = useRef<string | undefined>(undefined);
  visualIdRef.current = surface?.content?.visualId;

  // Sync local stack when the selection changes.
  const surfaceId = surface?.id ?? null;
  useEffect(() => {
    setEffects(Array.isArray(surface?.effects) ? [...(surface.effects as EffectInstance[])] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceId]);

  // Debounced commit to the store.
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = (next: EffectInstance[]) => {
    if (!surface) return;
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      useStudioStore.getState().updateSurface(surface.id, { effects: next as never });
    }, 400);
  };
  useEffect(
    () => () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    [],
  );

  const setList = (next: EffectInstance[]) => {
    setEffects(next);
    commit(next);
  };

  const updateOne = (index: number, patch: Partial<EffectInstance>) => {
    const next = effects.map((e, i) => (i === index ? { ...e, ...patch } : e));
    setList(next);
  };

  const updateParam = (index: number, key: string, value: number | boolean | string) => {
    const e = effects[index];
    const next = effects.map((x, i) =>
      i === index ? { ...x, params: { ...(x.params ?? {}), [key]: value } } : x,
    );
    setList(next);
    void e;
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= effects.length) return;
    const next = [...effects];
    [next[index], next[target]] = [next[target], next[index]];
    setList(next);
  };

  // ---- live preview loop ----
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!sourceRef.current) {
      sourceRef.current = document.createElement('canvas');
      sourceRef.current.width = PREVIEW_W;
      sourceRef.current.height = PREVIEW_H;
    }
    const source = sourceRef.current;
    const sctx = source.getContext('2d');
    if (!sctx) return;
    let raf = 0;
    const start = performance.now();
    const loop = () => {
      const t = (performance.now() - start) / 1000;
      drawSourceThumbnail(sctx, PREVIEW_W, PREVIEW_H, visualIdRef.current, t);
      const result = applyEffects(source, effectsRef.current, t, 0.2);
      canvas.width = result.width;
      canvas.height = result.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(result, 0, 0);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!surface) {
    return <p className="text-xs text-zinc-500">Select a surface to edit its effects.</p>;
  }

  return (
    <div className="space-y-3 text-zinc-100">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Effects — {surface.name}
        </h3>
        <canvas
          ref={previewRef}
          width={PREVIEW_W}
          height={PREVIEW_H}
          className="block h-auto w-full rounded border border-zinc-800 bg-black"
          aria-label="Live effects preview"
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          Live preview: the selected surface&apos;s content run through the effect stack. Geometric
          effects (crop, kaleidoscope, tile) apply at full strength when enabled — their intensity
          slider is ignored; colour/filter effects blend by intensity.
        </p>
      </div>

      {effects.length === 0 && (
        <p className="text-xs text-zinc-500">No effects yet — add one below.</p>
      )}

      <ul className="space-y-2">
        {effects.map((fx, i) => {
          const def = getEffectDef(fx.type);
          if (!def) {
            return (
              <li key={`${fx.type}-${i}`} className="rounded border border-zinc-800 p-2 text-xs text-zinc-400">
                Unknown effect “{fx.type}” (kept as-is) —{' '}
                <button type="button" className="underline" onClick={() => setList(effects.filter((_, j) => j !== i))}>
                  remove
                </button>
              </li>
            );
          }
          const params = resolveEffectParams(fx);
          return (
            <li key={`${fx.type}-${i}`} className="space-y-2 rounded border border-zinc-800 p-2">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                  <input
                    type="checkbox"
                    checked={fx.enabled !== false}
                    onChange={(e) => updateOne(i, { enabled: e.target.checked })}
                    className="accent-amber-400"
                  />
                  {def.name}
                </label>
                <span className="flex-1" />
                <button
                  type="button"
                  aria-label="Move effect up"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Move effect down"
                  disabled={i === effects.length - 1}
                  onClick={() => move(i, 1)}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => updateOne(i, { params: defaultEffectParams(def), intensity: 1 })}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300"
                >
                  Reset
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${def.name}`}
                  onClick={() => setList(effects.filter((_, j) => j !== i))}
                  className="rounded border border-red-900 px-1.5 py-0.5 text-xs text-red-300"
                >
                  ✕
                </button>
              </div>
              <p className="text-[11px] text-zinc-500">{def.description}</p>
              <Slider
                label="Intensity"
                value={Math.round((fx.intensity ?? 1) * 100)}
                min={0}
                max={100}
                onChange={(v) => updateOne(i, { intensity: v / 100 })}
                format={(v) => `${v}%`}
              />
              {def.params.map((p) => {
                const v = params[p.key];
                if (p.type === 'boolean') {
                  return (
                    <label key={p.key} className="flex items-center gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={v === true}
                        onChange={(e) => updateParam(i, p.key, e.target.checked)}
                        className="accent-amber-400"
                      />
                      {p.label}
                    </label>
                  );
                }
                if (p.type === 'select') {
                  return (
                    <label key={p.key} className="block text-xs text-zinc-300">
                      {p.label}
                      <select
                        value={String(v ?? p.default)}
                        onChange={(e) => updateParam(i, p.key, e.target.value)}
                        className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                      >
                        {(p.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                }
                return (
                  <Slider
                    key={p.key}
                    label={p.label}
                    value={typeof v === 'number' ? v : Number(p.default)}
                    min={p.min ?? 0}
                    max={p.max ?? 100}
                    step={p.step ?? 1}
                    onChange={(val) => updateParam(i, p.key, val)}
                  />
                );
              })}
            </li>
          );
        })}
      </ul>

      <div className="flex gap-2">
        <select
          value={addType}
          onChange={(e) => setAddType(e.target.value)}
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
          aria-label="Effect to add"
        >
          {EFFECT_DEFS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={() => {
            const inst = createEffectInstance(addType);
            if (inst) setList([...effects, inst]);
          }}
        >
          + Add effect
        </Button>
      </div>
      <p className="text-[11px] text-zinc-500">
        Effects are stored on the surface and round-trip with the project. The projection engine
        applies them on stage (canvas sources, video and camera) before uploading the texture.
        Video/camera effects are rendered through a canvas copy of the frame.
      </p>
    </div>
  );
}
