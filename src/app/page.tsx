'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, FolderOpen, Images, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import { deleteProject, duplicateProject, listProjects, seedDemoIfEmpty, type ProjectMeta } from '../lib/db';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { useStudioStore } from '../lib/store';

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [renameTarget, setRenameTarget] = useState<ProjectMeta | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProjectMeta | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    const list = await listProjects();
    setProjects(list);
  };

  useEffect(() => {
    (async () => {
      await seedDemoIfEmpty();
      await refresh();
      setLoading(false);
    })();
  }, []);

  const createProject = async () => {
    setCreating(true);
    const p = await useStudioStore.getState().newProject('Untitled Project');
    router.push(`/studio/${p.id}`);
  };

  const onRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    const { loadProject, saveProject } = await import('../lib/db');
    const p = await loadProject(renameTarget.id);
    if (p) {
      await saveProject({ ...p, name: renameValue.trim() });
      await refresh();
    }
    setRenameTarget(null);
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    await deleteProject(deleteTarget.id);
    setDeleteTarget(null);
    await refresh();
  };

  const onDuplicate = async (id: string) => {
    const copy = await duplicateProject(id);
    if (copy) await refresh();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          <span className="text-2xl">💡</span>
          <div>
            <h1 className="text-lg font-bold leading-tight">Lazy Lighting Web</h1>
            <p className="text-xs text-zinc-400">Projection Mapping Studio</p>
          </div>
          <div className="flex-1" />
          <Link href="/templates"><Button variant="outline" size="sm"><LayoutTemplate className="h-4 w-4" /> Templates</Button></Link>
          <Link href="/library"><Button variant="outline" size="sm"><Images className="h-4 w-4" /> Library</Button></Link>
          <Link href="/settings"><Button variant="ghost" size="sm">Settings</Button></Link>
          <Button onClick={createProject} disabled={creating}><Plus className="h-4 w-4" /> New project</Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <h2 className="mb-4 text-xl font-semibold">Recent projects</h2>
        {loading ? (
          <p className="text-sm text-zinc-400">Loading projects…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-700 p-10 text-center">
            <p className="mb-1 text-lg font-medium">No projects yet</p>
            <p className="mb-5 text-sm text-zinc-400">Create your first projection mapping project — or start from a template.</p>
            <div className="flex justify-center gap-2">
              <Button onClick={createProject}><Plus className="h-4 w-4" /> Create your first project</Button>
              <Link href="/templates"><Button variant="outline">Browse templates</Button></Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <article key={p.id} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                {p.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnail} alt="" className="h-32 w-full object-cover" />
                ) : (
                  <div className="flex h-32 w-full items-center justify-center bg-gradient-to-br from-amber-500/30 via-zinc-800 to-cyan-500/20">
                    <span className="text-4xl font-bold text-zinc-300">{p.name.charAt(0).toUpperCase()}</span>
                  </div>
                )}
                <div className="p-4">
                  <h3 className="truncate font-medium">{p.name}</h3>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Updated {new Date(p.updatedAt).toLocaleDateString()} · {p.surfaceCount} surface{p.surfaceCount === 1 ? '' : 's'} · {p.sceneCount} scene{p.sceneCount === 1 ? '' : 's'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => router.push(`/studio/${p.id}`)}><FolderOpen className="h-3.5 w-3.5" /> Open</Button>
                    <Button
                      variant="outline" size="sm"
                      onClick={() => { setRenameTarget(p); setRenameValue(p.name); }}
                    >
                      Rename
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void onDuplicate(p.id)} aria-label={`Duplicate ${p.name}`}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(p)} aria-label={`Delete ${p.name}`}>
                      <Trash2 className="h-3.5 w-3.5 text-red-400" />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="mt-8 text-xs text-zinc-500">
          Projects are stored locally in this browser (IndexedDB). No accounts, no cloud sync — nothing leaves this device.
        </p>
      </main>

      <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) setRenameTarget(null); }} title="Rename project">
        <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void onRename(); }} aria-label="New project name" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</Button>
          <Button onClick={() => void onRename()}>Rename</Button>
        </div>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }} title="Delete project?">
        <p className="text-sm text-zinc-300">
          “{deleteTarget?.name}” will be permanently deleted from this browser. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => void onDelete()}>Delete</Button>
        </div>
      </Dialog>
    </div>
  );
}
