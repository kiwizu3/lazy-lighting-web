// MIDI controller — Phase 4, Phase 5: subscription moved to the shared
// midiBus (src/lib/midiBus.ts) so the panel and the render loop never fight
// over input.onmidimessage. This panel shows the signal + learn + mappings;
// the render loop (ProjectionCanvas) applies non-scene targets to live
// values and scene targets to scene switches.
'use client';
import { useEffect, useRef, useState } from 'react';
import {
  MidiError,
  applyMidiMessage,
  type MidiInputInfo,
  type MidiMapping,
  type MidiMessage,
  type MidiTarget,
} from '../lib/midi';
import { connectMidiBus, getMidiBusInputs, selectMidiBusInput, subscribeMidiBus } from '../lib/midiBus';
import { usePerformStore } from '../lib/performStore';
import { useStudioStore } from '../lib/store';
import { Button } from './ui/button';

const TARGETS: MidiTarget[] = ['brightness', 'opacity', 'speed', 'scale', 'rotation', 'effectIntensity', 'scene', 'playback'];

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function describeMessage(msg: MidiMessage): string {
  const kind = msg.type === 'cc' ? `CC ${msg.control}` : msg.type === 'noteon' ? `Note ${msg.control} on` : `Note ${msg.control} off`;
  return `CH${msg.channel} ${kind} = ${msg.value}`;
}

