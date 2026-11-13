// Effects pipeline — Phase 4.
// Chains enabled EffectInstances in order over an offscreen 2D canvas.
// Intensity handling: for defs that declare `intensityParams`, those numeric
// params are multiplied by intensity (so intensity 0 ≈ identity for that
// effect); for colour/filter passes (`blend: true`) the fully-applied result
// is composited over the input with globalAlpha = intensity. Geometric
// effects without intensityParams (crop, kaleidoscope, tile, rotate without
// scaling…) apply at full strength when enabled — intensity is ignored for
// them and the panel labels that.

import {
  defaultEffectParams,
  getEffectDef,
  type EffectInstance,
} from './effects';

export type { EffectInstance } from './effects';

/** Resolve an instance's params against its def defaults. */
export function resolveEffectParams(
  instance: EffectInstance,
): Record<string, number | boolean | string> {
  const def = getEffectDef(instance.type);
  if (!def) return { ...(instance.params ?? {}) };
  return { ...defaultEffectParams(def), ...(instance.params ?? {}) };
}

/**
 * Apply the enabled effects in order. Returns a NEW canvas; the source is
 * never mutated. Disabled effects and unknown types are skipped.
 */
export function applyEffects(
  source: HTMLCanvasElement,
  effects: EffectInstance[],
  time = 0,
  audioLevel = 0,
): HTMLCanvasElement {
  let current = source;
  for (const instance of effects) {
    if (instance.enabled === false) continue;
    const def = getEffectDef(instance.type);
    if (!def) continue;
    const intensity = typeof instance.intensity === 'number' ? Math.min(1, Math.max(0, instance.intensity)) : 1;
    if (intensity <= 0) continue;
    let params = resolveEffectParams(instance);
    if (def.intensityParams && intensity < 1) {
      const scaled = { ...params };
      for (const key of def.intensityParams) {
        const v = scaled[key];
        if (typeof v === 'number') {
          // Scale toward the identity value: for zoom/factor the identity
          // is 1, for angles/offsets/amounts it is 0.
          const identity = key === 'factor' ? 1 : 0;
          // 'scale' (fit) identity is 100 (percent).
          const id = key === 'scale' ? 100 : identity;
          scaled[key] = id + (v - id) * intensity;
        }
      }
      params = scaled;
    }
    const result = def.apply(current, params, time, audioLevel);
    if (def.blend && intensity < 1) {
      const blended = document.createElement('canvas');
      blended.width = current.width;
      blended.height = current.height;
      const bctx = blended.getContext('2d');
      if (!bctx) {
        current = result;
        continue;
      }
      bctx.drawImage(current, 0, 0);
      bctx.globalAlpha = intensity;
      bctx.drawImage(result, 0, 0);
      bctx.globalAlpha = 1;
      current = blended;
    } else {
      current = result;
    }
  }
  return current;
}

/** Render the pipeline straight into a target canvas (sized to the source). */
export function renderEffectsTo(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  effects: EffectInstance[],
  time = 0,
  audioLevel = 0,
): void {
  const result = applyEffects(source, effects, time, audioLevel);
  target.width = result.width;
  target.height = result.height;
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(result, 0, 0);
}
