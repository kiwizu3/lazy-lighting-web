// Live modulation — Phase 5.
// Combines audio mappings, MIDI live values, LFO modulators, timeline
// keyframes and performance-master controls into TRANSIENT per-surface
// render overrides. Nothing here writes to the store, so the undo stack
// and autosave are never touched by the render loop.
//
// Application order (later wins for the same target):
//   audio (global) -> MIDI (per surface) -> LFO (per surface, additive on
//   the current value) -> timeline keyframes (absolute, the show driver)
//   -> master brightness / speed.
// Mapping coverage (honest):
//   scale -> content zoom in the source canvas; rotation -> corner rotation
//     (degrees, around the surface centroid); brightness -> brightness
//     filter on the final blit; particles -> shader u_density only
//     (classic canvas visuals have no particle parameter — ignored there);
//     opacity -> surface opacity; speed -> animation time multiplier;
//     hue -> hue-rotate filter on the final blit; zoom -> content zoom
//     (same as scale); effectIntensity -> scales every enabled effect's
//     intensity for that surface; density -> shader u_density.
import { getAudioModulations, type AudioLevels } from '../audio';
import { getLiveAudioLevels } from '../audioBus';
import { getModulatedValue } from '../modulation';
import { usePerformStore } from '../performStore';
import { useStudioStore } from '../store';
import type { Project, Surface } from '../schema';
import { sampleKeyframes } from '../timeline';
import type { ShaderParams } from '../shaders';

export interface SurfaceRenderCtx {
  audioLevel: number;
  /** Content zoom multiplier (1 = identity). */
  scale: number;
  brightness: number;
  /** Hue rotation in degrees (0 = identity). */
  hue: number;
  /** Shader u_density multiplier (1 = identity). */
  density: number;
  /** Animation time multiplier (1 = identity). */
  speed: number;
  /** Multiplier for every enabled effect's intensity (1 = identity). */
  effectIntensity: number;
  /** Performance-mode shader param overrides for this surface. */
  shaderParams?: Partial<ShaderParams>;
}

export interface LiveModResult {
  /** Transient Partial<Surface> patches (opacity / corners) per surface id. */
  overrides: Map<string, Partial<Surface>>;
  /** Per-surface render contexts for the source stage. */
  renderCtx: Map<string, SurfaceRenderCtx>;
}

function rotateCorners(corners: Surface['corners'], degrees: number): Surface['corners'] {
  if (!degrees) return corners;
  const c = {
    x: (corners[0].x + corners[2].x) / 2,
    y: (corners[0].y + corners[2].y) / 2,
  };
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return corners.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
  }) as Surface['corners'];
}

const EMPTY_LEVELS: AudioLevels = {
  amplitude: 0,
  bass: 0,
  mid: 0,
  high: 0,
  beat: false,
  beatStrength: 0,
  waveform: new Uint8Array(0),
  frequency: new Uint8Array(0),
};

interface Accum {
  opacity: number;
  scale: number;
  rotation: number;
  brightness: number;
  density: number;
  speed: number;
  effectIntensity: number;
  hue: number;
}

/**
 * Compute transient overrides + render contexts for every visible surface
 * of `project` at `time` (seconds). `bpm` comes from the store's playback
 * state. Pure w.r.t. the store: reads perform + studio state via getState().
 */
