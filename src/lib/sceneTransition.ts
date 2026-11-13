// Scene transitions — Phase 5.
// Transient (never stored) crossfade state. When a scene switch starts,
// the caller captures the outgoing surfaces here; the render loop renders
// old + new surfaces together with an opacity ramp over the scene's
// transition duration, then clears the state. Nothing is written to the
// store per frame, so switching never floods the undo stack.
import type { Surface } from './schema';
import { useStudioStore } from './store';

export type SceneTransitionKind = 'cut' | 'fade' | 'dissolve' | 'crossfade';

export interface ActiveTransition {
  fromSurfaces: Surface[];
  startedAt: number; // performance.now() ms
  durationMs: number;
  kind: SceneTransitionKind;
}

let active: ActiveTransition | null = null;

export function getActiveTransition(): ActiveTransition | null {
  return active;
}

export function clearTransition(): void {
  active = null;
}

/**
 * Switch scenes with a crossfade: captures the current surfaces, starts the
 * transient transition, then calls the store's switchScene (which snapshots
 * the outgoing scene and restores the incoming one). For 'cut' (or a
 * duration <= 0) no transition state is kept — the switch is instant.
 */
export function switchSceneWithTransition(sceneId: string): void {
  const store = useStudioStore.getState();
  const project = store.project;
  if (!project) return;
  const target = project.scenes.find((s) => s.id === sceneId);
  if (!target || project.timeline.currentSceneId === sceneId) return;
  const kind = (target.transition ?? 'dissolve') as SceneTransitionKind;
  const durationSec = Math.min(3, Math.max(0, target.transitionDuration ?? 1));
  if (kind !== 'cut' && durationSec > 0) {
    active = {
      fromSurfaces: JSON.parse(JSON.stringify(project.surfaces)) as Surface[],
      startedAt: performance.now(),
      durationMs: durationSec * 1000,
      kind,
    };
  } else {
    active = null;
  }
  store.switchScene(sceneId);
}

/** Opacity multiplier for a surface in the merged transition render. */
export function transitionOpacity(
  transition: ActiveTransition,
  isOutgoing: boolean,
  nowMs: number,
): number {
  const p = Math.min(1, Math.max(0, (nowMs - transition.startedAt) / transition.durationMs));
  // fade/dissolve/crossfade all ramp opacity linearly; dissolve also
  // crossfades (no dither pattern — the honest, simple version).
  return isOutgoing ? 1 - p : p;
}

export function transitionDone(transition: ActiveTransition, nowMs: number): boolean {
  return nowMs - transition.startedAt >= transition.durationMs;
}
