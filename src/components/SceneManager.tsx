// Scene manager — Phase 5.
// A scene is a snapshot of the full surface set (content, effects, masks,
// layers). Switching restores the snapshot; the outgoing scene is
// re-snapshotted first so edits made while it was active are kept.
// Transitions (cut / fade / dissolve / crossfade, 0.2–3 s) render as a
// transient opacity ramp in the engine — no store writes per frame.
'use client';
import { useState } from 'react';
import { useStudioStore } from '../lib/store';
import type { Scene } from '../lib/schema';
import { switchSceneWithTransition } from '../lib/sceneTransition';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Slider } from './ui/slider';

const TRANSITIONS: { id: Scene['transition']; label: string }[] = [
  { id: 'cut', label: 'Cut' },
  { id: 'fade', label: 'Fade' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'crossfade', label: 'Crossfade' },
];

export default function SceneManager() {
  const project = useStudioStore((s) => s.project);
  const scenes = project?.scenes ?? [];
  const currentSceneId = project?.timeline.currentSceneId ?? null;
  const selectedSceneId = useStudioStore((s) => s.selectedSceneId);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const store = useStudioStore.getState();

  if (!project) return <p className="text-xs text-zinc-500">No project open.</p>;

  const commitRename = (scene: Scene) => {
    const name = renameDraft.trim();
    if (name && name !== scene.name) store.renameScene(scene.id, name);
    setRenamingId(null);
  };

  const move = (id: string, dir: -1 | 1) => {
    const ids = scenes.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    store.reorderScenes(ids);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Scenes</h2>
        <span className="text-[11px] text-zinc-500">{scenes.length} scene{scenes.length === 1 ? '' : 's'}</span>
      </div>

      {scenes.length === 0 && (
        <p className="text-xs text-zinc-500">
          No scenes yet — a scene snapshots every surface (content, effects, masks, layers).
          Create one to capture the current stage.
        </p>
      )}

      <ul className="space-y-2">
        {scenes.map((scene, i) => {
          const active = scene.id === currentSceneId;
          const selected = scene.id === selectedSceneId;
          const surfaceCount = scene.snapshot?.length ?? scene.surfaceIds.length;
          return (
            <li
              key={scene.id}
              className={`space-y-2 rounded border p-2 ${active ? 'border-amber-500/60 bg-amber-500/10' : selected ? 'border-zinc-600 bg-zinc-800/60' : 'border-zinc-800 bg-zinc-900/60'}`}
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    switchSceneWithTransition(scene.id);
                    setNotice(`Switched to “${scene.name}” (${scene.transition}, ${scene.transitionDuration}s).`);
                  }}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium text-zinc-100 hover:text-amber-300"
                  title="Switch to this scene (with its transition)"
                >
                  {renamingId === scene.id ? (
                    <Input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRename(scene)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(scene);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full"
                      aria-label="Scene name"
                    />
                  ) : (
                    <>
                      {active ? '▶ ' : ''}{scene.name}
                    </>
                  )}
                </button>
                <span className="shrink-0 text-[10px] text-zinc-500">
                  {surfaceCount} surface{surfaceCount === 1 ? '' : 's'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <button type="button" title="Move up" disabled={i === 0} onClick={() => move(scene.id, -1)} className="rounded border border-zinc-700 px-1.5 py-0.5 disabled:opacity-30">↑</button>
                <button type="button" title="Move down" disabled={i === scenes.length - 1} onClick={() => move(scene.id, 1)} className="rounded border border-zinc-700 px-1.5 py-0.5 disabled:opacity-30">↓</button>
                <button
                  type="button"
                  onClick={() => {
                    setRenamingId(scene.id);
                    setRenameDraft(scene.name);
                  }}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 hover:bg-zinc-800"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => store.duplicateScene(scene.id)}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 hover:bg-zinc-800"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    store.snapshotScene(scene.id);
                    setNotice(`“${scene.name}” re-snapshotted from the current stage.`);
                  }}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 hover:bg-zinc-800"
                  title="Overwrite this scene's snapshot with the current stage"
                >
                  Re-snapshot
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${scene.name}`}
                  onClick={() => store.deleteScene(scene.id)}
                  className="rounded border border-red-900 px-1.5 py-0.5 text-red-300 hover:bg-red-900/40"
                >
                  ✕
                </button>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                  Transition
                  <select
                    value={scene.transition}
                    onChange={(e) => store.updateScene(scene.id, { transition: e.target.value as Scene['transition'] })}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                    aria-label={`${scene.name} transition`}
                  >
                    {TRANSITIONS.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </label>
                <span className="flex-1">
                  <Slider
                    label="Duration"
                    value={Math.round(scene.transitionDuration * 10) / 10}
                    min={0.2}
                    max={3}
                    step={0.1}
                    onChange={(v) => store.updateScene(scene.id, { transitionDuration: v })}
                    format={(v) => `${v.toFixed(1)}s`}
                  />
                </span>
              </div>
              {active && <p className="text-[11px] text-amber-300">Live on stage now.</p>}
            </li>
          );
        })}
      </ul>

      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          store.addScene();
          setNotice('Scene created from the current stage.');
        }}
      >
        + New scene from current stage
      </Button>
      <p className="text-[11px] leading-snug text-zinc-500">
        Switching snapshots the scene you leave and restores the one you pick. MIDI note
        mappings and timeline scene clips switch scenes the same way, with the same transition.
      </p>
      {notice && (
        <p className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300" role="status">
          {notice}
          <button type="button" className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}
    </div>
  );
}
