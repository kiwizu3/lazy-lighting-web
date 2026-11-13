// Audio band mapping — pure functions (no AudioContext, no mic).
import { describe, expect, it } from 'vitest';
import {
  getAudioModulations,
  mapBandToParam,
  readBand,
  type AudioLevels,
  type AudioMapping,
} from '../audio';

function levels(partial: Partial<AudioLevels> = {}): AudioLevels {
  return {
    amplitude: 0.5,
    bass: 0.8,
    mid: 0.2,
    high: 0.1,
    beat: false,
    beatStrength: 0,
    waveform: new Uint8Array(0),
    frequency: new Uint8Array(0),
    ...partial,
  };
}

function mapping(partial: Partial<AudioMapping> & { id: string }): AudioMapping {
  return {
    source: 'bass',
    target: 'scale',
    enabled: true,
    min: 1,
    max: 2,
    ...partial,
  };
}

describe('mapBandToParam', () => {
  it('scales a band linearly across [min, max]', () => {
    expect(mapBandToParam(0, 0, 10)).toBe(0);
    expect(mapBandToParam(0.5, 0, 10)).toBe(5);
    expect(mapBandToParam(1, 0, 10)).toBe(10);
    expect(mapBandToParam(0.25, 10, 20)).toBe(12.5);
  });

  it('clamps bands outside 0..1 to the range ends', () => {
    expect(mapBandToParam(2, 0, 10)).toBe(10);
    expect(mapBandToParam(-1, 0, 10)).toBe(0);
    expect(mapBandToParam(1.5, 1, 2)).toBe(2);
  });

  it('applies sensitivity before clamping', () => {
    // 0.5 * 2 = 1 -> clamped to max.
    expect(mapBandToParam(0.5, 0, 10, 2)).toBe(10);
    // 0.25 * 2 = 0.5 -> midpoint.
    expect(mapBandToParam(0.25, 0, 10, 2)).toBe(5);
    // 0 sensitivity silences the band.
    expect(mapBandToParam(1, 0, 10, 0)).toBe(0);
  });
});

describe('readBand', () => {
  it('reads amplitude/bass/mid/high directly', () => {
    const l = levels();
    expect(readBand(l, 'bass')).toBe(0.8);
    expect(readBand(l, 'mid')).toBe(0.2);
    expect(readBand(l, 'high')).toBe(0.1);
    expect(readBand(l, 'amplitude')).toBe(0.5);
  });

  it('returns 1 on a beat frame, beatStrength otherwise', () => {
    expect(readBand(levels({ beat: true, beatStrength: 0.4 }), 'beat')).toBe(1);
    expect(readBand(levels({ beat: false, beatStrength: 0.4 }), 'beat')).toBe(0.4);
  });
});

describe('getAudioModulations', () => {
  it('returns neutral values with no mappings', () => {
    expect(getAudioModulations(levels(), [])).toEqual({
      scale: 1,
      rotation: 0,
      brightness: 1,
      particles: 1,
      opacity: 1,
      speed: 1,
    });
  });

  it('maps a band onto its target range', () => {
    const mods = getAudioModulations(levels(), [
      mapping({ id: 'a', source: 'bass', target: 'scale', min: 1, max: 2 }),
    ]);
    // bass 0.8 -> 1 + 0.8 * 1 = 1.8.
    expect(mods.scale).toBeCloseTo(1.8, 9);
    expect(mods.rotation).toBe(0);
    expect(mods.brightness).toBe(1);
  });

  it('applies several mappings at once', () => {
    const mods = getAudioModulations(levels(), [
      mapping({ id: 'a', source: 'bass', target: 'scale', min: 1, max: 2 }),
      mapping({ id: 'b', source: 'mid', target: 'rotation', min: -30, max: 30 }),
      mapping({ id: 'c', source: 'high', target: 'opacity', min: 0, max: 1 }),
    ]);
    expect(mods.scale).toBeCloseTo(1.8, 9);
    // mid 0.2 -> -30 + 0.2 * 60 = -18.
    expect(mods.rotation).toBeCloseTo(-18, 9);
    // high 0.1 -> 0.1.
    expect(mods.opacity).toBeCloseTo(0.1, 9);
  });

  it('ignores disabled mappings', () => {
    const mods = getAudioModulations(levels(), [
      mapping({ id: 'a', source: 'bass', target: 'scale', min: 1, max: 2, enabled: false }),
    ]);
    expect(mods.scale).toBe(1);
  });

  it('lets the FIRST enabled mapping win for a duplicated target', () => {
    const mods = getAudioModulations(levels(), [
      mapping({ id: 'a', source: 'bass', target: 'scale', min: 1, max: 2 }),
      mapping({ id: 'b', source: 'mid', target: 'scale', min: 10, max: 20 }),
    ]);
    expect(mods.scale).toBeCloseTo(1.8, 9);
  });

  it('maps the beat band through readBand', () => {
    const mods = getAudioModulations(levels({ beat: true }), [
      mapping({ id: 'a', source: 'beat', target: 'brightness', min: 1, max: 1.5 }),
    ]);
    expect(mods.brightness).toBeCloseTo(1.5, 9);
  });
});