export default function MidiController() {
  const [supported] = useState(() => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator);
  const [connected, setConnected] = useState(false);
  const [inputs, setInputs] = useState<MidiInputInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<MidiMessage | null>(null);
  const [log, setLog] = useState<{ msg: MidiMessage; at: number }[]>([]);
  const [learnId, setLearnId] = useState<string | null>(null);
  const [lastUpdates, setLastUpdates] = useState<string[]>([]);

  const learnIdRef = useRef<string | null>(null);
  learnIdRef.current = learnId;

  const mappings = usePerformStore((s) => s.midiMappings);
  const addMidiMapping = usePerformStore((s) => s.addMidiMapping);
  const updateMidiMapping = usePerformStore((s) => s.updateMidiMapping);
  const removeMidiMapping = usePerformStore((s) => s.removeMidiMapping);
  const scenes = useStudioStore((s) => s.project?.scenes ?? []);

  const refreshInputs = () => {
    setInputs(getMidiBusInputs());
  };

  const connect = async () => {
    setError(null);
    try {
      const list = await connectMidiBus();
      setConnected(true);
      setInputs(list);
    } catch (err) {
      if (err instanceof MidiError) setError(`${err.code}: ${err.message}`);
      else setError(`MIDI failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // One bus listener for display + learn. Applying updates (live values,
  // scene switches, playback) is the render loop's job (ProjectionCanvas);
  // this panel only reports what the message mapped to.
  useEffect(() => {
    const unsubscribe = subscribeMidiBus((msg) => {
      setLastMessage(msg);
      setLog((prev) => [{ msg, at: Date.now() }, ...prev].slice(0, 50));
      // MIDI learn: bind the first CC/note that arrives.
      const pending = learnIdRef.current;
      if (pending) {
        const isNote = msg.type !== 'cc';
        updateMidiMapping(pending, {
          midiType: isNote ? 'note' : 'cc',
          channel: msg.channel,
          control: msg.control,
        });
        setLearnId(null);
        return;
      }
      const updates = applyMidiMessage(msg, usePerformStore.getState().midiMappings);
      if (updates.length > 0) {
        setLastUpdates(
          updates.map((u) =>
            u.target === 'scene'
              ? `scene → ${u.sceneId ?? '(no scene)'}`
              : `${u.target} → ${u.value.toFixed(2)}${u.surfaceId ? ` (${u.surfaceId})` : ''}`,
          ),
        );
      }
    });
    return unsubscribe;
  }, [updateMidiMapping]);

  if (!supported) {
    return (
      <div className="space-y-2 text-zinc-100">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">MIDI controller</h3>
        <p className="rounded border border-amber-900 bg-amber-950/50 px-3 py-2 text-xs text-amber-200" role="status">
          MIDI is not supported in this browser. Use Chrome or Edge on desktop for Web MIDI.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-zinc-100">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">MIDI controller</h3>

      <div className="flex flex-wrap items-center gap-2">
        {!connected ? (
          <Button size="sm" onClick={() => void connect()}>
            Connect MIDI
          </Button>
        ) : (
          <>
            <select
              value={selectedInputId ?? ''}
              onChange={(e) => {
                const id = e.target.value || null;
                setSelectedInputId(id);
                selectMidiBusInput(id);
              }}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
              aria-label="MIDI input device"
            >
              <option value="">Select a device…</option>
              {inputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.manufacturer ? ` (${d.manufacturer})` : ''}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={refreshInputs}>
              Refresh
            </Button>
          </>
        )}
        <span className={`text-xs ${connected ? 'text-emerald-300' : 'text-zinc-500'}`}>
          {connected ? (selectedInputId ? 'Listening' : 'Connected — pick a device') : 'Not connected'}
        </span>
      </div>

      {error && (
        <p className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}

      {connected && inputs.length === 0 && (
        <p className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-300" role="status">
          No MIDI devices found — connect a controller and click Refresh.
        </p>
      )}

      {/* Live signal */}
      <section className="rounded border border-zinc-800 p-2">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Incoming signal</h4>
        <p className="font-mono text-xs text-zinc-200">
          {lastMessage ? describeMessage(lastMessage) : 'No MIDI messages received yet.'}
        </p>
        {lastUpdates.length > 0 && (
          <p className="mt-1 text-[11px] text-emerald-300">Applied: {lastUpdates.join(' · ')}</p>
        )}
        {log.length > 0 && (
          <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[11px] text-zinc-500">
            {log.map((entry) => (
              <li key={entry.at + entry.msg.control + entry.msg.type}>
                {new Date(entry.at).toLocaleTimeString()} — {describeMessage(entry.msg)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Mappings */}
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Mappings</h4>
        {mappings.length === 0 && <p className="text-xs text-zinc-500">No mappings yet — add one below.</p>}
        <ul className="space-y-2">
          {mappings.map((m) => (
            <li key={m.id} className="space-y-2 rounded border border-zinc-800 p-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-zinc-200">
                  {m.midiType === 'cc' ? `CC ${m.control}` : `Note ${m.control}`} · CH{m.channel === 0 ? 'any' : m.channel}
                </span>
                <select
                  value={m.target}
                  onChange={(e) => updateMidiMapping(m.id, { target: e.target.value as MidiTarget })}
                  className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                  aria-label="Mapping target"
                >
                  {TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {m.target === 'scene' && (
                  <select
                    value={m.sceneId ?? ''}
                    onChange={(e) => updateMidiMapping(m.id, { sceneId: e.target.value || undefined })}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                    aria-label="Scene to switch to"
                  >
                    <option value="">Pick a scene…</option>
                    {scenes.map((sc) => (
                      <option key={sc.id} value={sc.id}>
                        {sc.name}
                      </option>
                    ))}
                  </select>
                )}
                <span className="flex-1" />
                <Button
                  variant={learnId === m.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setLearnId(learnId === m.id ? null : m.id)}
                  disabled={!selectedInputId}
                  title={selectedInputId ? 'Move a knob, slider or button to bind it' : 'Select a MIDI device first'}
                >
                  {learnId === m.id ? 'Listening… move a control' : 'Learn'}
                </Button>
                <button
                  type="button"
                  aria-label="Remove mapping"
                  onClick={() => removeMidiMapping(m.id)}
                  className="rounded border border-red-900 px-1.5 py-0.5 text-xs text-red-300"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-zinc-400">
                <label>
                  Channel
                  <input
                    type="number"
                    min={0}
                    max={16}
                    value={m.channel}
                    onChange={(e) => updateMidiMapping(m.id, { channel: Math.min(16, Math.max(0, Number(e.target.value) || 0)) })}
                    className="ml-1 w-12 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                  />
                  <span className="ml-1">(0 = any)</span>
                </label>
                <label>
                  Min
                  <input
                    type="number"
                    step={0.1}
                    value={m.min}
                    onChange={(e) => updateMidiMapping(m.id, { min: Number(e.target.value) || 0 })}
                    className="ml-1 w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                  />
                </label>
                <label>
                  Max
                  <input
                    type="number"
                    step={0.1}
                    value={m.max}
                    onChange={(e) => updateMidiMapping(m.id, { max: Number(e.target.value) || 0 })}
                    className="ml-1 w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                  />
                </label>
                <label>
                  Surface
                  <select
                    value={m.surfaceId ?? 'selected'}
                    onChange={(e) => updateMidiMapping(m.id, { surfaceId: e.target.value as MidiMapping['surfaceId'] })}
                    className="ml-1 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                  >
                    <option value="selected">selected</option>
                    {(useStudioStore.getState().project?.surfaces ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() =>
            addMidiMapping({
              id: uid('midi'),
              midiType: 'cc',
              channel: 0,
              control: 1,
              target: 'brightness',
              surfaceId: 'selected',
              min: 0,
              max: 1,
            })
          }
        >
          + Add mapping
        </Button>
        <p className="mt-2 text-[11px] text-zinc-500">
          Mappings persist in localStorage. applyMidiMessage(msg, mappings) in src/lib/midi.ts
          returns the parameter updates — the render loop applies them (non-scene targets
          become live values; scene targets switch scenes with their transition; playback
          toggles play/pause). No MIDI hardware is connected in this session, so mappings
          are verified in code only — connect a controller to test them live.
        </p>
      </section>
    </div>
  );
}
