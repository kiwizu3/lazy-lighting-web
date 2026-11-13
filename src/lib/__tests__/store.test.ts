// Zustand studio store — real store, IndexedDB mocked out.
// The store's db layer is replaced with in-memory mocks so no test ever
// touches IndexedDB; autosave timers run on fake timers and never fire
// unless a test advances them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  deleteProject: vi.fn().mockResolvedValue(undefined),
  listProjects: vi.fn().mockResolvedValue([]),
  loadProject: vi.fn().mockResolvedValue(null),
  saveProject: vi.fn().mockResolvedValue(undefined),
  seedDemoIfEmpty: vi.fn().mockResolvedValue(null),
}));

import { freshProject, type Project, type Scene, type Surface } from '../schema';
import { useStudioStore } from '../store';

let n = 0;
function v1Surface(overrides: Partial<Surface> = {}): Surface {
  n += 1;
  return {
    id: `surf_test_${n}`,
    name: `Surface ${n}`,
    shape: 'rect',
    corners: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.5 },
      { x: 0.1, y: 0.5 },
    ],
    content: { kind: 'visual', visualId: 'aurora' },
    opacity: 1,
    visible: true,
    locked: false,
    blendMode: 'normal',
    z: n,
    effects: [],
    ...overrides,
  };
}

