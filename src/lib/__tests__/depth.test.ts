// Depth mode — PURE parts only.
// estimateDepthMap / drawDepthVisual need a canvas/DOM, so they are NOT
// tested here (they need a live browser; see docs/manual-testing-checklist.md).
// What is testable in Node: parameter coercion, preset catalogue, labels.
import { describe, expect, it } from 'vitest';
import {
  coerceDepthParams,
  DEFAULT_DEPTH_PARAMS,
  DEPTH_ESTIMATE_LABEL,
  DEPTH_PRESETS,
} from '../depth';

describe('coerceDepthParams', () => {
  it('returns the defaults for undefined / garbage input', () => {
    expect(coerceDepthParams(undefined)).toEqual(DEFAULT_DEPTH_PARAMS);
    expect(coerceDepthParams(null)).toEqual(DEFAULT_DEPTH_PARAMS);
    expect(coerceDepthParams('nope')).toEqual(DEFAULT_DEPTH_PARAMS);
    expect(coerceDepthParams({})).toEqual(DEFAULT_DEPTH_PARAMS);
  });

  it('keeps a valid parameter set as-is', () => {
    const p = coerceDepthParams({
      preset: 'pulse',
      intensity: 1.5,
      displacement: 30,
      focusX: 0.25,
      focusY: 0.75,
      parallaxX: -0.5,
      parallaxY: 0.5,
      color1: '#ff0000',
      color2: '#00ff00',
    });
    expect(p).toEqual({
      preset: 'pulse',
      intensity: 1.5,
      displacement: 30,
      focusX: 0.25,
      focusY: 0.75,
      parallaxX: -0.5,
      parallaxY: 0.5,
      color1: '#ff0000',
      color2: '#00ff00',
    });
  });

  it('falls back to depth-waves for an unknown preset', () => {
    expect(coerceDepthParams({ preset: 'bogus' }).preset).toBe('depth-waves');
  });

  it('clamps every numeric field into range', () => {
    const p = coerceDepthParams({
      intensity: 5,
      displacement: -3,
      focusX: 2,
      focusY: -1,
      parallaxX: 5,
      parallaxY: -5,
    });
    expect(p.intensity).toBe(2);
    expect(p.displacement).toBe(0);
    expect(p.focusX).toBe(1);
    expect(p.focusY).toBe(0);
    expect(p.parallaxX).toBe(1);
    expect(p.parallaxY).toBe(-1);
  });

  it('falls back to defaults for non-numeric / non-string values', () => {
    const p = coerceDepthParams({
      intensity: 'loud',
      displacement: NaN,
      color1: 123,
      color2: null,
    });
    expect(p.intensity).toBe(1);
    expect(p.displacement).toBe(18);
    expect(p.color1).toBe('#22d3ee');
    expect(p.color2).toBe('#f472b6');
  });
});

describe('depth presets', () => {
  it('ships 7 presets with unique ids and labels', () => {
    expect(DEPTH_PRESETS).toHaveLength(7);
    const ids = DEPTH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of DEPTH_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
    }
  });

  it('defaults to the depth-waves preset at full intensity', () => {
    expect(DEFAULT_DEPTH_PARAMS.preset).toBe('depth-waves');
    expect(DEFAULT_DEPTH_PARAMS.intensity).toBe(1);
    expect(DEFAULT_DEPTH_PARAMS.displacement).toBe(18);
    expect(DEFAULT_DEPTH_PARAMS.focusX).toBe(0.5);
    expect(DEFAULT_DEPTH_PARAMS.focusY).toBe(0.5);
  });

  it('labels the depth map honestly as an estimate, not AI depth', () => {
    expect(DEPTH_ESTIMATE_LABEL).toMatch(/brightness/i);
    expect(DEPTH_ESTIMATE_LABEL).toMatch(/not AI/i);
  });
});
