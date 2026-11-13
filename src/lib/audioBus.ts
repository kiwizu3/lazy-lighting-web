// Audio bus — Phase 5.
// The AudioEngine instance lives in AudioAnalyzer (created on user gesture);
// this module-level holder lets the render loop read live levels each frame
// without prop-drilling the engine through the store (AudioContext and
// analyser nodes are not serializable and must never land in IndexedDB).
// When no engine is registered (analyzer stopped / never started), the loop
// falls back to the ~15 Hz levels in the perform store, then to silence.
import type { AudioEngine, AudioLevels } from './audio';

let engine: AudioEngine | null = null;

export function registerAudioEngine(e: AudioEngine | null): void {
  engine = e;
}

export function getRegisteredAudioEngine(): AudioEngine | null {
  return engine;
}

/** Live levels from the registered engine, or null when it is not running. */
export function getLiveAudioLevels(): AudioLevels | null {
  if (!engine || !engine.isRunning) return null;
  try {
    return engine.getLevels();
  } catch {
    return null;
  }
}
