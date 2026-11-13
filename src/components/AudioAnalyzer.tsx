// Audio analyzer — Phase 4.
// Source select (mic / audio file / project track), start/stop, live
// waveform + frequency-bars canvases, band meters, beat flash, sensitivity +
// smoothing sliders, and audio→parameter mapping rows stored in the
// perform store. Levels are pushed to the perform store at ~15 Hz (not per
// frame) to avoid re-renders. The engine is created only when the user
// presses Start — nothing here touches audio at load time.
//
// Mappings drive values via getAudioModulations(levels, mappings) from
// src/lib/audio.ts (re-exported here). Phase 5 call site: inside the render
// loop, call getAudioModulations(usePerformStore.getState().audioLevels ?? ...,
// usePerformStore.getState().audioMappings) — or pass the engine's live
// levels directly — and apply the returned scale/rotation/brightness/
// particles/opacity/speed to the surface being drawn.
'use client';
import { useEffect, useRef, useState } from 'react';
import {
  AudioEngineError,
  createAudioEngine,
  getAudioModulations,
  mapBandToParam,
  type AudioEngine,
  type AudioLevels,
  type AudioMapping,
  type AudioSourceKind,
} from '../lib/audio';
import { usePerformStore } from '../lib/performStore';
import { registerAudioEngine } from '../lib/audioBus';
import { Button } from './ui/button';
import { Slider } from './ui/slider';

export { getAudioModulations, mapBandToParam };
export type { AudioLevels, AudioMapping };

