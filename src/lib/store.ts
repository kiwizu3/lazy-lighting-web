// Zustand store — single source of truth for the v2 editor.
// Project snapshots are kept in a bounded undo/redo stack (50).
// Autosave: debounced 1.5s save to IndexedDB on project change + manual save.
import { create } from 'zustand';
import type { AudioTrack, Project, Scene, Surface, TimelineClip, TimelineKeyframe, TimelineTrack } from './schema';
import { demoV1Project, freshProject, migrateProject } from './schema';
import { deleteProject as dbDeleteProject, listProjects as dbListProjects, loadProject as dbLoadProject, saveProject as dbSaveProject, seedDemoIfEmpty, type ProjectMeta } from './db';
import { uid } from './types';

export type Quality = 'performance' | 'balanced' | 'high';

interface PlaybackState {
  playing: boolean;
  time: number;
  bpm: number;
}

interface StudioState {
  project: Project | null;
  projects: ProjectMeta[];
  selectedSurfaceId: string | null;
  selectedSceneId: string | null;
  playback: PlaybackState;
  quality: Quality;
  grid: boolean;
  snap: boolean;
  performanceMode: boolean;
  savedAt: number | null;
  saving: boolean;
  dirty: boolean;
  past: Project[];
  future: Project[];

  // Project lifecycle
  setProject: (p: Project) => void;
  /** Load a project received over BroadcastChannel (output window): sets the
   * project without resetting playback time / playing state. */
  setProjectExternal: (p: Project) => void;
  loadProjectById: (id: string) => Promise<Project | null>;
  newProject: (name?: string) => Promise<Project>;
  refreshProjectList: () => Promise<void>;
  renameProject: (name: string) => void;
  saveNow: () => Promise<void>;
  exportProject: () => void;
  importProjectFile: (file: File) => Promise<Project | null>;
  deleteCurrentProject: () => Promise<void>;

  // Surfaces
  updateSurface: (id: string, patch: Partial<Surface>) => void;
  addSurface: (surface: Surface) => void;
  removeSurface: (id: string) => void;
  duplicateSurface: (id: string) => void;
  reorderSurfaces: (ids: string[]) => void;
  selectSurface: (id: string | null) => void;

  // Scenes
  addScene: (name?: string) => void;
  switchScene: (id: string) => void;
  selectScene: (id: string | null) => void;
  renameScene: (id: string, name: string) => void;
  duplicateScene: (id: string) => void;
  deleteScene: (id: string) => void;
  reorderScenes: (ids: string[]) => void;
  updateScene: (id: string, patch: Partial<Scene>) => void;
  /** Capture the live surface set into a scene's snapshot (for manual re-sync). */
  snapshotScene: (id: string) => void;

  // Audio track (project-level; uses mutate, so undo history is preserved)
  setAudioTrack: (track: AudioTrack | null) => void;

  // Timeline
  addTimelineTrack: (kind: TimelineTrack['kind'], name?: string) => void;
  removeTimelineTrack: (trackId: string) => void;
  addTimelineClip: (trackId: string, clip: { start: number; duration: number; label?: string; sceneId?: string; mediaId?: string; speed?: number }) => void;
  updateTimelineClip: (clipId: string, patch: Partial<TimelineClip>) => void;
  removeTimelineClip: (clipId: string) => void;
  duplicateTimelineClip: (clipId: string) => void;
  splitTimelineClip: (clipId: string, atTime: number) => void;
  addTimelineKeyframe: (trackId: string, keyframe: { time: number; param: string; value: number; surfaceId?: string }) => void;
  updateTimelineKeyframe: (keyframeId: string, patch: Partial<TimelineKeyframe>) => void;
  removeTimelineKeyframe: (keyframeId: string) => void;
  setTimelineDuration: (seconds: number) => void;
  setTimelineLoop: (loop: boolean) => void;
  setTimelineBpmSync: (bpmSync: boolean) => void;

