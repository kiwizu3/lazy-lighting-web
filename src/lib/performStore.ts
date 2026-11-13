// Performance-time store — Phase 4.
// A SECOND, small Zustand store for live performance state (audio mappings,
// MIDI mappings, LFO modulators, throttled audio levels, selected preset).
// Deliberately separate from src/lib/store.ts (the project store): these
// values change at performance time and must never touch the undo stack or
// IndexedDB autosave. MIDI mappings are mirrored to localStorage via
// src/lib/midi.ts so they survive reloads; everything else is session-only.
import { create } from 'zustand';
import type { AudioLevels, AudioMapping } from './audio';
import { loadMidiMappings, saveMidiMappings, type MidiMapping } from './midi';
import type { Modulator } from './modulation';
import type { ShaderParams } from './shaders';

export type { AudioMapping } from './audio';
export type { MidiMapping } from './midi';
export type { Modulator } from './modulation';

/** Transient per-target MIDI CC values, keyed `${surfaceKey}:${target}` where
 * surfaceKey is a surface id or 'selected' (resolved at render time) or
 * 'global' for targets with no surface. Written only on message arrival,
 * never per frame; the render loop reads them via getState(). */
export type MidiLiveValues = Record<string, number>;

/** Transient per-target hand/face/motion tracking values, same key shape
 * as midiLive (`global:<target>`). Written by TrackingPanel at ~15 Hz;
 * the render loop reads them via getState() in computeLiveMod. */
export type TrackingLiveValues = Record<string, number>;

interface PerformState {
  audioMappings: AudioMapping[];
  midiMappings: MidiMapping[];
  modulators: Modulator[];
  /** Latest audio levels, updated at ~15 Hz by AudioAnalyzer (not per frame). */
  audioLevels: AudioLevels | null;
  selectedPreset: string | null;
  /** Live MIDI CC/note values (transient, session-only). */
  midiLive: MidiLiveValues;
  /** Live tracking values (transient, session-only) — same key shape as midiLive. */
  trackingLive: TrackingLiveValues;
  /** Performance-mode master controls (transient, session-only). */
  masterBrightness: number;
  masterSpeed: number;
  /** Transient shader-param overrides per surface id (performance tweaks). */
  visualParamOverrides: Record<string, Partial<ShaderParams>>;

  setAudioMappings: (mappings: AudioMapping[]) => void;
  updateAudioMapping: (id: string, patch: Partial<AudioMapping>) => void;
  addAudioMapping: (mapping: AudioMapping) => void;
  removeAudioMapping: (id: string) => void;

  setMidiMappings: (mappings: MidiMapping[]) => void;
  updateMidiMapping: (id: string, patch: Partial<MidiMapping>) => void;
  addMidiMapping: (mapping: MidiMapping) => void;
  removeMidiMapping: (id: string) => void;

  setModulators: (mods: Modulator[]) => void;
  updateModulator: (id: string, patch: Partial<Modulator>) => void;
  addModulator: (mod: Modulator) => void;
  removeModulator: (id: string) => void;

  setAudioLevels: (levels: AudioLevels) => void;
  setSelectedPreset: (presetId: string | null) => void;
  setMidiLive: (key: string, value: number) => void;
  clearMidiLive: () => void;
  setTrackingLive: (key: string, value: number) => void;
  clearTrackingLive: () => void;
  setMasterBrightness: (v: number) => void;
  setMasterSpeed: (v: number) => void;
  setVisualParamOverride: (surfaceId: string, patch: Partial<ShaderParams>) => void;
  clearVisualParamOverrides: () => void;
}

const DEFAULT_AUDIO_MAPPINGS: AudioMapping[] = [
  { id: 'map-bass-scale', source: 'bass', target: 'scale', enabled: true, min: 0.9, max: 1.3 },
  { id: 'map-beat-rotation', source: 'beat', target: 'rotation', enabled: false, min: -8, max: 8 },
  { id: 'map-high-particles', source: 'high', target: 'particles', enabled: true, min: 0.7, max: 1.6 },
  { id: 'map-amp-brightness', source: 'amplitude', target: 'brightness', enabled: true, min: 0.8, max: 1.4 },
];

export const usePerformStore = create<PerformState>()((set, get) => ({
  audioMappings: DEFAULT_AUDIO_MAPPINGS,
  midiMappings: loadMidiMappings(),
  modulators: [],
  audioLevels: null,
  selectedPreset: null,
  midiLive: {},
  trackingLive: {},
  masterBrightness: 1,
  masterSpeed: 1,
  visualParamOverrides: {},

  setAudioMappings: (mappings) => set({ audioMappings: mappings }),
  updateAudioMapping: (id, patch) =>
    set((s) => ({ audioMappings: s.audioMappings.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  addAudioMapping: (mapping) => set((s) => ({ audioMappings: [...s.audioMappings, mapping] })),
  removeAudioMapping: (id) => set((s) => ({ audioMappings: s.audioMappings.filter((m) => m.id !== id) })),

  setMidiMappings: (mappings) => {
    saveMidiMappings(mappings);
    set({ midiMappings: mappings });
  },
  updateMidiMapping: (id, patch) => {
    const next = get().midiMappings.map((m) => (m.id === id ? { ...m, ...patch } : m));
    saveMidiMappings(next);
    set({ midiMappings: next });
  },
  addMidiMapping: (mapping) => {
    const next = [...get().midiMappings, mapping];
    saveMidiMappings(next);
    set({ midiMappings: next });
  },
  removeMidiMapping: (id) => {
    const next = get().midiMappings.filter((m) => m.id !== id);
    saveMidiMappings(next);
    set({ midiMappings: next });
  },

  setModulators: (mods) => set({ modulators: mods }),
  updateModulator: (id, patch) =>
    set((s) => ({ modulators: s.modulators.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  addModulator: (mod) => set((s) => ({ modulators: [...s.modulators, mod] })),
  removeModulator: (id) => set((s) => ({ modulators: s.modulators.filter((m) => m.id !== id) })),

  setAudioLevels: (levels) => set({ audioLevels: levels }),
  setSelectedPreset: (presetId) => set({ selectedPreset: presetId }),

  setMidiLive: (key, value) => set((s) => ({ midiLive: { ...s.midiLive, [key]: value } })),
  clearMidiLive: () => set({ midiLive: {} }),
  setTrackingLive: (key, value) => set((s) => ({ trackingLive: { ...s.trackingLive, [key]: value } })),
  clearTrackingLive: () => set({ trackingLive: {} }),
  setMasterBrightness: (v) => set({ masterBrightness: Math.min(2, Math.max(0, v)) }),
  setMasterSpeed: (v) => set({ masterSpeed: Math.min(4, Math.max(0.1, v)) }),
  setVisualParamOverride: (surfaceId, patch) =>
    set((s) => ({
      visualParamOverrides: {
        ...s.visualParamOverrides,
        [surfaceId]: { ...(s.visualParamOverrides[surfaceId] ?? {}), ...patch },
      },
    })),
  clearVisualParamOverrides: () => set({ visualParamOverrides: {} }),
}));

// Selectors (keep components from re-rendering on unrelated perform state).
export const selectAudioMappings = (s: PerformState) => s.audioMappings;
export const selectMidiMappings = (s: PerformState) => s.midiMappings;
export const selectModulators = (s: PerformState) => s.modulators;
export const selectAudioLevels = (s: PerformState) => s.audioLevels;
export const selectSelectedPreset = (s: PerformState) => s.selectedPreset;
