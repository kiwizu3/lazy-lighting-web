'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { VISUALS, VISUAL_CATEGORIES } from '../../lib/visuals';
import { listMedia, type MediaMeta } from '../../lib/db';
import { isDrawingRecord } from '../../lib/media';
import { loadDrawingAsset, type DrawingAsset } from '../../lib/drawing';
import { useStudioStore } from '../../lib/store';
import MediaLibrary from '../../components/MediaLibrary';
import DrawingWorkspace from '../../components/DrawingWorkspace';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Dialog } from '../../components/ui/dialog';

export default function LibraryPage() {
  const project = useStudioStore((s) => s.project);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [selectedVisual, setSelectedVisual] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<{ meta: MediaMeta; asset: DrawingAsset | null }[]>([]);
  const [editingDrawingId, setEditingDrawingId] = useState<string | null>(null);
  const [showDrawWorkspace, setShowDrawWorkspace] = useState(false);

  // Assign-to-surface needs an open project: load the most recently
  // updated one if the store has none (e.g. direct navigation to /library).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = useStudioStore.getState();
      if (store.project) return;
      await store.refreshProjectList();
      const list = useStudioStore.getState().projects;
      if (!cancelled && list.length > 0) {
        await store.loadProjectById(list[0].id);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshDrawings = async () => {
    const list = await listMedia();
    const drawMetas = list.filter(isDrawingRecord);
    const loaded = await Promise.all(
      drawMetas.map(async (meta) => ({ meta, asset: await loadDrawingAsset(meta.id) })),
    );
    setDrawings(loaded);
  };

  useEffect(() => {
    void refreshDrawings();
  }, []);

  const filteredVisuals = useMemo(() => {
    const q = query.trim().toLowerCase();
    return VISUALS.filter((v) => (category === 'All' || v.category === category) && (!q || v.name.toLowerCase().includes(q) || v.id.includes(q)));
  }, [query, category]);

  const selected = selectedVisual ? VISUALS.find((v) => v.id === selectedVisual) : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          <Link href="/" className="text-sm font-semibold text-amber-400 hover:text-amber-300">← Dashboard</Link>
          <h1 className="text-lg font-bold">Library</h1>
          <div className="flex-1" />
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search media & visuals…" className="pl-8" aria-label="Search library" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8">
        <p className="text-sm text-zinc-400">
          {project ? (
            <>Project open: <span className="text-zinc-100">{project.name}</span> — assign media to the selected surface, or <Link href="/studio" className="text-amber-400 underline">open the studio</Link> to pick one.</>
          ) : (
            <>No project open — media can still be uploaded, previewed and renamed here. <Link href="/studio" className="text-amber-400 underline">Open the studio</Link> to enable assigning media to a surface.</>
          )}
        </p>

        <section>
          <h2 className="mb-3 text-base font-semibold">Media library</h2>
          <MediaLibrary
            onEditDrawing={(id) => {
              setEditingDrawingId(id);
              setShowDrawWorkspace(true);
            }}
          />
        </section>

        <section>
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-base font-semibold">Drawings saved as assets ({drawings.length})</h2>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => { setEditingDrawingId(null); setShowDrawWorkspace(true); }}>
              + New drawing
            </Button>
          </div>
          {drawings.length === 0 ? (
            <p className="text-sm text-zinc-400">
              No drawings yet. Create one here, or save from the drawing workspace — drawings are stored in IndexedDB as assets you can edit and assign to a surface.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {drawings.map(({ meta, asset }) => (
                <article key={meta.id} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                  {asset?.pngDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.pngDataUrl} alt={asset.name} className="h-28 w-full object-cover" />
                  ) : (
                    <div className="flex h-28 items-center justify-center bg-zinc-800 text-2xl">✏️</div>
                  )}
                  <div className="p-3">
                    <p className="truncate text-sm font-medium">{asset?.name ?? meta.name}</p>
                    <p className="text-xs text-zinc-500">
                      {asset?.strokes.length ?? 0} stroke{(asset?.strokes.length ?? 0) === 1 ? '' : 's'}
                    </p>
                    <div className="mt-2">
                      <Button variant="outline" size="sm" onClick={() => { setEditingDrawingId(meta.id); setShowDrawWorkspace(true); }}>
                        Edit drawing
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-base font-semibold">Procedural visuals ({VISUALS.length})</h2>
            <div className="flex-1" />
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={[{ value: 'All', label: 'All categories' }, ...VISUAL_CATEGORIES.map((c) => ({ value: c, label: c }))]}
              className="w-44"
              aria-label="Filter by category"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {filteredVisuals.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedVisual(v.id)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left hover:border-amber-500/60"
              >
                <p className="text-sm font-medium">{v.name}</p>
                <p className="text-xs text-zinc-500">{v.category} · <span className="font-mono">{v.id}</span></p>
              </button>
            ))}
          </div>
          {filteredVisuals.length === 0 && <p className="mt-3 text-sm text-zinc-400">No visuals match your search.</p>}
        </section>
      </main>

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelectedVisual(null); }} title={selected?.name ?? 'Visual'}>
        {selected && (
          <div className="space-y-2 text-sm">
            <p><span className="text-zinc-400">ID:</span> <span className="font-mono">{selected.id}</span></p>
            <p><span className="text-zinc-400">Category:</span> {selected.category}</p>
            <p className="text-zinc-400">Assigning this visual to a surface arrives in a later phase — for now, note its id and pick it in the v1 studio&apos;s Visuals tab.</p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={showDrawWorkspace}
        onOpenChange={(o) => {
          setShowDrawWorkspace(o);
          if (!o) {
            setEditingDrawingId(null);
            void refreshDrawings();
          }
        }}
        title={editingDrawingId ? 'Edit drawing' : 'New drawing'}
        className="max-w-4xl"
      >
        <DrawingWorkspace
          assetId={editingDrawingId}
          onSaved={() => void refreshDrawings()}
          onClose={() => {
            setShowDrawWorkspace(false);
            setEditingDrawingId(null);
            void refreshDrawings();
          }}
        />
      </Dialog>
    </div>
  );
}
