// Visual library — Phase 4.
// Two tabs: shader visuals (live WebGL preview) and the 64 classic canvas
// visuals from src/lib/visuals.ts (static canvas thumbnails).
//
// Preview approach: ONE shared live preview pane (a single WebGL canvas +
// requestAnimationFrame through ShaderPreview) plus static CSS-gradient
// thumbnails on the cards. Per-card live WebGL canvases were rejected:
// 19+ simultaneous contexts would thrash the GPU and hit browser context
// limits. The selected shader renders live in the preview pane; the card
// thumbnails are labelled as static.
//
// Writing to a surface: choosing a shader / preset / parameter change writes
// content { kind: 'visual', visualId: <shader id>, params, colors: [c1, c2] }
// to the selected surface via the store (debounced 400 ms so slider drags
// don't flood the undo stack). The projection engine renders shader visuals
// on stage via the shared GLSL stage renderer (Phase 5).
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SHADER_CATEGORIES,
  SHADER_VISUALS,
  VISUAL_PRESETS,
  ShaderPreview,
  getShaderVisual,
  type ShaderParams,
  type ShaderVisual,
} from '../lib/shaders';
import { VISUALS, getVisual } from '../lib/visuals';
import { useStudioStore } from '../lib/store';
import { usePerformStore } from '../lib/performStore';
import ColorPicker from './ColorPicker';
import { Button } from './ui/button';
import { Slider } from './ui/slider';

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <Slider
      label={label}
      value={Math.round(value * 100) / 100}
      min={min}
      max={max}
      step={step}
      onChange={onChange}
      format={format ?? ((v) => String(Math.round(v * 100) / 100))}
    />
  );
}

