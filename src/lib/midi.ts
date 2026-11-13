// Web MIDI — Phase 4.
// Thin wrapper over navigator.requestMIDIAccess with typed errors, plus
// pure message parsing / mapping application so the UI and the render loop
// share one definition of what a MIDI message does.

export type MidiMessageType = 'cc' | 'noteon' | 'noteoff';

export interface MidiMessage {
  type: MidiMessageType;
  channel: number;
  control: number;
  value: number;
  timestamp: number;
}

export type MidiTarget =
  | 'brightness'
  | 'opacity'
  | 'speed'
  | 'scale'
  | 'rotation'
  | 'effectIntensity'
  | 'scene'
  | 'playback';

export interface MidiMapping {
  id: string;
  midiType: 'cc' | 'note';
  channel: number;
  control: number;
  target: MidiTarget;
  /** 'selected' applies to the currently selected surface; an id pins one surface. */
  surfaceId?: 'selected' | string;
  /** Scene id to switch to when target is 'scene' (note mappings). */
  sceneId?: string;
  min: number;
  max: number;
}

export interface MidiUpdate {
  target: MidiTarget;
  /** Mapped parameter value in [min, max] (for cc) or 0/1 (for note on/off). */
  value: number;
  surfaceId?: 'selected' | string;
  sceneId?: string;
  mappingId: string;
}

export interface MidiInputInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
}

export type MidiErrorCode = 'not-supported' | 'permission-denied' | 'access-failed';

export class MidiError extends Error {
  code: MidiErrorCode;
  constructor(code: MidiErrorCode, message: string) {
    super(message);
    this.name = 'MidiError';
    this.code = code;
  }
}

// Minimal Web MIDI shapes (avoids depending on the TS DOM lib's MIDI types).
export interface MidiInputPort {
  id: string;
  name: string | null;
  manufacturer: string | null;
  state: string;
  onmidimessage: ((e: { data: Uint8Array | null; timeStamp: number }) => void) | null;
}

export interface MidiAccessLike {
  inputs: Map<string, MidiInputPort>;
  onstatechange: ((e: unknown) => void) | null;
}

export function isMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

/** Request MIDI access. Throws MidiError('not-supported' | 'permission-denied' | 'access-failed'). */
export async function requestMidiAccess(): Promise<MidiAccessLike> {
  if (!isMidiSupported()) {
    throw new MidiError('not-supported', 'MIDI is not supported in this browser');
  }
  const nav = navigator as Navigator & {
    requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<unknown>;
  };
  try {
    const access = (await nav.requestMIDIAccess!({ sysex: false })) as unknown as MidiAccessLike;
    return access;
  } catch (err) {
    const name = (err as DOMException)?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new MidiError('permission-denied', 'MIDI access was denied. Allow MIDI in the browser site settings and try again.');
    }
    throw new MidiError('access-failed', `MIDI access failed (${name || 'unknown error'}).`);
  }
}

export function listMidiInputs(access: MidiAccessLike): MidiInputInfo[] {
  const out: MidiInputInfo[] = [];
  for (const input of access.inputs.values()) {
    out.push({
      id: input.id,
      name: input.name ?? 'Unknown device',
      manufacturer: input.manufacturer ?? '',
      state: input.state,
    });
  }
  return out;
}

/** Parse raw MIDI bytes into a MidiMessage. Returns null for non-CC/note messages. */
export function parseMidiMessage(data: Uint8Array | number[] | null, timestamp = 0): MidiMessage | null {
  if (!data || data.length < 2) return null;
  const status = data[0];
  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  if (kind === 0xb0) {
    return { type: 'cc', channel, control: data[1], value: data[2] ?? 0, timestamp };
  }
  if (kind === 0x90) {
    const velocity = data[2] ?? 0;
    return { type: velocity === 0 ? 'noteoff' : 'noteon', channel, control: data[1], value: velocity, timestamp };
  }
  if (kind === 0x80) {
    return { type: 'noteoff', channel, control: data[1], value: data[2] ?? 0, timestamp };
  }
  return null;
}

function mapRange(value: number, min: number, max: number): number {
  const v = Math.min(127, Math.max(0, value)) / 127;
  return min + (max - min) * v;
}

/**
 * Apply one parsed message to the mappings. CC messages scale 0..127 into
 * [min, max]; note-on fires note mappings (value 1, or the mapped range for
 * non-scene targets); note-off fires with value 0. Returns the updates the
 * caller should apply (render loop / store), in mapping order.
 */
export function applyMidiMessage(msg: MidiMessage, mappings: MidiMapping[]): MidiUpdate[] {
  const updates: MidiUpdate[] = [];
  for (const m of mappings) {
    if (m.channel !== 0 && m.channel !== msg.channel) continue;
    if (m.midiType === 'cc') {
      if (msg.type !== 'cc' || msg.control !== m.control) continue;
      updates.push({
        target: m.target,
        value: mapRange(msg.value, m.min, m.max),
        surfaceId: m.surfaceId,
        sceneId: m.sceneId,
        mappingId: m.id,
      });
    } else {
      if ((msg.type !== 'noteon' && msg.type !== 'noteoff') || msg.control !== m.control) continue;
      if (m.target === 'scene') {
        // Scene switching only fires on note-on.
        if (msg.type === 'noteon' && m.sceneId) {
          updates.push({ target: 'scene', value: 1, sceneId: m.sceneId, mappingId: m.id });
        }
        continue;
      }
      updates.push({
        target: m.target,
        value: msg.type === 'noteon' ? mapRange(msg.value, m.min, m.max) : m.min,
        surfaceId: m.surfaceId,
        sceneId: m.sceneId,
        mappingId: m.id,
      });
    }
  }
  return updates;
}

const MIDI_STORAGE_KEY = 'lazy-lighting-midi-mappings-v1';

export function loadMidiMappings(): MidiMapping[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MIDI_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is MidiMapping =>
        !!m && typeof m === 'object' && typeof (m as MidiMapping).id === 'string' && typeof (m as MidiMapping).control === 'number',
    );
  } catch {
    return [];
  }
}

export function saveMidiMappings(mappings: MidiMapping[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MIDI_STORAGE_KEY, JSON.stringify(mappings));
  } catch {
    // Storage full / unavailable — mappings stay in memory only.
  }
}
