'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TEMPLATES } from '../../lib/templates';
import { saveProject } from '../../lib/db';
import { Button } from '../../components/ui/button';

export default function TemplatesPage() {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);

  const useTemplate = async (id: string) => {
    const def = TEMPLATES.find((t) => t.id === id);
    if (!def) return;
    setCreating(id);
    const project = def.build();
    await saveProject(project);
    router.push(`/studio/${project.id}`);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          <Link href="/" className="text-sm font-semibold text-amber-400 hover:text-amber-300">← Dashboard</Link>
          <h1 className="text-lg font-bold">Mapping templates</h1>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <p className="mb-6 text-sm text-zinc-400">
          Start from a pre-built surface layout. “Use template” creates a project in this browser and opens it in the studio.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <article key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="text-base font-semibold">{t.name}</h2>
              <p className="mt-1 text-sm text-zinc-400">{t.description}</p>
              <Button className="mt-4" onClick={() => void useTemplate(t.id)} disabled={creating === t.id}>
                {creating === t.id ? 'Creating…' : 'Use template'}
              </Button>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
