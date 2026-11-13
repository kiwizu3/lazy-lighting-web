// Performance mode — Phase 5.
// Full-screen, editing panels hidden, same WebGL engine (ProjectionCanvas
// in read-only mode). Scene switching via on-screen buttons, number keys
// 1–9 (Space play/pause and Esc exit are the global shortcuts), MIDI note
// mappings, and a compact live-tweak strip (master brightness / speed plus
// the selected surface's shader params — transient perform-store overrides,
// never written to the project). Fullscreen via the Fullscreen API;
// "Open output window" opens /output in a new window, synced over the
// existing BroadcastChannel.
'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useStudioStore } from '../lib/store';
import { usePerformStore } from '../lib/performStore';
import { getShaderVisual, type ShaderParams } from '../lib/shaders';
import { switchSceneWithTransition } from '../lib/sceneTransition';
import { Button } from './ui/button';
import { Slider } from './ui/slider';

const ProjectionCanvas = dynamic(() => import('./ProjectionCanvas'), { ssr: false });

const PARAMS: { key: keyof ShaderParams; label: string; min: number; max: number; step: number }[] = [
  { key: 'speed', label: 'Speed', min: 0, max: 3, step: 0.05 },
  { key: 'scale', label: 'Scale', min: 0.2, max: 3, step: 0.05 },
  { key: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.05 },
  { key: 'density', label: 'Density', min: 0.2, max: 3, step: 0.05 },
  { key: 'rotation', label: 'Rotation', min: -3.14, max: 3.14, step: 0.05 },
  { key: 'distortion', label: 'Distortion', min: 0, max: 1, step: 0.05 },
];

export default function PerformanceMode() {
  const project = useStudioStore((s) => s.project);
  const scenes = project?.scenes ?? [];
  const currentSceneId = project?.timeline.currentSceneId ?? null;
  const playing = useStudioStore((s) => s.playback.playing);
  const selectedSurface = useStudioStore((s) => s.project?.surfaces.find((x) => x.id === s.selectedSurfaceId) ?? null);
  const masterBrightness = usePerformStore((s) => s.masterBrightness);
  const masterSpeed = usePerformStore((s) => s.masterSpeed);
  const visualOverrides = usePerformStore((s) => s.visualParamOverrides);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Number keys 1–9 switch scenes. (Space = play/pause and Esc = exit are
  // the global shortcuts in src/lib/shortcuts.ts — not duplicated here.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 9) {
        const scene = useStudioStore.getState().project?.scenes[n - 1];
        if (scene) switchSceneWithTransition(scene.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const shader = selectedSurface?.content?.visualId ? getShaderVisual(selectedSurface.content.visualId) : undefined;
  const shaderParams: ShaderParams | null = shader
    ? {
        ...shader.defaults,
        ...((selectedSurface?.content as unknown as { params?: Partial<ShaderParams> }).params ?? {}),
        ...(selectedSurface ? visualOverrides[selectedSurface.id] ?? {} : {}),
      }
    : null;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-zinc-100" data-testid="performance-mode">
      <div className="min-h-0 flex-1">
        <ProjectionCanvas creationMode={null} onCreationModeChange={() => undefined} readOnly syncTime={false} />
      </div>

      {/* Scene buttons */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800 bg-zinc-950 px-3 py-2">
        {scenes.length === 0 && <span className="text-xs text-zinc-500">No scenes — create scenes in the studio to switch between them here.</span>}
        {scenes.slice(0, 9).map((scene, i) => (
          <Button
            key={scene.id}
            size="sm"
            variant={scene.id === currentSceneId ? 'default' : 'outline'}
            onClick={() => switchSceneWithTransition(scene.id)}
            title={`Switch to ${scene.name} (key ${i + 1})`}
          >
            {i + 1} · {scene.name}
          </Button>
        ))}
        <span className="flex-1" />
        <Button size="sm" variant={playing ? 'secondary' : 'default'} onClick={() => useStudioStore.getState().setPlaying(!playing)}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </Button>
        <Button size="sm" variant="outline" onClick={toggleFullscreen}>
          {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.open('/output', '_blank', 'noopener')}>
          Open output window ↗
        </Button>
        <Button size="sm" variant="outline" onClick={() => useStudioStore.getState().setPerformanceMode(false)}>
          Exit performance (Esc)
        </Button>
      </div>

      {/* Live tweak strip */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2 border-t border-zinc-800 bg-zinc-950 px-3 py-2">
        <span className="w-40">
          <Slider label="Master brightness" value={Math.round(masterBrightness * 100)} min={0} max={200} onChange={(v) => usePerformStore.getState().setMasterBrightness(v / 100)} format={(v) => `${v}%`} />
        </span>
        <span className="w-40">
          <Slider label="Master speed" value={Math.round(masterSpeed * 100)} min={10} max={400} onChange={(v) => usePerformStore.getState().setMasterSpeed(v / 100)} format={(v) => `${(v / 100).toFixed(2)}×`} />
        </span>
        {shader && shaderParams && selectedSurface ? (
          <>
            <span className="text-xs text-zinc-400">
              {selectedSurface.name} · {shader.name} <span className="text-zinc-600">(live tweaks, not saved)</span>
            </span>
            {PARAMS.map((p) => (
              <span key={p.key} className="w-32">
                <Slider
                  label={p.label}
                  value={Math.round((shaderParams[p.key] as number) * 100) / 100}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  onChange={(v) => usePerformStore.getState().setVisualParamOverride(selectedSurface.id, { [p.key]: v })}
                />
              </span>
            ))}
          </>
        ) : (
          <span className="text-xs text-zinc-500">
            {selectedSurface ? 'Selected surface has no shader visual — pick a shader visual in the studio to tweak it live here.' : 'Select a surface in the studio to tweak its shader live here.'}
          </span>
        )}
      </div>

      <p className="border-t border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[11px] text-zinc-500">
        Keys 1–9 switch scenes · Space play/pause · Esc exit. A browser cannot guarantee native
        external-display routing or keep playback running after the browser is closed — move the
        output window to your projector display and fullscreen it.
      </p>
    </div>
  );
}
