// LFO / envelope modulation — pure functions.
import { describe, expect, it } from 'vitest';
import {
  createModulator,
  getModulatedValue,
  modulatorFrequency,
  sampleModulator,
  type Modulator,
} from '../modulation';

function mod(partial: Partial<Modulator> & { id: string }): Modulator {
  return createModulator(partial);
}

describe('sampleModulator waveforms', () => {
  it('sine: 0 at phase 0, 1 at quarter cycle, 0 at half, -1 at three quarters', () => {
    const m = mod({ id: 'm', waveform: 'sine', frequency: 1, bpmSync: false, phase: 0 });
    expect(sampleModulator(m, 0, 120)).toBeCloseTo(0, 9);
    expect(sampleModulator(m, 0.25, 120)).toBeCloseTo(1, 9);
    expect(sampleModulator(m, 0.5, 120)).toBeCloseTo(0, 9);
    expect(sampleModulator(m, 0.75, 120)).toBeCloseTo(-1, 9);
  });

  it('sine honours the phase offset', () => {
    const m = mod({ id: 'm', waveform: 'sine', frequency: 1, bpmSync: false, phase: 0.25 });
    expect(sampleModulator(m, 0, 120)).toBeCloseTo(1, 9);
  });

  it('triangle: -1, 0, 1, 0 across one cycle', () => {
    const m = mod({ id: 'm', waveform: 'triangle', frequency: 1, bpmSync: false, phase: 0 });
    expect(sampleModulator(m, 0, 120)).toBeCloseTo(-1, 9);
    expect(sampleModulator(m, 0.25, 120)).toBeCloseTo(0, 9);
    expect(sampleModulator(m, 0.5, 120)).toBeCloseTo(1, 9);
    expect(sampleModulator(m, 0.75, 120)).toBeCloseTo(0, 9);
  });

  it('square: +1 for the first half cycle, -1 for the second', () => {
    const m = mod({ id: 'm', waveform: 'square', frequency: 1, bpmSync: false, phase: 0 });
    expect(sampleModulator(m, 0, 120)).toBe(1);
    expect(sampleModulator(m, 0.25, 120)).toBe(1);
    expect(sampleModulator(m, 0.5, 120)).toBe(-1);
    expect(sampleModulator(m, 0.75, 120)).toBe(-1);
  });

  it('sawtooth: ramps linearly from -1 to +1 over a cycle', () => {
    const m = mod({ id: 'm', waveform: 'sawtooth', frequency: 1, bpmSync: false, phase: 0 });
    expect(sampleModulator(m, 0, 120)).toBeCloseTo(-1, 9);
    expect(sampleModulator(m, 0.5, 120)).toBeCloseTo(0, 9);
    expect(sampleModulator(m, 0.99, 120)).toBeCloseTo(0.98, 9);
  });
});

describe('modulatorFrequency (BPM sync)', () => {
  it('returns the base frequency when bpmSync is off', () => {
    expect(modulatorFrequency(mod({ id: 'm', frequency: 0.5, bpmSync: false }), 120)).toBe(0.5);
  });

  it('computes Hz from BPM and beats per cycle', () => {
    // 120 BPM, 4 beats per cycle -> one cycle every 2s -> 0.5 Hz.
    expect(modulatorFrequency(mod({ id: 'm', bpmSync: true, beatsPerCycle: 4 }), 120)).toBeCloseTo(0.5, 9);
    // 120 BPM, 1 beat per cycle -> 2 Hz.
    expect(modulatorFrequency(mod({ id: 'm', bpmSync: true, beatsPerCycle: 1 }), 120)).toBeCloseTo(2, 9);
    // 60 BPM, 2 beats per cycle -> 0.5 Hz.
    expect(modulatorFrequency(mod({ id: 'm', bpmSync: true, beatsPerCycle: 2 }), 60)).toBeCloseTo(0.5, 9);
  });
});

describe('envelope', () => {
  const env = () =>
    mod({
      id: 'm', waveform: 'envelope', attack: 0.2, decay: 0.3, sustain: 0.7, release: 0.4,
    });

  it('ramps linearly through the attack stage', () => {
    const m = env();
    expect(sampleModulator(m, 0, 120)).toBeCloseTo(0, 9);
    expect(sampleModulator(m, 0.1, 120)).toBeCloseTo(0.5, 9);
    expect(sampleModulator(m, 0.2, 120)).toBeCloseTo(1, 9);
  });

  it('decays from the peak to the sustain level, then holds', () => {
    const m = env();
    // Halfway through decay (0.2 + 0.15 of 0.3): 1 - 0.3 * 0.5 = 0.85.
    expect(sampleModulator(m, 0.35, 120)).toBeCloseTo(0.85, 9);
    expect(sampleModulator(m, 0.5, 120)).toBeCloseTo(0.7, 9);
    expect(sampleModulator(m, 5, 120)).toBeCloseTo(0.7, 9);
  });

  it('releases linearly from the held level after note-off', () => {
    const m = env();
    // Held at sustain 0.7 at t=1; halfway through the 0.4s release -> 0.35.
    expect(sampleModulator(m, 1.2, 120, 0, 1)).toBeCloseTo(0.35, 9);
    expect(sampleModulator(m, 1.4, 120, 0, 1)).toBeCloseTo(0, 9);
    expect(sampleModulator(m, 2, 120, 0, 1)).toBeCloseTo(0, 9);
  });

  it('returns 0 before the trigger time', () => {
    expect(sampleModulator(env(), 0.5, 120, 1)).toBe(0);
  });
});

describe('getModulatedValue', () => {
  it('returns the base value when the modulator is disabled', () => {
    const m = mod({ id: 'm', waveform: 'sine', frequency: 1, enabled: false, amplitude: 0.5 });
    expect(getModulatedValue(m, 0.25, 120, 2)).toBe(2);
  });

  it('adds sample * amplitude + offset to the base value', () => {
    const m = mod({
      id: 'm', waveform: 'sine', frequency: 1, enabled: true, amplitude: 0.2, offset: 0.1,
    });
    // sine peak (1) at t=0.25 -> 1 + 0.2 + 0.1 = 1.3.
    expect(getModulatedValue(m, 0.25, 120, 1)).toBeCloseTo(1.3, 9);
    // sine trough (-1) at t=0.75 -> 1 - 0.2 + 0.1 = 0.9.
    expect(getModulatedValue(m, 0.75, 120, 1)).toBeCloseTo(0.9, 9);
  });
});

describe('createModulator', () => {
  it('fills sensible defaults', () => {
    const m = createModulator({ id: 'm' });
    expect(m.waveform).toBe('sine');
    expect(m.frequency).toBe(0.5);
    expect(m.enabled).toBe(true);
    expect(m.target).toBe('opacity');
  });
});
