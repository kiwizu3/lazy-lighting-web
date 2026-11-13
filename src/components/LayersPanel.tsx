// LayersPanel — surfaces in z order (top = highest z), with visibility /
// lock / rename / opacity / duplicate / delete / drag-reorder, plus simple
// layer groups. Groups only organise the panel and drive bulk visibility /
// lock: group membership lives on the surface (passthrough `groupId` field)
// and group definitions (name, collapsed) persist in localStorage per
// project — the v1 project schema has no groups array yet.
'use client';
import { useEffect, useState } from 'react';
import { useStudioStore } from '../lib/store';
import type { Surface } from '../lib/schema';

interface GroupDef {
  id: string;
  name: string;
  collapsed: boolean;
}

function groupsKey(projectId: string): string {
  return `lazy-lighting-groups-${projectId}`;
}

function loadGroups(projectId: string): GroupDef[] {
  try {
    const raw = localStorage.getItem(groupsKey(projectId));
    if (raw) return JSON.parse(raw) as GroupDef[];
  } catch {
    /* ignore */
  }
  return [];
}

function saveGroups(projectId: string, groups: GroupDef[]): void {
  try {
    localStorage.setItem(groupsKey(projectId), JSON.stringify(groups));
  } catch {
    /* ignore */
  }
}

function surfaceGroupId(s: Surface): string | null {
  return ((s as unknown as { groupId?: unknown }).groupId as string | null) ?? null;
}

function swatchColor(s: Surface): string {
  const colors = (s.content as unknown as { colors?: [string, string] }).colors;
  if (colors?.[0]) return colors[0];
  return '#f59e0b';
}

