'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SHORTCUT_LIST } from '../../lib/shortcuts';
import { clearAllProjects } from '../../lib/db';
import { useStudioStore, type Quality } from '../../lib/store';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';

const QUALITY_OPTIONS = [
  { value: 'performance', label: 'Performance' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'high', label: 'High' },
];

export default function SettingsPage() {
  const quality = useStudioStore((s) => s.quality);
  const grid = useStudioStore((s) => s.grid);
  const snap = useStudioStore((s) => s.snap);
  const setQuality = useStudioStore((s) => s.setQuality);
  const setGrid = useStudioStore((s) => s.setGrid);
  const setSnap = useStudioStore((s) => s.setSnap);
  const hasProject = useStudioStore((s) => !!s.project);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        if (navigator.storage?.estimate) {
          const est = await navigator.storage.estimate();
          setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
        }
      } catch { /* estimate unavailable */ }
    })();
  }, []);

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const doImport = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const p = await useStudioStore.getState().importProjectFile(file);
    setImported(p ? `Imported “${p.name}”.` : 'Import failed — the file is not a valid project.');
  };

  const doClear = async () => {
    await clearAllProjects();
    await useStudioStore.getState().refreshProjectList();
    setConfirmClear(false);
    setCleared(true);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <Link href="/" className="text-sm font-semibold text-amber-400 hover:text-amber-300">← Dashboard</Link>
          <h1 className="text-lg font-bold">Settings</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-base font-semibold">Rendering</h2>
          <label className="mb-4 block text-sm text-zinc-300">
            <span className="mb-1 block text-xs text-zinc-400">Quality</span>
            <Select
              value={quality}
              onChange={(e) => setQuality(e.target.value as Quality)}
              options={QUALITY_OPTIONS}
              aria-label="Render quality"
            />
          </label>
          <div className="space-y-3">
            <label className="flex items-center justify-between text-sm">
              <span>Show grid</span>
              <Switch checked={grid} onCheckedChange={setGrid} label="Show grid" />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span>Snap to grid</span>
              <Switch checked={snap} onCheckedChange={setSnap} label="Snap to grid" />
            </label>
          </div>
          <p className="mt-3 text-xs text-zinc-500">Quality, grid and snap are saved in this browser (localStorage) and apply to the studio.</p>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-base font-semibold">Keyboard shortcuts</h2>
          <dl className="space-y-2">
            {SHORTCUT_LIST.map((s) => (
              <div key={s.keys} className="flex items-center justify-between gap-4 text-sm">
                <dt className="text-zinc-300">{s.action}</dt>
                <dd><kbd className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs">{s.keys}</kbd></dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-2 text-base font-semibold">Local data</h2>
          <p className="mb-4 text-sm text-zinc-400">
            Everything is stored in this browser only — IndexedDB for projects and media, localStorage for settings.
            No accounts, no cloud sync, nothing leaves this device.
          </p>
          {storage ? (
            <p className="mb-4 text-sm text-zinc-300">
              Browser storage used: <span className="font-medium">{formatBytes(storage.usage)}</span>
              {storage.quota > 0 && <> of ~{formatBytes(storage.quota)} available</>}
            </p>
          ) : (
            <p className="mb-4 text-sm text-zinc-500">Storage usage estimate is not available in this browser.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void doImport(e.target.files)} />
            <Button variant="outline" onClick={() => useStudioStore.getState().exportProject()} disabled={!hasProject}>
              Export current project JSON
            </Button>
            <Button variant="outline" onClick={() => importRef.current?.click()}>Import project JSON…</Button>
          </div>
          {imported && <p className="mt-3 text-sm text-emerald-400" role="status">{imported}</p>}
          {!hasProject && (
            <p className="mt-2 text-xs text-zinc-500">Open a project in the studio first to export it (or use Export on the dashboard card / export page).</p>
          )}
        </section>

        <section className="rounded-lg border border-red-900/60 bg-zinc-900 p-5">
          <h2 className="mb-2 text-base font-semibold text-red-300">Clear local data</h2>
          <p className="mb-4 text-sm text-zinc-400">
            Projects live in this browser&apos;s IndexedDB. Clearing removes every project. Media blobs are kept.
          </p>
          {cleared && <p className="mb-3 text-sm text-emerald-400" role="status">All projects cleared.</p>}
          <Button variant="destructive" onClick={() => setConfirmClear(true)}>Clear local data</Button>
        </section>
      </main>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear} title="Clear all projects?">
        <p className="text-sm text-zinc-300">This permanently deletes every project stored in this browser. Export any project you want to keep first.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => void doClear()}>Clear all projects</Button>
        </div>
      </Dialog>
    </div>
  );
}