  // Output / stage settings
  setAspect: (aspect: Project['settings']['aspect'], customW?: number, customH?: number) => void;

  // Playback / view
  setPlaying: (playing: boolean) => void;
  setTime: (time: number) => void;
  setBpm: (bpm: number) => void;
  setQuality: (q: Quality) => void;
  setGrid: (v: boolean) => void;
  setSnap: (v: boolean) => void;
  setPerformanceMode: (v: boolean) => void;

  // History
  undo: () => void;
  redo: () => void;
}

const HISTORY_LIMIT = 50;
const AUTOSAVE_DELAY_MS = 1500;

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave(get: () => StudioState) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const s = get();
    if (s.project && s.dirty) void s.saveNow();
  }, AUTOSAVE_DELAY_MS);
}

function pushHistory(past: Project[], project: Project): Project[] {
  const next = [...past, project];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

/** Apply a project mutation with undo support + autosave scheduling. */
function mutate(
  set: (fn: (s: StudioState) => Partial<StudioState>) => void,
  get: () => StudioState,
  fn: (p: Project) => Project,
) {
  const current = get().project;
  if (!current) return;
  const next = { ...fn(current), updatedAt: Date.now() };
  set((s) => ({
    project: next,
    past: pushHistory(s.past, current),
    future: [],
    dirty: true,
  }));
  scheduleAutosave(get);
}

const persistedSettings = (): { quality: Quality; grid: boolean; snap: boolean } => {
  if (typeof window === 'undefined') return { quality: 'balanced', grid: true, snap: true };
  try {
    const raw = localStorage.getItem('lazy-lighting-settings-v2');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<{ quality: Quality; grid: boolean; snap: boolean }>;
      return {
        quality: parsed.quality ?? 'balanced',
        grid: parsed.grid ?? true,
        snap: parsed.snap ?? true,
      };
    }
  } catch { /* ignore */ }
  return { quality: 'balanced', grid: true, snap: true };
};

function persistSettings(quality: Quality, grid: boolean, snap: boolean) {
  try {
    localStorage.setItem('lazy-lighting-settings-v2', JSON.stringify({ quality, grid, snap }));
  } catch { /* ignore */ }
}

