// MIDI bus — Phase 5.
// Single owner of the Web MIDI access + input subscription, so the
// MidiController panel and the render loop never fight over
// input.onmidimessage (a single-assignment handler). The bus dispatches
// parsed messages to every registered listener; the render-loop listener
// (ProjectionCanvas) applies them via applyMidiMessage, and the panel
// listener shows the log / runs MIDI learn.
import {
  isMidiSupported,
  listMidiInputs,
  parseMidiMessage,
  requestMidiAccess,
  type MidiAccessLike,
  type MidiInputInfo,
  type MidiInputPort,
  type MidiMessage,
} from './midi';

export type MidiBusListener = (msg: MidiMessage) => void;

const listeners = new Set<MidiBusListener>();
let access: MidiAccessLike | null = null;
let selectedInput: MidiInputPort | null = null;
let selectedInputId: string | null = null;
let connecting: Promise<MidiAccessLike> | null = null;
let inputsVersion = 0;

function attachInput(input: MidiInputPort | null): void {
  if (selectedInput) selectedInput.onmidimessage = null;
  selectedInput = input;
  if (input) {
    input.onmidimessage = (e) => {
      const msg = parseMidiMessage(e.data, e.timeStamp);
      if (!msg) return;
      for (const fn of [...listeners]) {
        try {
          fn(msg);
        } catch (err) {
          console.warn('[midiBus] listener failed', err);
        }
      }
    };
  }
}

export function isMidiBusSupported(): boolean {
  return isMidiSupported();
}

export function getMidiBusAccess(): MidiAccessLike | null {
  return access;
}

export function getMidiBusInputs(): MidiInputInfo[] {
  return access ? listMidiInputs(access) : [];
}

export function getMidiBusSelectedInputId(): string | null {
  return selectedInputId;
}

/** Connect (requests browser MIDI access once) and return the inputs. */
export async function connectMidiBus(): Promise<MidiInputInfo[]> {
  if (access) return listMidiInputs(access);
  if (!connecting) {
    connecting = requestMidiAccess().then((acc) => {
      access = acc;
      acc.onstatechange = () => {
        inputsVersion += 1;
      };
      return acc;
    });
  }
  try {
    const acc = await connecting;
    return listMidiInputs(acc);
  } finally {
    connecting = null;
  }
}

/** Select an input device by id (null = none). Re-attaches the handler. */
export function selectMidiBusInput(id: string | null): void {
  selectedInputId = id;
  if (!access || !id) {
    attachInput(null);
    return;
  }
  attachInput(access.inputs.get(id) ?? null);
}

/** Subscribe to parsed MIDI messages. Returns an unsubscribe function. */
export function subscribeMidiBus(fn: MidiBusListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** For UI polling: increments whenever the device list may have changed. */
export function getMidiBusInputsVersion(): number {
  return inputsVersion;
}

/** Inject a parsed message (used by tests / virtual controllers, not hardware). */
export function emitMidiBusMessage(msg: MidiMessage): void {
  for (const fn of [...listeners]) {
    try {
      fn(msg);
    } catch (err) {
      console.warn('[midiBus] listener failed', err);
    }
  }
}