function twoSceneProject(): Project {
  const p = freshProject('Scene Test');
  const s1 = v1Surface({ id: 'surf_a', name: 'A', opacity: 1 });
  const s1b = v1Surface({ id: 'surf_a', name: 'A', opacity: 0.2 });
  const sceneA: Scene = {
    id: 'scene_a',
    name: 'A',
    surfaceIds: ['surf_a'],
    snapshot: [s1],
    transition: 'dissolve',
    transitionDuration: 1,
  };
  const sceneB: Scene = {
    id: 'scene_b',
    name: 'B',
    surfaceIds: ['surf_a'],
    snapshot: [s1b],
    transition: 'fade',
    transitionDuration: 0.5,
  };
  return {
    ...p,
    surfaces: [s1],
    scenes: [sceneA, sceneB],
    timeline: { ...p.timeline, currentSceneId: 'scene_a' },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useStudioStore.setState({
    project: null,
    past: [],
    future: [],
    selectedSurfaceId: null,
    selectedSceneId: null,
    dirty: false,
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('project lifecycle', () => {
  it('setProject stores the project and clears history', () => {
    const p = freshProject('Hello');
    useStudioStore.getState().setProject(p);
    const s = useStudioStore.getState();
    expect(s.project?.name).toBe('Hello');
    expect(s.project?.surfaces).toEqual([]);
    expect(s.past).toHaveLength(0);
    expect(s.dirty).toBe(false);
  });
});

describe('surfaces', () => {
  it('adds a surface and selects it', () => {
    const api = useStudioStore.getState();
    api.setProject(freshProject('T'));
    const surf = v1Surface();
    useStudioStore.getState().addSurface(surf);
    const s = useStudioStore.getState();
    expect(s.project?.surfaces).toHaveLength(1);
    expect(s.project?.surfaces[0].id).toBe(surf.id);
    expect(s.selectedSurfaceId).toBe(surf.id);
  });

  it('duplicates a surface with a new id, "copy" name and higher z', () => {
    const api = useStudioStore.getState();
    api.setProject(freshProject('T'));
    const surf = v1Surface({ z: 3 });
    useStudioStore.getState().addSurface(surf);
    useStudioStore.getState().duplicateSurface(surf.id);
    const s = useStudioStore.getState();
    expect(s.project?.surfaces).toHaveLength(2);
    const copy = s.project!.surfaces[1];
    expect(copy.id).not.toBe(surf.id);
    expect(copy.name).toBe(`${surf.name} copy`);
    expect(copy.z).toBeGreaterThan(3);
    expect(copy.content.visualId).toBe('aurora');
    expect(s.selectedSurfaceId).toBe(copy.id);
  });

  it('removes a surface and clears the selection', () => {
    const api = useStudioStore.getState();
    api.setProject(freshProject('T'));
    const surf = v1Surface();
    useStudioStore.getState().addSurface(surf);
    expect(useStudioStore.getState().project?.surfaces).toHaveLength(1);
    useStudioStore.getState().removeSurface(surf.id);
    const s = useStudioStore.getState();
    expect(s.project?.surfaces).toHaveLength(0);
    expect(s.selectedSurfaceId).toBeNull();
  });

  it('ignores duplicate/remove for unknown ids', () => {
    useStudioStore.getState().setProject(freshProject('T'));
    useStudioStore.getState().duplicateSurface('nope');
    useStudioStore.getState().removeSurface('nope');
    expect(useStudioStore.getState().project?.surfaces).toHaveLength(0);
  });
});

describe('undo / redo', () => {
  it('undo restores the previous state and redo re-applies it', () => {
    const api = useStudioStore.getState();
    api.setProject(freshProject('T'));
    const surf = v1Surface();
    useStudioStore.getState().addSurface(surf);
    expect(useStudioStore.getState().project?.surfaces).toHaveLength(1);

    useStudioStore.getState().undo();
    expect(useStudioStore.getState().project?.surfaces).toHaveLength(0);

    useStudioStore.getState().redo();
    expect(useStudioStore.getState().project?.surfaces).toHaveLength(1);
    expect(useStudioStore.getState().project?.surfaces[0].id).toBe(surf.id);
  });

  it('undo is a no-op with empty history; a new edit clears the redo stack', () => {
    useStudioStore.getState().setProject(freshProject('T'));
    useStudioStore.getState().undo(); // no-op, must not throw
    expect(useStudioStore.getState().project?.surfaces).toHaveLength(0);

    const a = v1Surface();
    useStudioStore.getState().addSurface(a);
    useStudioStore.getState().undo();
    const b = v1Surface();
    useStudioStore.getState().addSurface(b);
    useStudioStore.getState().redo(); // cleared by the new edit
    expect(useStudioStore.getState().project?.surfaces).toHaveLength(1);
    expect(useStudioStore.getState().project?.surfaces[0].id).toBe(b.id);
  });

  it('undo restores an edited surface value', () => {
    useStudioStore.getState().setProject(freshProject('T'));
    const surf = v1Surface({ opacity: 1 });
    useStudioStore.getState().addSurface(surf);
    useStudioStore.getState().updateSurface(surf.id, { opacity: 0.25 });
    expect(useStudioStore.getState().project?.surfaces[0].opacity).toBe(0.25);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().project?.surfaces[0].opacity).toBe(1);
  });
});

describe('switchScene', () => {
  it('restores the target scene snapshot and snapshots the outgoing scene', () => {
    useStudioStore.getState().setProject(twoSceneProject());
    expect(useStudioStore.getState().project?.surfaces[0].opacity).toBe(1);

    useStudioStore.getState().switchScene('scene_b');
    let s = useStudioStore.getState();
    expect(s.project?.surfaces[0].opacity).toBe(0.2);
    expect(s.project?.timeline.currentSceneId).toBe('scene_b');
    expect(s.selectedSceneId).toBe('scene_b');

    // Edit while B is active, then switch back: B's snapshot keeps the edit.
    useStudioStore.getState().updateSurface('surf_a', { opacity: 0.7 });
    useStudioStore.getState().switchScene('scene_a');
    s = useStudioStore.getState();
    expect(s.project?.surfaces[0].opacity).toBe(1);
    expect(s.project?.timeline.currentSceneId).toBe('scene_a');

    // And back to B restores the edited 0.7, not the original 0.2.
    useStudioStore.getState().switchScene('scene_b');
    s = useStudioStore.getState();
    expect(s.project?.surfaces[0].opacity).toBe(0.7);
  });

  it('ignores an unknown scene id', () => {
    useStudioStore.getState().setProject(twoSceneProject());
    useStudioStore.getState().switchScene('nope');
    expect(useStudioStore.getState().project?.timeline.currentSceneId).toBe('scene_a');
  });
});