export function computeLiveMod(project: Project, time: number, bpm: number): LiveModResult {
  const perf = usePerformStore.getState();
  const levels = getLiveAudioLevels() ?? perf.audioLevels ?? EMPTY_LEVELS;
  const audioMods = getAudioModulations(levels, perf.audioMappings);
  const keyframes = sampleKeyframes(project.timeline, time);
  const overrides = new Map<string, Partial<Surface>>();
  const renderCtx = new Map<string, SurfaceRenderCtx>();

  const surfaces = project.surfaces ?? [];
  for (const surface of surfaces) {
    const acc: Accum = {
      opacity: surface.opacity,
      scale: 1,
      rotation: 0,
      brightness: 1,
      density: 1,
      speed: 1,
      effectIntensity: 1,
      hue: 0,
    };

    // 1) Audio (global, absolute per target).
    acc.scale = audioMods.scale;
    acc.rotation = audioMods.rotation;
    acc.brightness = audioMods.brightness;
    acc.density = audioMods.particles;
    acc.opacity = surface.opacity * audioMods.opacity;
    acc.speed = audioMods.speed;

    // 2) MIDI live values (per surface; 'selected' resolves to the selected id).
    const selectedId = useStudioStore.getState().selectedSurfaceId;
    const midiKeys = [
      `${surface.id}:`,
      surface.id === selectedId ? 'selected:' : '',
      'global:',
    ].filter(Boolean);
    for (const prefix of midiKeys) {
      for (const target of ['scale', 'rotation', 'brightness', 'opacity', 'speed', 'effectIntensity'] as const) {
        const v = perf.midiLive[`${prefix}${target}`];
        if (v === undefined) continue;
        if (target === 'scale') acc.scale = v;
        else if (target === 'rotation') acc.rotation = v;
        else if (target === 'brightness') acc.brightness = v;
        else if (target === 'opacity') acc.opacity = v;
        else if (target === 'speed') acc.speed = v;
        else if (target === 'effectIntensity') acc.effectIntensity = v;
      }
    }

    // 2.5) Tracking live values (hand / face / motion) — same key shape as
    // MIDI, same application order. Tracking also drives hue + density,
    // which MIDI does not.
    for (const prefix of midiKeys) {
      for (const target of ['scale', 'rotation', 'brightness', 'opacity', 'speed', 'effectIntensity', 'hue', 'density'] as const) {
        const v = perf.trackingLive[`${prefix}${target}`];
        if (v === undefined) continue;
        if (target === 'scale') acc.scale = v;
        else if (target === 'rotation') acc.rotation = v;
        else if (target === 'brightness') acc.brightness = v;
        else if (target === 'opacity') acc.opacity = v;
        else if (target === 'speed') acc.speed = v;
        else if (target === 'effectIntensity') acc.effectIntensity = v;
        else if (target === 'hue') acc.hue = v;
        else if (target === 'density') acc.density = v;
      }
    }

    // 3) LFO / envelope modulators (additive on the current value).
    for (const mod of perf.modulators) {
      if (!mod.enabled) continue;
      const targetId = mod.surfaceId ?? 'selected';
      const applies = targetId === 'selected' ? surface.id === selectedId : targetId === surface.id;
      if (!applies) continue;
      if (mod.target === 'opacity') acc.opacity = getModulatedValue(mod, time, bpm, acc.opacity);
      else if (mod.target === 'scale') acc.scale = getModulatedValue(mod, time, bpm, acc.scale);
      else if (mod.target === 'rotation') acc.rotation = getModulatedValue(mod, time, bpm, acc.rotation);
      else if (mod.target === 'brightness') acc.brightness = getModulatedValue(mod, time, bpm, acc.brightness);
      else if (mod.target === 'hue') acc.hue = getModulatedValue(mod, time, bpm, acc.hue);
      else if (mod.target === 'zoom') acc.scale = acc.scale * getModulatedValue(mod, time, bpm, 1);
    }

    // 4) Timeline keyframes (absolute — the show driver wins). Keyframes
    // without a surfaceId are 'global': they apply to the selected surface
    // only, not to every surface.
    const kfFor = (surfaceId: string): Map<string, number> | undefined => keyframes.get(surfaceId);
    const kf = kfFor(surface.id) ?? (surface.id === selectedId ? kfFor('global') : undefined);
    if (kf) {
      const get = (p: string) => kf.get(p);
      if (get('opacity') !== undefined) acc.opacity = get('opacity')!;
      if (get('scale') !== undefined) acc.scale = get('scale')!;
      if (get('rotation') !== undefined) acc.rotation = get('rotation')!;
      if (get('brightness') !== undefined) acc.brightness = get('brightness')!;
      if (get('speed') !== undefined) acc.speed = get('speed')!;
      if (get('hue') !== undefined) acc.hue = get('hue')!;
      if (get('zoom') !== undefined) acc.scale = get('zoom')!;
      if (get('density') !== undefined) acc.density = get('density')!;
      if (get('effectIntensity') !== undefined) acc.effectIntensity = get('effectIntensity')!;
    }

    // 5) Performance masters.
    acc.brightness *= perf.masterBrightness;
    acc.speed *= perf.masterSpeed;

    acc.opacity = Math.min(1, Math.max(0, acc.opacity));
    acc.brightness = Math.min(3, Math.max(0, acc.brightness));
    acc.scale = Math.min(4, Math.max(0.1, acc.scale));
    acc.speed = Math.min(4, Math.max(0.05, acc.speed));
    acc.density = Math.min(4, Math.max(0.1, acc.density));
    acc.effectIntensity = Math.min(2, Math.max(0, acc.effectIntensity));

    const patch: Partial<Surface> = {};
    if (Math.abs(acc.opacity - surface.opacity) > 0.001) patch.opacity = acc.opacity;
    if (Math.abs(acc.rotation) > 0.01) patch.corners = rotateCorners(surface.corners, acc.rotation);
    if (Object.keys(patch).length > 0) overrides.set(surface.id, patch);

    renderCtx.set(surface.id, {
      audioLevel: levels.amplitude,
      scale: acc.scale,
      brightness: acc.brightness,
      hue: acc.hue,
      density: acc.density,
      speed: acc.speed,
      effectIntensity: acc.effectIntensity,
      shaderParams: perf.visualParamOverrides[surface.id],
    });
  }

  return { overrides, renderCtx };
}