export default function LayersPanel() {
  const project = useStudioStore((s) => s.project);
  const selectedSurfaceId = useStudioStore((s) => s.selectedSurfaceId);
  const surfaces = project?.surfaces ?? [];
  const [groups, setGroups] = useState<GroupDef[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    if (project) setGroups(loadGroups(project.id));
  }, [project?.id]);

  const updateGroups = (next: GroupDef[]) => {
    setGroups(next);
    if (project) saveGroups(project.id, next);
  };

  const store = useStudioStore.getState();
  // Top of the panel = highest z.
  const ordered = [...surfaces].sort((a, b) => (b.z ?? 1) - (a.z ?? 1));

  const commitRename = (s: Surface) => {
    const name = renameDraft.trim();
    if (name && name !== s.name) store.updateSurface(s.id, { name });
    setRenamingId(null);
  };

  const onDropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    // reorderSurfaces takes bottom-to-top order (index 0 gets z=1).
    const idsTopFirst = ordered.map((s) => s.id);
    const from = idsTopFirst.indexOf(dragId);
    const to = idsTopFirst.indexOf(targetId);
    idsTopFirst.splice(from, 1);
    idsTopFirst.splice(to, 0, dragId);
    store.reorderSurfaces([...idsTopFirst].reverse());
    setDragId(null);
  };

  const createGroup = () => {
    const name = window.prompt('Group name', `Group ${groups.length + 1}`);
    if (name === null) return;
    const id = `grp_${Math.random().toString(36).slice(2, 8)}`;
    updateGroups([...groups, { id, name: name.trim() || `Group ${groups.length + 1}`, collapsed: false }]);
    if (selectedSurfaceId) {
      store.updateSurface(selectedSurfaceId, { groupId: id } as unknown as Partial<Surface>);
    }
  };

  const setGroupVisibility = (groupId: string, visible: boolean) => {
    surfaces
      .filter((s) => surfaceGroupId(s) === groupId)
      .forEach((s) => store.updateSurface(s.id, { visible }));
  };

  const setGroupLock = (groupId: string, locked: boolean) => {
    surfaces
      .filter((s) => surfaceGroupId(s) === groupId)
      .forEach((s) => store.updateSurface(s.id, { locked }));
  };

  const ungrouped = ordered.filter((s) => !surfaceGroupId(s) || !groups.some((g) => g.id === surfaceGroupId(s)));

  const row = (s: Surface) => (
    <li
      key={s.id}
      draggable
      onDragStart={() => setDragId(s.id)}
      onDragEnd={() => setDragId(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn(s.id);
      }}
      className={`rounded border px-2 py-1.5 ${selectedSurfaceId === s.id ? 'border-amber-500/60 bg-amber-500/10' : 'border-zinc-800 bg-zinc-800/40'} ${
        dragId === s.id ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="h-3 w-3 shrink-0 rounded-sm border border-white/20"
          style={{ backgroundColor: swatchColor(s) }}
          title={s.content.visualId ? `Visual: ${s.content.visualId}` : s.content.kind}
        />
        <button
          type="button"
          onClick={() => store.selectSurface(s.id)}
          onDoubleClick={() => {
            setRenamingId(s.id);
            setRenameDraft(s.name);
          }}
          className="min-w-0 flex-1 truncate text-left text-xs text-zinc-100"
          title="Click to select · double-click to rename"
        >
          {renamingId === s.id ? (
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => commitRename(s)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(s);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded bg-zinc-950 px-1 py-0.5 text-xs text-zinc-100 outline-none ring-1 ring-amber-500"
            />
          ) : (
            s.name
          )}
        </button>
        <button
          type="button"
          aria-label={s.visible ? 'Hide' : 'Show'}
          title={s.visible ? 'Hide' : 'Show'}
          onClick={() => store.updateSurface(s.id, { visible: !s.visible })}
          className="shrink-0 text-xs text-zinc-400 hover:text-zinc-100"
        >
          {s.visible ? '👁' : '🚫'}
        </button>
        <button
          type="button"
          aria-label={s.locked ? 'Unlock' : 'Lock'}
          title={s.locked ? 'Unlock' : 'Lock'}
          onClick={() => store.updateSurface(s.id, { locked: !s.locked })}
          className="shrink-0 text-xs text-zinc-400 hover:text-zinc-100"
        >
          {s.locked ? '🔒' : '🔓'}
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[10px] text-zinc-500">{s.shape}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(s.opacity * 100)}
          onChange={(e) => store.updateSurface(s.id, { opacity: Number(e.target.value) / 100 })}
          className="h-1 min-w-0 flex-1 accent-amber-400"
          aria-label={`${s.name} opacity`}
        />
        <span className="w-7 text-right text-[10px] text-zinc-500">{Math.round(s.opacity * 100)}%</span>
        <button
          type="button"
          title="Duplicate"
          onClick={() => store.duplicateSurface(s.id)}
          className="shrink-0 rounded px-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
        >
          ⧉
        </button>
        <button
          type="button"
          title="Delete"
          onClick={() => store.removeSurface(s.id)}
          className="shrink-0 rounded px-1 text-xs text-zinc-400 hover:bg-red-900/60 hover:text-red-200"
        >
          ✕
        </button>
      </div>
      {groups.length > 0 && (
        <select
          value={surfaceGroupId(s) ?? ''}
          onChange={(e) =>
            store.updateSurface(s.id, { groupId: e.target.value || null } as unknown as Partial<Surface>)
          }
          className="mt-1.5 w-full rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-300"
          aria-label={`${s.name} group`}
        >
          <option value="">No group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
    </li>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Layers</h2>
        <button
          type="button"
          onClick={createGroup}
          className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          + Group
        </button>
      </div>
      {surfaces.length === 0 && <p className="text-xs text-zinc-500">No surfaces yet — add a shape above.</p>}
      <ul className="space-y-1.5">
        {groups.map((g) => {
          const members = ordered.filter((s) => surfaceGroupId(s) === g.id);
          return (
            <li key={g.id} className="rounded border border-zinc-700 bg-zinc-900/60 p-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => updateGroups(groups.map((x) => (x.id === g.id ? { ...x, collapsed: !x.collapsed } : x)))}
                  className="text-xs text-zinc-300"
                  aria-label={g.collapsed ? 'Expand group' : 'Collapse group'}
                >
                  {g.collapsed ? '▸' : '▾'} {g.name}
                </button>
                <span className="text-[10px] text-zinc-500">{members.length} layer{members.length === 1 ? '' : 's'}</span>
                <span className="flex-1" />
                <button
                  type="button"
                  title="Show all in group"
                  onClick={() => setGroupVisibility(g.id, true)}
                  className="text-xs text-zinc-400 hover:text-zinc-100"
                >
                  👁
                </button>
                <button
                  type="button"
                  title="Hide all in group"
                  onClick={() => setGroupVisibility(g.id, false)}
                  className="text-xs text-zinc-400 hover:text-zinc-100"
                >
                  🚫
                </button>
                <button
                  type="button"
                  title="Lock all in group"
                  onClick={() => setGroupLock(g.id, true)}
                  className="text-xs text-zinc-400 hover:text-zinc-100"
                >
                  🔒
                </button>
                <button
                  type="button"
                  title="Delete group (layers stay)"
                  onClick={() => {
                    surfaces
                      .filter((s) => surfaceGroupId(s) === g.id)
                      .forEach((s) => store.updateSurface(s.id, { groupId: null } as unknown as Partial<Surface>));
                    updateGroups(groups.filter((x) => x.id !== g.id));
                  }}
                  className="text-xs text-zinc-400 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
              {!g.collapsed && <ul className="mt-1.5 space-y-1.5">{members.map(row)}</ul>}
            </li>
          );
        })}
        {ungrouped.map(row)}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-zinc-500">
        Drag rows to reorder (top = front). Double-click a name to rename.
      </p>
    </div>
  );
}
