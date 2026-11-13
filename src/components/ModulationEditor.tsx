// Modulation editor — Phase 4.
// LFO / envelope editor over the perform store's modulators: add/remove,
// waveform select, frequency slider or BPM-sync toggle + beats-per-cycle,
// amplitude / phase / offset sliders, target param select, live mini graph
// (one cycle drawn from the same pure functions the render loop uses),
// enable toggle. BPM comes from the studio store's playback state.
// The render loop consumes modulators via getModulatedValue(mod, time, bpm,
// baseValue) from src/lib/modulation.ts.
'use client';
import { useEffect, useRef } from 'react';
import { usePerformStore } from '../lib/performStore';
import { useStudioStore } from '../lib/store';
import {
  createModulator,
  drawModulatorGraph,
  getModulatedValue,
  type Modulator,
  type ModulatorTarget,
  type Waveform,
} from '../lib/modulation';
import { Button } from './ui/button';
import { Slider } from './ui/slider';

const WAVEFORMS: Waveform[] = ['sine', 'triangle', 'square', 'sawtooth', 'envelope'];
const TARGETS: ModulatorTarget[] = ['opacity', 'scale', 'hue', 'zoom', 'rotation', 'brightness'];

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function ModGraph({ mod, bpm }: { mod: Modulator; bpm: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawModulatorGraph(canvas, mod, bpm);
  }, [mod, bpm]);
  return <canvas ref={canvasRef} width={260} height={56} className="block h-auto w-full rounded border border-zinc-800 bg-black" aria-label={`Waveform preview: ${mod.waveform}`} />;
}

export default function ModulationEditor() {
  const modulators = usePerformStore((s) => s.modulators);
  const addModulator = usePerformStore((s) => s.addModulator);
  const updateModulator = usePerformStore((s) => s.updateModulator);
  const removeModulator = usePerformStore((s) => s.removeModulator);
  const bpm = useStudioStore((s) => s.playback.bpm);

  return (
    <div className="space-y-3 text-zinc-100">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">LFO / envelope modulators</h3>
        <span className="text-[11px] text-zinc-500">BPM {bpm} (from playback)</span>
      </div>

      {modulators.length === 0 && (
        <p className="text-xs text-zinc-500">
          No modulators yet. Add one to wobble a parameter over time — e.g. a slow sine on
          opacity, or a BPM-synced square on rotation.
        </p>
      )}

      <ul className="space-y-2">
        {modulators.map((mod) => (
          <li key={mod.id} className="space-y-2 rounded border border-zinc-800 p-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={mod.enabled}
                  onChange={(e) => updateModulator(mod.id, { enabled: e.target.checked })}
                  className="accent-amber-400"
                />
                <select
                  value={mod.waveform}
                  onChange={(e) => updateModulator(mod.id, { waveform: e.target.value as Waveform })}
                  className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                  aria-label="Waveform"
                >
                  {WAVEFORMS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                →
                <select
                  value={mod.target}
                  onChange={(e) => updateModulator(mod.id, { target: e.target.value as ModulatorTarget })}
                  className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                  aria-label="Target parameter"
                >
                  {TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <span className="flex-1" />
              <span className="text-[11px] text-zinc-400" title="Value at t = now, base 1">
                live: {getModulatedValue(mod, performance.now() / 1000, bpm, 1).toFixed(2)}
              </span>
              <button
                type="button"
                aria-label="Remove modulator"
                onClick={() => removeModulator(mod.id)}
                className="rounded border border-red-900 px-1.5 py-0.5 text-xs text-red-300"
              >
                ✕
              </button>
            </div>

            <ModGraph mod={mod} bpm={bpm} />

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={mod.bpmSync}
                  onChange={(e) => updateModulator(mod.id, { bpmSync: e.target.checked })}
                  className="accent-amber-400"
                />
                BPM sync
              </label>
              {mod.bpmSync ? (
                <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                  Beats / cycle
                  <input
                    type="number"
                    min={0.25}
                    max={32}
                    step={0.25}
                    value={mod.beatsPerCycle}
                    onChange={(e) => updateModulator(mod.id, { beatsPerCycle: Math.min(32, Math.max(0.25, Number(e.target.value) || 1)) })}
                    className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                  />
                </label>
              ) : (
                <span className="flex-1">
                  <Slider
                    label="Frequency (Hz)"
                    value={Math.round(mod.frequency * 100) / 100}
                    min={0.01}
                    max={5}
                    step={0.01}
                    onChange={(v) => updateModulator(mod.id, { frequency: v })}
                  />
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Slider label="Amplitude" value={mod.amplitude} min={0} max={2} step={0.01} onChange={(v) => updateModulator(mod.id, { amplitude: v })} />
              <Slider label="Phase" value={mod.phase} min={0} max={1} step={0.01} onChange={(v) => updateModulator(mod.id, { phase: v })} />
              <Slider label="Offset" value={mod.offset} min={-1} max={1} step={0.01} onChange={(v) => updateModulator(mod.id, { offset: v })} />
            </div>

            {mod.waveform === 'envelope' && (
              <div className="grid grid-cols-2 gap-3">
                <Slider label="Attack (s)" value={mod.attack ?? 0.1} min={0.01} max={2} step={0.01} onChange={(v) => updateModulator(mod.id, { attack: v })} />
                <Slider label="Decay (s)" value={mod.decay ?? 0.3} min={0.01} max={2} step={0.01} onChange={(v) => updateModulator(mod.id, { decay: v })} />
                <Slider label="Sustain" value={mod.sustain ?? 0.7} min={0} max={1} step={0.01} onChange={(v) => updateModulator(mod.id, { sustain: v })} />
                <Slider label="Release (s)" value={mod.release ?? 0.4} min={0.01} max={2} step={0.01} onChange={(v) => updateModulator(mod.id, { release: v })} />
              </div>
            )}

            <label className="block text-xs text-zinc-300">
              Surface
              <select
                value={mod.surfaceId ?? 'selected'}
                onChange={(e) => updateModulator(mod.id, { surfaceId: e.target.value as Modulator['surfaceId'] })}
                className="mt-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
              >
                <option value="selected">selected surface</option>
                {(useStudioStore.getState().project?.surfaces ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>

      <Button
        variant="outline"
        size="sm"
        onClick={() => addModulator(createModulator({ id: uid('mod') }))}
      >
        + Add modulator
      </Button>
      <p className="text-[11px] text-zinc-500">
        The render loop consumes modulators with getModulatedValue(mod, time, bpm, baseValue)
        from src/lib/modulation.ts. Modulators are session-only (not saved to the project).
      </p>
    </div>
  );
}