export const useStudioStore = create<StudioState>()((set, get) => {
  const settings = persistedSettings();
  return {
    project: null,
    projects: [],
    selectedSurfaceId: null,
    selectedSceneId: null,
    playback: { playing: false, time: 0, bpm: 120 },
    quality: settings.quality,
    grid: settings.grid,
    snap: settings.snap,
    performanceMode: false,
    savedAt: null,
    saving: false,
    dirty: false,
    past: [],
    future: [],

    setProject: (p) => {
      set({ project: p, past: [], future: [], dirty: false, selectedSurfaceId: null, selectedSceneId: p.timeline.currentSceneId ?? p.scenes[0]?.id ?? null, playback: { playing: false, time: 0, bpm: p.timeline.bpm ?? 120 } });
      scheduleAutosave(get);
    },

    setProjectExternal: (p) => {
      set((s) => ({
        project: p,
        past: [],
        future: [],
        dirty: false,
        selectedSurfaceId: null,
        selectedSceneId: p.timeline.currentSceneId ?? p.scenes[0]?.id ?? null,
        playback: { ...s.playback, bpm: p.timeline.bpm ?? s.playback.bpm },
      }));
    },

    loadProjectById: async (id) => {
      const p = await dbLoadProject(id);
      if (p) {
        get().setProject(p);
        return p;
      }
      return null;
    },

    newProject: async (name) => {
      const p = freshProject(name ?? 'Untitled Project');
      await dbSaveProject(p);
      get().setProject(p);
      await get().refreshProjectList();
      return p;
    },

    refreshProjectList: async () => {
      const list = await dbListProjects();
      set({ projects: list });
    },

    renameProject: (name) => {
      mutate(set, get, (p) => ({ ...p, name }));
    },

    saveNow: async () => {
      const p = get().project;
      if (!p) return;
      set({ saving: true });
      await dbSaveProject(p);
      set({ saving: false, savedAt: Date.now(), dirty: false });
      await get().refreshProjectList();
    },

    exportProject: () => {
      const p = get().project;
      if (!p || typeof window === 'undefined') return;
      const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${p.name.replace(/[^\w\-]+/g, '-').toLowerCase() || 'project'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },

    importProjectFile: async (file) => {
      try {
        const text = await file.text();
        const parsed: unknown = JSON.parse(text);
        const project = migrateProject(parsed);
        await dbSaveProject(project);
        get().setProject(project);
        await get().refreshProjectList();
        return project;
      } catch (err) {
        console.warn('[store] importProjectFile failed', err);
        return null;
      }
    },

    deleteCurrentProject: async () => {
      const p = get().project;
      if (!p) return;
      await dbDeleteProject(p.id);
      set({ project: null, past: [], future: [], dirty: false });
      await get().refreshProjectList();
    },

    updateSurface: (id, patch) => {
      mutate(set, get, (p) => ({
        ...p,
        surfaces: p.surfaces.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      }));
    },

    addSurface: (surface) => {
      mutate(set, get, (p) => ({ ...p, surfaces: [...p.surfaces, surface] }));
      set({ selectedSurfaceId: surface.id });
    },

    removeSurface: (id) => {
      mutate(set, get, (p) => ({ ...p, surfaces: p.surfaces.filter((s) => s.id !== id) }));
      if (get().selectedSurfaceId === id) set({ selectedSurfaceId: null });
    },

    duplicateSurface: (id) => {
      const p = get().project;
      if (!p) return;
      const src = p.surfaces.find((s) => s.id === id);
      if (!src) return;
      const copy: Surface = {
        ...JSON.parse(JSON.stringify(src)) as Surface,
        id: uid('surf'),
        name: `${src.name} copy`,
        z: (p.surfaces.reduce((m, s) => Math.max(m, s.z ?? 0), 0) + 1),
      };
      mutate(set, get, (proj) => ({ ...proj, surfaces: [...proj.surfaces, copy] }));
      set({ selectedSurfaceId: copy.id });
    },

    reorderSurfaces: (ids) => {
      mutate(set, get, (p) => {
        const byId = new Map(p.surfaces.map((s) => [s.id, s]));
        const ordered = ids.map((id) => byId.get(id)).filter((s): s is Surface => !!s);
        const rest = p.surfaces.filter((s) => !ids.includes(s.id));
        return { ...p, surfaces: [...ordered, ...rest].map((s, i) => ({ ...s, z: i + 1 })) };
      });
    },

    selectSurface: (id) => set({ selectedSurfaceId: id }),

    addScene: (name) => {
      const p = get().project;
      if (!p) return;
      const scene: Scene = {
        id: uid('scene'),
        name: name ?? `Scene ${p.scenes.length + 1}`,
        surfaceIds: p.surfaces.map((s) => s.id),
        // Snapshot the live surface set so switching back restores it.
        snapshot: JSON.parse(JSON.stringify(p.surfaces)) as Surface[],
        transition: 'dissolve',
        transitionDuration: 1,
      };
      mutate(set, get, (proj) => ({ ...proj, scenes: [...proj.scenes, scene] }));
      set({ selectedSceneId: scene.id });
    },

    switchScene: (id) => {
      const p = get().project;
      if (!p) return;
      const target = p.scenes.find((s) => s.id === id);
      if (!target) return;
      const currentId = p.timeline.currentSceneId;
      mutate(set, get, (proj) => {
        // Snapshot the outgoing scene's live surfaces first, so edits made
        // while it was active are not lost when switching away.
        const scenes = proj.scenes.map((sc) =>
          sc.id === currentId
            ? { ...sc, surfaceIds: proj.surfaces.map((s) => s.id), snapshot: JSON.parse(JSON.stringify(proj.surfaces)) as Surface[] }
            : sc,
        );
        // Restore the incoming scene: prefer its snapshot; fall back to
        // filtering the live surfaces by its surfaceIds.
        const next = scenes.find((s) => s.id === id)!;
        const surfaces = next.snapshot
          ? (JSON.parse(JSON.stringify(next.snapshot)) as Surface[])
          : proj.surfaces.filter((s) => next.surfaceIds.includes(s.id));
        return {
          ...proj,
          scenes,
          surfaces,
          timeline: { ...proj.timeline, currentSceneId: id },
        };
      });
      set({ selectedSceneId: id });
    },

    selectScene: (id) => set({ selectedSceneId: id }),

    renameScene: (id, name) => {
      mutate(set, get, (p) => ({ ...p, scenes: p.scenes.map((s) => (s.id === id ? { ...s, name } : s)) }));
    },

    duplicateScene: (id) => {
      const p = get().project;
      if (!p) return;
      const src = p.scenes.find((s) => s.id === id);
      if (!src) return;
      const copy: Scene = {
        ...JSON.parse(JSON.stringify(src)) as Scene,
        id: uid('scene'),
        name: `${src.name} copy`,
      };
      mutate(set, get, (proj) => ({ ...proj, scenes: [...proj.scenes, copy] }));
      set({ selectedSceneId: copy.id });
    },

    deleteScene: (id) => {
      const p = get().project;
      if (!p) return;
      mutate(set, get, (proj) => ({
        ...proj,
        scenes: proj.scenes.filter((s) => s.id !== id),
        timeline: {
          ...proj.timeline,
          currentSceneId:
            proj.timeline.currentSceneId === id ? (proj.scenes.find((s) => s.id !== id)?.id ?? undefined) : proj.timeline.currentSceneId,
        },
      }));
      if (get().selectedSceneId === id) set({ selectedSceneId: null });
    },

    reorderScenes: (ids) => {
      mutate(set, get, (p) => {
        const byId = new Map(p.scenes.map((s) => [s.id, s]));
        const ordered = ids.map((id) => byId.get(id)).filter((s): s is Scene => !!s);
        const rest = p.scenes.filter((s) => !ids.includes(s.id));
        return { ...p, scenes: [...ordered, ...rest] };
      });
    },

    updateScene: (id, patch) => {
      mutate(set, get, (p) => ({ ...p, scenes: p.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    },

    snapshotScene: (id) => {
      const p = get().project;
      if (!p) return;
      mutate(set, get, (proj) => ({
        ...proj,
        scenes: proj.scenes.map((s) =>
          s.id === id
            ? { ...s, surfaceIds: proj.surfaces.map((x) => x.id), snapshot: JSON.parse(JSON.stringify(proj.surfaces)) as Surface[] }
            : s,
        ),
      }));
    },

    setAudioTrack: (track) => {
      // mutate() pushes ONE undo entry and keeps the rest of history —
      // unlike setProject, which clears it. Callers (MediaLibrary) must
      // use this instead of setProject for audio assignment.
      mutate(set, get, (p) => ({ ...p, audioTracks: track ? [track] : [] }));
    },

    addTimelineTrack: (kind, name) => {
      const track: TimelineTrack = {
        id: uid('track'),
        kind,
        name: name ?? `${kind[0].toUpperCase()}${kind.slice(1)} ${((get().project?.timeline.tracks ?? []).filter((t) => t.kind === kind).length) + 1}`,
        clips: [],
        keyframes: [],
      };
      mutate(set, get, (p) => ({ ...p, timeline: { ...p.timeline, tracks: [...(p.timeline.tracks ?? []), track] } }));
    },

    removeTimelineTrack: (trackId) => {
      mutate(set, get, (p) => ({ ...p, timeline: { ...p.timeline, tracks: (p.timeline.tracks ?? []).filter((t) => t.id !== trackId) } }));
    },

    addTimelineClip: (trackId, clip) => {
      const full: TimelineClip = {
        id: uid('clip'),
        trackId,
        start: clip.start,
        duration: clip.duration,
        label: clip.label ?? '',
        speed: clip.speed ?? 1,
        ...(clip.sceneId ? { sceneId: clip.sceneId } : {}),
        ...(clip.mediaId ? { mediaId: clip.mediaId } : {}),
      };
      mutate(set, get, (p) => ({
        ...p,
        timeline: {
          ...p.timeline,
          tracks: (p.timeline.tracks ?? []).map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, full] } : t)),
        },
      }));
    },

    updateTimelineClip: (clipId, patch) => {
      mutate(set, get, (p) => ({
        ...p,
        timeline: {
          ...p.timeline,
          tracks: (p.timeline.tracks ?? []).map((t) => ({
            ...t,
            clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
          })),
        },
      }));
    },

    removeTimelineClip: (clipId) => {
      mutate(set, get, (p) => ({
        ...p,
        timeline: {
          ...p.timeline,
          tracks: (p.timeline.tracks ?? []).map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) })),
        },
      }));
    },

    duplicateTimelineClip: (clipId) => {
      const p = get().project;
      if (!p) return;
      for (const t of p.timeline.tracks ?? []) {
        const src = t.clips.find((c) => c.id === clipId);
        if (!src) continue;
        const copy: TimelineClip = { ...JSON.parse(JSON.stringify(src)) as TimelineClip, id: uid('clip'), start: src.start + src.duration };
        mutate(set, get, (proj) => ({
          ...proj,
          timeline: {
            ...proj.timeline,
            tracks: (proj.timeline.tracks ?? []).map((tr) => (tr.id === t.id ? { ...tr, clips: [...tr.clips, copy] } : tr)),
          },
        }));
        return;
      }
    },

    splitTimelineClip: (clipId, atTime) => {
      const p = get().project;
      if (!p) return;
      for (const t of p.timeline.tracks ?? []) {
        const src = t.clips.find((c) => c.id === clipId);
        if (!src) continue;
        if (atTime <= src.start || atTime >= src.start + src.duration) return;
        const left: TimelineClip = { ...src, duration: atTime - src.start };
        const right: TimelineClip = { ...JSON.parse(JSON.stringify(src)) as TimelineClip, id: uid('clip'), start: atTime, duration: src.start + src.duration - atTime };
        mutate(set, get, (proj) => ({
          ...proj,
          timeline: {
            ...proj.timeline,
            tracks: (proj.timeline.tracks ?? []).map((tr) =>
              tr.id === t.id ? { ...tr, clips: tr.clips.map((c) => (c.id === clipId ? left : c)).concat([right]) } : tr,
            ),
          },
        }));
        return;
      }
    },

    addTimelineKeyframe: (trackId, keyframe) => {
      const full: TimelineKeyframe = {
        id: uid('kf'),
        time: keyframe.time,
        param: keyframe.param,
        value: keyframe.value,
        ...(keyframe.surfaceId ? { surfaceId: keyframe.surfaceId } : {}),
      };
      mutate(set, get, (p) => ({
        ...p,
        timeline: {
          ...p.timeline,
          tracks: (p.timeline.tracks ?? []).map((t) => (t.id === trackId ? { ...t, keyframes: [...(t.keyframes ?? []), full].sort((a, b) => a.time - b.time) } : t)),
        },
      }));
    },

    updateTimelineKeyframe: (keyframeId, patch) => {
      mutate(set, get, (p) => ({
        ...p,
        timeline: {
          ...p.timeline,
          tracks: (p.timeline.tracks ?? []).map((t) => ({
            ...t,
            keyframes: (t.keyframes ?? []).map((k) => (k.id === keyframeId ? { ...k, ...patch } : k)).sort((a, b) => a.time - b.time),
          })),
        },
      }));
    },

    removeTimelineKeyframe: (keyframeId) => {
      mutate(set, get, (p) => ({
        ...p,
        timeline: {
          ...p.timeline,
          tracks: (p.timeline.tracks ?? []).map((t) => ({ ...t, keyframes: (t.keyframes ?? []).filter((k) => k.id !== keyframeId) })),
        },
      }));
    },

    setTimelineDuration: (seconds) => {
      mutate(set, get, (p) => ({ ...p, timeline: { ...p.timeline, duration: Math.max(1, seconds) } }));
    },

    setTimelineLoop: (loop) => {
      mutate(set, get, (p) => ({ ...p, timeline: { ...p.timeline, loop } }));
    },

    setTimelineBpmSync: (bpmSync) => {
      mutate(set, get, (p) => ({ ...p, timeline: { ...p.timeline, bpmSync } }));
    },

    setAspect: (aspect, customW, customH) => {
      mutate(set, get, (p) => ({
        ...p,
        settings: {
          ...p.settings,
          aspect,
          ...(customW !== undefined ? { customAspectWidth: Math.max(1, customW) } : {}),
          ...(customH !== undefined ? { customAspectHeight: Math.max(1, customH) } : {}),
        },
      }));
    },

    setPlaying: (playing) => set((s) => ({ playback: { ...s.playback, playing } })),
    setTime: (time) => set((s) => ({ playback: { ...s.playback, time } })),
    setBpm: (bpm) => {
      set((s) => ({ playback: { ...s.playback, bpm } }));
      mutate(set, get, (p) => ({ ...p, timeline: { ...p.timeline, bpm } }));
    },
    setQuality: (q) => { set({ quality: q }); persistSettings(q, get().grid, get().snap); },
    setGrid: (v) => { set({ grid: v }); persistSettings(get().quality, v, get().snap); },
    setSnap: (v) => { set({ snap: v }); persistSettings(get().quality, get().grid, v); },
    setPerformanceMode: (v) => set({ performanceMode: v }),

    undo: () => {
      const { past, future, project } = get();
      if (past.length === 0 || !project) return;
      const prev = past[past.length - 1];
      set({ project: prev, past: past.slice(0, -1), future: [project, ...future], dirty: true });
      scheduleAutosave(get);
    },

    redo: () => {
      const { past, future, project } = get();
      if (future.length === 0 || !project) return;
      const [next, ...rest] = future;
      set({ project: next, past: [...past, project], future: rest, dirty: true });
      scheduleAutosave(get);
    },
  };
});

// Granular selectors (use these in components to avoid re-rendering on
// unrelated store changes).
export const selectProject = (s: StudioState) => s.project;
export const selectProjectName = (s: StudioState) => s.project?.name ?? '';
export const selectSurfaces = (s: StudioState) => s.project?.surfaces ?? [];
export const selectScenes = (s: StudioState) => s.project?.scenes ?? [];
export const selectTimeline = (s: StudioState) => s.project?.timeline ?? null;
export const selectAudioTrack = (s: StudioState) => s.project?.audioTracks?.[0] ?? null;
export const selectAspect = (s: StudioState) => s.project?.settings?.aspect ?? '16:9';
export const selectSelectedSurfaceId = (s: StudioState) => s.selectedSurfaceId;
export const selectPlaying = (s: StudioState) => s.playback.playing;
export const selectQuality = (s: StudioState) => s.quality;
export const selectCanUndo = (s: StudioState) => s.past.length > 0;
export const selectCanRedo = (s: StudioState) => s.future.length > 0;

/** Seed the demo project on first run (IndexedDB empty). Returns the demo or null. */
export async function ensureDemoSeeded(): Promise<Project | null> {
  const seeded = await seedDemoIfEmpty();
  if (seeded) return seeded;
  return demoV1Project();
}