const TARGETS: AudioMapping['target'][] = ['scale', 'rotation', 'brightness', 'particles', 'opacity', 'speed'];
const SOURCES: AudioMapping['source'][] = ['bass', 'mid', 'high', 'amplitude', 'beat'];

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function AudioAnalyzer({ audioElement }: { audioElement?: HTMLAudioElement | null }) {
  const [sourceKind, setSourceKind] = useState<'mic' | 'file' | 'track'>('mic');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState(1);
  const [smoothing, setSmoothing] = useState(0.7);
  const [levels, setLevels] = useState<AudioLevels | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const engineRef = useRef<AudioEngine | null>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const freqRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastPushRef = useRef(0);

  const mappings = usePerformStore((s) => s.audioMappings);
  const updateAudioMapping = usePerformStore((s) => s.updateAudioMapping);
  const addAudioMapping = usePerformStore((s) => s.addAudioMapping);
  const removeAudioMapping = usePerformStore((s) => s.removeAudioMapping);
  const setAudioLevels = usePerformStore((s) => s.setAudioLevels);

  const getEngine = (): AudioEngine => {
    if (!engineRef.current) {
      engineRef.current = createAudioEngine({ sensitivity, smoothing });
      // Let the render loop read live levels (Phase 5 integration).
      registerAudioEngine(engineRef.current);
    }
    return engineRef.current;
  };

  // Live drawing loop — runs only while the engine is running.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      const engine = engineRef.current;
      if (!engine) return;
      const lv = engine.getLevels();
      const now = performance.now();
      if (now - lastPushRef.current > 66) {
        lastPushRef.current = now;
        setLevels(lv);
        setAudioLevels(lv);
      }
      const wave = waveRef.current?.getContext('2d');
      if (wave && waveRef.current) {
        const c = waveRef.current;
        wave.clearRect(0, 0, c.width, c.height);
        wave.fillStyle = '#09090b';
        wave.fillRect(0, 0, c.width, c.height);
        wave.strokeStyle = '#f59e0b';
        wave.lineWidth = 1.5;
        wave.beginPath();
        for (let x = 0; x < c.width; x++) {
          const idx = Math.floor((x / c.width) * lv.waveform.length);
          const y = (lv.waveform[idx] / 255) * c.height;
          if (x === 0) wave.moveTo(x, y);
          else wave.lineTo(x, y);
        }
        wave.stroke();
      }
      const freq = freqRef.current?.getContext('2d');
      if (freq && freqRef.current) {
        const c = freqRef.current;
        freq.clearRect(0, 0, c.width, c.height);
        freq.fillStyle = '#09090b';
        freq.fillRect(0, 0, c.width, c.height);
        const bars = 48;
        const bw = c.width / bars;
        for (let i = 0; i < bars; i++) {
          const idx = Math.floor((i / bars) * lv.frequency.length);
          const v = lv.frequency[idx] / 255;
          freq.fillStyle = `hsl(${200 - v * 160} 90% 55%)`;
          freq.fillRect(i * bw + 1, c.height - v * c.height, bw - 2, v * c.height);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, setAudioLevels]);

  useEffect(
    () => () => {
      engineRef.current?.dispose();
      engineRef.current = null;
      registerAudioEngine(null);
    },
    [],
  );

  const start = async (file?: File) => {
    setError(null);
    const engine = getEngine();
    engine.setSensitivity(sensitivity);
    engine.setSmoothing(smoothing);
    try {
      if (sourceKind === 'mic') {
        await engine.startMic();
      } else if (sourceKind === 'file') {
        const f = file ?? fileInputRef.current?.files?.[0];
        if (!f) {
          setError('Choose an audio file first.');
          return;
        }
        setFileName(f.name);
        await engine.startFile(f);
      } else {
        const el = audioElement ?? document.querySelector<HTMLAudioElement>('audio[data-project-track]');
        if (!el) {
          setError('No project audio track element found. Pass an <audio> element to AudioAnalyzer or mark one with data-project-track.');
          return;
        }
        await engine.startTrack(el);
      }
      setRunning(true);
    } catch (err) {
      if (err instanceof AudioEngineError) setError(`${err.code}: ${err.message}`);
      else setError(`Audio failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const stop = () => {
    engineRef.current?.stop();
    registerAudioEngine(null);
    setRunning(false);
    setLevels(null);
  };

  const meter = (label: string, value: number) => (
    <div>
      <div className="flex justify-between text-[11px] text-zinc-400">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-zinc-800">
        <div className="h-full bg-amber-400 transition-[width] duration-75" style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );

  return (
    <div className="space-y-3 text-zinc-100">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Audio analyzer</h3>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sourceKind}
          onChange={(e) => setSourceKind(e.target.value as 'mic' | 'file' | 'track')}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
          aria-label="Audio source"
        >
          <option value="mic">Microphone</option>
          <option value="file">Audio file</option>
          <option value="track">Project track</option>
        </select>
        {sourceKind === 'file' && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void start(f);
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              {fileName ? `Change file (${fileName})` : 'Choose audio file…'}
            </Button>
          </>
        )}
        {running ? (
          <Button variant="destructive" size="sm" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={() => void start()}>
            Start {sourceKind === 'mic' ? 'microphone' : sourceKind === 'file' ? 'file' : 'project track'}
          </Button>
        )}
        <span className={`inline-flex items-center gap-1.5 text-xs ${running ? 'text-emerald-300' : 'text-zinc-500'}`}>
          <span className={`h-2 w-2 rounded-full ${running ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          {running ? 'Listening' : 'Stopped'}
        </span>
        <span
          aria-label="Beat indicator"
          className={`rounded px-2 py-0.5 text-xs font-semibold ${levels?.beat ? 'bg-amber-400 text-black' : 'bg-zinc-800 text-zinc-400'}`}
          title={levels?.beat ? 'Beat detected' : 'No beat on this frame'}
        >
          ♪ BEAT
        </span>
      </div>

      {error && (
        <p className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] text-zinc-500">Waveform</p>
          <canvas ref={waveRef} width={320} height={80} className="block h-auto w-full rounded border border-zinc-800 bg-black" />
        </div>
        <div>
          <p className="mb-1 text-[11px] text-zinc-500">Frequency</p>
          <canvas ref={freqRef} width={320} height={80} className="block h-auto w-full rounded border border-zinc-800 bg-black" />
        </div>
      </div>

      <div className="space-y-1.5">
        {meter('Bass', levels?.bass ?? 0)}
        {meter('Mid', levels?.mid ?? 0)}
        {meter('High', levels?.high ?? 0)}
        {meter('Amplitude', levels?.amplitude ?? 0)}
        {meter('Beat strength', levels?.beatStrength ?? 0)}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Slider
          label="Sensitivity"
          value={Math.round(sensitivity * 100)}
          min={10}
          max={300}
          onChange={(v) => {
            const s = v / 100;
            setSensitivity(s);
            engineRef.current?.setSensitivity(s);
          }}
          format={(v) => `${v}%`}
        />
        <Slider
          label="Smoothing"
          value={Math.round(smoothing * 100)}
          min={0}
          max={95}
          onChange={(v) => {
            const s = v / 100;
            setSmoothing(s);
            engineRef.current?.setSmoothing(s);
          }}
          format={(v) => `${v}%`}
        />
      </div>

      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Audio → parameter mappings
        </h4>
        <ul className="space-y-2">
          {mappings.map((m) => (
            <li key={m.id} className="space-y-2 rounded border border-zinc-800 p-2">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-zinc-200">
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    onChange={(e) => updateAudioMapping(m.id, { enabled: e.target.checked })}
                    className="accent-amber-400"
                  />
                  <select
                    value={m.source}
                    onChange={(e) => updateAudioMapping(m.id, { source: e.target.value as AudioMapping['source'] })}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                    aria-label="Audio band"
                  >
                    {SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  →
                  <select
                    value={m.target}
                    onChange={(e) => updateAudioMapping(m.id, { target: e.target.value as AudioMapping['target'] })}
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
                <span className="text-[11px] text-zinc-400">
                  now: {levels ? mapBandToParam(m.source === 'beat' ? (levels.beat ? 1 : levels.beatStrength) : levels[m.source], m.min, m.max, 1).toFixed(2) : '—'}
                </span>
                <button
                  type="button"
                  aria-label="Remove mapping"
                  onClick={() => removeAudioMapping(m.id)}
                  className="rounded border border-red-900 px-1.5 py-0.5 text-xs text-red-300"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Slider label="Min" value={m.min} min={-2} max={3} step={0.05} onChange={(v) => updateAudioMapping(m.id, { min: v })} />
                <Slider label="Max" value={m.max} min={-2} max={3} step={0.05} onChange={(v) => updateAudioMapping(m.id, { max: v })} />
              </div>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() =>
            addAudioMapping({ id: uid('map'), source: 'bass', target: 'scale', enabled: true, min: 0.9, max: 1.3 })
          }
        >
          + Add mapping
        </Button>
        <p className="mt-2 text-[11px] text-zinc-500">
          Mappings are consumed by getAudioModulations(levels, mappings) — see the Phase 5 call site
          documented in src/lib/audio.ts. Defaults: Bass → Scale, Beat → Rotation (off), High →
          Particle intensity, Amplitude → Brightness.
        </p>
      </section>
    </div>
  );
}
