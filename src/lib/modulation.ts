// LFO / envelope modulation engine — Phase 4.
// Pure functions only: no DOM, no store, no timers. The render loop calls
// sampleModulator() / getModulatedValue() with its own clock; the editor
// draws the same function with drawModulatorGraph().

export type Waveform = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'envelope';

export type ModulatorTarget =
  | 'opacity'
  | 'scale'
  | 'hue'
  | 'zoom'
  | 'rotation'
  | 'brightness';

export interface Modulator {
  id: string;
  waveform: Waveform;
  /** Base frequency in Hz (used when bpmSync is false). */
  frequency: number;
  bpmSync: boolean;
  /** Beats per LFO cycle when bpmSync is true. */
  beatsPerCycle: number;
  /** Modulation depth, in the target's units. */
  amplitude: number;
  /** Phase offset, 0..1 of a cycle. */
  phase: number;
  /** DC offset added after the waveform. */
  offset: number;
  target: ModulatorTarget;
  /** 'selected' follows the selected surface; an id pins one surface. */
  surfaceId?: 'selected' | string;
  enabled: boolean;
  /** Envelope (ADSR-ish) timings in seconds; sustain is a 0..1 level. */
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
}

/** Effective frequency in Hz, honouring BPM sync. */
export function modulatorFrequency(mod: Modulator, bpm: number): number {
  if (mod.bpmSync) {
    const beats = Math.max(0.25, mod.beatsPerCycle || 1);
    return bpm / 60 / beats;
  }
  return Math.max(0.01, mod.frequency);
}

/**
 * Sample the raw waveform at time `time` (seconds), returning -1..1 for
 * oscillators and 0..1 for the envelope. `triggerTime` is the last trigger
 * instant for the envelope (defaults to 0 = triggered at t=0); `noteOffAt`
 * (seconds, or null = still held) starts the release stage.
 */
export function sampleModulator(
  mod: Modulator,
  time: number,
  bpm: number,
  triggerTime = 0,
  noteOffAt: number | null = null,
): number {
  const freq = modulatorFrequency(mod, bpm);
  const phase = (time * freq + mod.phase) % 1;
  const p = ((phase % 1) + 1) % 1;
  switch (mod.waveform) {
    case 'sine':
      return Math.sin(p * Math.PI * 2);
    case 'triangle':
      return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'sawtooth':
      return 2 * p - 1;
    case 'envelope': {
      const attack = Math.max(0.001, mod.attack ?? 0.1);
      const decay = Math.max(0.001, mod.decay ?? 0.3);
      const sustain = Math.min(1, Math.max(0, mod.sustain ?? 0.7));
      const release = Math.max(0.001, mod.release ?? 0.4);
      const t = time - triggerTime;
      if (t < 0) return 0;
      if (noteOffAt !== null && time >= noteOffAt) {
        // Release from the level the envelope had reached at note-off.
        const held = envelopeLevel(noteOffAt - triggerTime, attack, decay, sustain);
        const rt = time - noteOffAt;
        return held * Math.max(0, 1 - rt / release);
      }
      return envelopeLevel(t, attack, decay, sustain);
    }
    default:
      return 0;
  }
}

function envelopeLevel(t: number, attack: number, decay: number, sustain: number): number {
  if (t < attack) return t / attack;
  if (t < attack + decay) return 1 - (1 - sustain) * ((t - attack) / decay);
  return sustain;
}

/**
 * Modulated parameter value: baseValue + (sample * amplitude) + offset.
 * For the envelope the sample is 0..1, so the result moves between
 * base + offset and base + offset + amplitude.
 */
export function getModulatedValue(
  mod: Modulator,
  time: number,
  bpm: number,
  baseValue: number,
  triggerTime = 0,
  noteOffAt: number | null = null,
): number {
  if (!mod.enabled) return baseValue;
  const sample = sampleModulator(mod, time, bpm, triggerTime, noteOffAt);
  return baseValue + sample * mod.amplitude + mod.offset;
}

/** Draw one cycle of the modulator's waveform onto a 2D canvas. */
export function drawModulatorGraph(
  canvas: HTMLCanvasElement,
  mod: Modulator,
  bpm: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, w, h);
  // Centre line.
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  // Waveform.
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const cycles = 1;
  const attack = mod.attack ?? 0.1;
  const decay = mod.decay ?? 0.3;
  const release = mod.release ?? 0.4;
  const holdEnd = attack + decay + 0.6; // hold at sustain before release
  const span = mod.waveform === 'envelope'
    ? holdEnd + release
    : 1 / modulatorFrequency(mod, bpm);
  for (let x = 0; x <= w; x++) {
    const t = (x / w) * span * cycles;
    const v = mod.waveform === 'envelope'
      ? sampleModulator(mod, t, bpm, 0, holdEnd)
      : sampleModulator(mod, t, bpm);
    const y = h / 2 - v * (h / 2 - 4);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function createModulator(partial: Partial<Modulator> & { id: string }): Modulator {
  return {
    waveform: 'sine',
    frequency: 0.5,
    bpmSync: false,
    beatsPerCycle: 4,
    amplitude: 0.2,
    phase: 0,
    offset: 0,
    target: 'opacity',
    surfaceId: 'selected',
    enabled: true,
    attack: 0.1,
    decay: 0.3,
    sustain: 0.7,
    release: 0.4,
    ...partial,
  };
}