function ClassicCard({
  id,
  onApply,
  applied,
}: {
  id: string;
  onApply: (id: string) => void;
  applied: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visual = getVisual(id);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    try {
      visual.draw(ctx, canvas.width, canvas.height, 1.2, {
        audioLevel: 0.3,
        hueShift: 0,
        speed: 1,
        colors: ['#f59e0b', '#06b6d4'],
      });
    } catch {
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return (
    <button
      type="button"
      onClick={() => onApply(id)}
      className={`overflow-hidden rounded border text-left ${applied ? 'border-amber-400 ring-1 ring-amber-400' : 'border-zinc-800 hover:border-zinc-600'}`}
      title={`${visual.name} — ${visual.category}`}
    >
      <canvas ref={canvasRef} width={160} height={90} className="block h-auto w-full" />
      <span className="block truncate px-1.5 py-1 text-[11px] text-zinc-200">{visual.name}</span>
      <span className="block px-1.5 pb-1 text-[10px] text-zinc-500">{visual.category}</span>
    </button>
  );
}

export default function VisualLibrary() {
  const [tab, setTab] = useState<'shaders' | 'classic'>('shaders');
  const [category, setCategory] = useState<string>('All');
  const [shaderId, setShaderId] = useState<string>(SHADER_VISUALS[0].id);
  const [params, setParams] = useState<ShaderParams>({ ...SHADER_VISUALS[0].defaults });
  const [liveApply, setLiveApply] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [appliedNote, setAppliedNote] = useState<string | null>(null);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const previewObjRef = useRef<ShaderPreview | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const shaderRef = useRef<ShaderVisual>(SHADER_VISUALS[0]);

  const selectedSurface = useStudioStore((s) => s.project?.surfaces.find((x) => x.id === s.selectedSurfaceId) ?? null);
  const updateSurface = useStudioStore((s) => s.updateSurface);
  const audioAmplitude = usePerformStore((s) => s.audioLevels?.amplitude ?? 0);
  const audioRef = useRef(0);
  audioRef.current = audioAmplitude;
  const setSelectedPreset = usePerformStore((s) => s.setSelectedPreset);

  const shader = useMemo(() => getShaderVisual(shaderId) ?? SHADER_VISUALS[0], [shaderId]);

  // ---- live preview loop (single WebGL canvas) ----
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || tab !== 'shaders') return;
    const preview = new ShaderPreview(canvas);
    previewObjRef.current = preview;
    if (preview.error) {
      setPreviewError(preview.error);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const loop = () => {
      const t = (performance.now() - start) / 1000;
      if (preview.shaderId !== shaderRef.current.id) {
        if (!preview.setShader(shaderRef.current)) {
          setPreviewError(preview.error ?? 'Shader failed to compile');
          return;
        }
        setPreviewError(null);
      }
      preview.render(t, paramsRef.current, audioRef.current);
      raf = requestAnimationFrame(loop);
    };
    if (!preview.setShader(shaderRef.current)) {
      setPreviewError(preview.error ?? 'Shader failed to compile');
    } else {
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      preview.dispose();
      previewObjRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Keep the preview's shader in sync when the selection changes.
  useEffect(() => {
    shaderRef.current = shader;
  }, [shader]);

  // ---- write to the selected surface (debounced) ----
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeToSurface = useCallback(
    (id: string, p: ShaderParams) => {
      const surface = useStudioStore.getState().project?.surfaces.find(
        (x) => x.id === useStudioStore.getState().selectedSurfaceId,
      );
      if (!surface) return;
      useStudioStore.getState().updateSurface(surface.id, {
        content: {
          ...surface.content,
          kind: 'visual',
          visualId: id,
          params: { ...p },
          colors: [p.color1, p.color2],
        },
      });
      setAppliedNote(`Applied “${getShaderVisual(id)?.name ?? id}” to “${surface.name}”.`);
    },
    [],
  );

  const scheduleWrite = useCallback(
    (id: string, p: ShaderParams) => {
      if (!liveApply) return;
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => writeToSurface(id, p), 400);
    },
    [liveApply, writeToSurface],
  );

  useEffect(
    () => () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    [],
  );

  const selectShader = (id: string, p?: ShaderParams) => {
    const v = getShaderVisual(id);
    if (!v) return;
    const next = p ?? { ...v.defaults };
    setShaderId(id);
    setParams(next);
    scheduleWrite(id, next);
  };

  const setParam = <K extends keyof ShaderParams>(key: K, value: ShaderParams[K]) => {
    const next = { ...params, [key]: value };
    setParams(next);
    scheduleWrite(shaderId, next);
  };

  const applyPreset = (presetId: string) => {
    const preset = VISUAL_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPreset(presetId);
    selectShader(preset.shaderId, { ...preset.params });
  };

  const applyClassic = (id: string) => {
    if (!selectedSurface) {
      setAppliedNote('Select a surface first — then click a visual to apply it.');
      return;
    }
    updateSurface(selectedSurface.id, {
      content: { ...selectedSurface.content, kind: 'visual', visualId: id },
    });
    setAppliedNote(`Applied classic visual “${getVisual(id).name}” to “${selectedSurface.name}”.`);
  };

  const visibleShaders = category === 'All' ? SHADER_VISUALS : SHADER_VISUALS.filter((v) => v.category === category);

  return (
    <div className="space-y-4 text-zinc-100">
      <div className="flex gap-2">
        <Button variant={tab === 'shaders' ? 'default' : 'outline'} size="sm" onClick={() => setTab('shaders')}>
          Shader visuals ({SHADER_VISUALS.length})
        </Button>
        <Button variant={tab === 'classic' ? 'default' : 'outline'} size="sm" onClick={() => setTab('classic')}>
          Classic canvas visuals ({VISUALS.length})
        </Button>
      </div>

      {tab === 'shaders' && (
        <>
          {/* Presets */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Presets — one click</h3>
            <div className="flex flex-wrap gap-1.5">
              {VISUAL_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:border-amber-400 hover:text-amber-300"
                  style={{ background: `linear-gradient(135deg, ${p.params.color1}, ${p.params.color2})` }}
                  title={`${p.name} — ${getShaderVisual(p.shaderId)?.name ?? ''}`}
                >
                  <span className="rounded bg-black/55 px-1 py-0.5">{p.name}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Live preview */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Live preview — {shader.name} <span className="normal-case text-zinc-500">({shader.category})</span>
            </h3>
            {previewError ? (
              <p className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300" role="alert">
                Live preview unavailable: {previewError}
              </p>
            ) : (
              <canvas
                ref={previewRef}
                width={640}
                height={360}
                className="block h-auto w-full rounded border border-zinc-800 bg-black"
                aria-label={`Live preview of ${shader.name}`}
              />
            )}
            <p className="mt-1 text-[11px] text-zinc-500">
              Audio-reactive shaders use the live audio level when the Audio Analyzer is running.
            </p>
          </section>

          {/* Parameters */}
          <section className="space-y-3 rounded border border-zinc-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Parameters</h3>
              <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={liveApply}
                  onChange={(e) => setLiveApply(e.target.checked)}
                  className="accent-amber-400"
                />
                Apply to selected surface
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ColorPicker label="Colour 1" value={params.color1} onChange={(c) => setParam('color1', c)} />
              <ColorPicker label="Colour 2" value={params.color2} onChange={(c) => setParam('color2', c)} />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <ParamSlider label="Speed" value={params.speed} min={0} max={3} step={0.05} onChange={(v) => setParam('speed', v)} />
              <ParamSlider label="Scale" value={params.scale} min={0.2} max={3} step={0.05} onChange={(v) => setParam('scale', v)} />
              <ParamSlider label="Intensity" value={params.intensity} min={0} max={2} step={0.05} onChange={(v) => setParam('intensity', v)} />
              <ParamSlider label="Density" value={params.density} min={0.2} max={3} step={0.05} onChange={(v) => setParam('density', v)} />
              <ParamSlider label="Rotation" value={params.rotation} min={-3.14} max={3.14} step={0.05} onChange={(v) => setParam('rotation', v)} format={(v) => `${Math.round((v * 180) / Math.PI)}°`} />
              <ParamSlider label="Distortion" value={params.distortion} min={0} max={1} step={0.05} onChange={(v) => setParam('distortion', v)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => writeToSurface(shaderId, params)}
                disabled={!selectedSurface}
              >
                Apply “{shader.name}” to selected surface
              </Button>
              <Button variant="outline" size="sm" onClick={() => selectShader(shaderId)}>
                Reset to defaults
              </Button>
            </div>
            {!selectedSurface && (
              <p className="text-[11px] text-zinc-500">No surface selected — parameters still edit the preview, but nothing is written to the project.</p>
            )}
            <p className="text-[11px] text-zinc-500">
              Shader visuals render live on the projection stage (Phase 5 wiring) as well as here.
            </p>
          </section>

          {/* Browser grid */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Browse shaders</h3>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                aria-label="Filter by category"
              >
                <option>All</option>
                {SHADER_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visibleShaders.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => selectShader(v.id)}
                  className={`overflow-hidden rounded border text-left ${v.id === shaderId ? 'border-amber-400 ring-1 ring-amber-400' : 'border-zinc-800 hover:border-zinc-600'}`}
                >
                  <div
                    className="flex h-16 items-end p-1.5"
                    style={{ background: `linear-gradient(135deg, ${v.defaults.color1}, ${v.defaults.color2})` }}
                    title="Static thumbnail — see the live preview above"
                  >
                    <span className="rounded bg-black/55 px-1 py-0.5 text-[10px] text-zinc-100">static thumbnail</span>
                  </div>
                  <span className="block truncate px-1.5 pt-1 text-[11px] text-zinc-200">{v.name}</span>
                  <span className="block px-1.5 pb-1 text-[10px] text-zinc-500">{v.category}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {tab === 'classic' && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Classic canvas visuals — click to apply to the selected surface
          </h3>
          {!selectedSurface && <p className="mb-2 text-[11px] text-zinc-500">No surface selected — click a visual after selecting a surface.</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {VISUALS.map((v) => (
              <ClassicCard
                key={v.id}
                id={v.id}
                onApply={applyClassic}
                applied={selectedSurface?.content?.visualId === v.id}
              />
            ))}
          </div>
        </section>
      )}

      {appliedNote && (
        <p className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-300" role="status">
          {appliedNote}
          <button type="button" className="ml-2 underline" onClick={() => setAppliedNote(null)}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
