'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Check, Cloud, Download, Maximize, Monitor, Play, Presentation, Redo2, Save, Settings, Undo2,
} from 'lucide-react';
import { useStudioStore, selectCanUndo, selectCanRedo } from '../lib/store';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tooltip } from './ui/tooltip';

export default function TopToolbar({ onOpenProjectorSetup }: { onOpenProjectorSetup?: () => void }) {
  const project = useStudioStore((s) => s.project);
  const canUndo = useStudioStore(selectCanUndo);
  const canRedo = useStudioStore(selectCanRedo);
  const saving = useStudioStore((s) => s.saving);
  const dirty = useStudioStore((s) => s.dirty);
  const savedAt = useStudioStore((s) => s.savedAt);
  const playing = useStudioStore((s) => s.playback.playing);
  const { renameProject, undo, redo, saveNow, setPlaying, exportProject } = useStudioStore.getState();
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const saveLabel = saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : 'Saved';

  return (
    <div className="flex h-12 items-center gap-1 px-2">
      <Link href="/" className="mr-1 flex items-center gap-2 rounded px-1 py-1 text-sm font-semibold text-amber-400 hover:text-amber-300">
        <span className="text-base">💡</span>
        <span className="hidden md:inline">Lazy Lighting</span>
      </Link>

      {editing ? (
        <Input
          autoFocus
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => { if (nameDraft.trim()) renameProject(nameDraft.trim()); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { if (nameDraft.trim()) renameProject(nameDraft.trim()); setEditing(false); }
            if (e.key === 'Escape') setEditing(false);
          }}
          className="h-8 w-56"
          aria-label="Project name"
        />
      ) : (
        <button
          type="button"
          onClick={() => { setNameDraft(project?.name ?? ''); setEditing(true); }}
          className="max-w-56 truncate rounded px-2 py-1 text-sm font-medium text-zinc-100 hover:bg-zinc-800"
          title="Click to rename"
        >
          {project?.name ?? 'No project'}
        </button>
      )}

      <span className="mx-1 h-5 w-px bg-zinc-700" />

      <Tooltip content="Undo (Ctrl/⌘+Z)">
        <Button variant="ghost" size="icon" disabled={!canUndo} onClick={undo} aria-label="Undo"><Undo2 className="h-4 w-4" /></Button>
      </Tooltip>
      <Tooltip content="Redo (Ctrl/⌘+Shift+Z)">
        <Button variant="ghost" size="icon" disabled={!canRedo} onClick={redo} aria-label="Redo"><Redo2 className="h-4 w-4" /></Button>
      </Tooltip>

      <Tooltip content="Save (Ctrl/⌘+S)">
        <Button variant="ghost" size="sm" onClick={() => void saveNow()} aria-label="Save project">
          <Save className="h-4 w-4" /> <span className="hidden lg:inline">Save</span>
        </Button>
      </Tooltip>
      <span className="hidden items-center gap-1 text-xs text-zinc-400 sm:flex" title={saveLabel}>
        {saving ? <Cloud className="h-3.5 w-3.5 animate-pulse" /> : dirty ? <span className="h-2 w-2 rounded-full bg-amber-400" /> : <Check className="h-3.5 w-3.5 text-emerald-400" />}
        {saveLabel}
      </span>

      <div className="flex-1" />

      <Tooltip content={playing ? 'Pause (Space)' : 'Play (Space)'}>
        <Button variant={playing ? 'secondary' : 'default'} size="sm" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
          <Play className="h-4 w-4" /> <span className="hidden lg:inline">{playing ? 'Pause' : 'Preview'}</span>
        </Button>
      </Tooltip>
      <Tooltip content="Performance mode (full-screen stage)">
        <Button variant="ghost" size="sm" onClick={() => useStudioStore.getState().setPerformanceMode(true)} aria-label="Performance mode">
          <Presentation className="h-4 w-4" /> <span className="hidden lg:inline">Perform</span>
        </Button>
      </Tooltip>
      <Tooltip content="Projector setup (output window, test patterns, aspect)">
        <Button variant="ghost" size="sm" onClick={() => onOpenProjectorSetup?.()} aria-label="Projector setup">
          <Monitor className="h-4 w-4" /> <span className="hidden lg:inline">Projector</span>
        </Button>
      </Tooltip>
      <Tooltip content="Fullscreen (F)">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle fullscreen"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen().catch(() => undefined);
          }}
        >
          <Maximize className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Tooltip content="Download project JSON">
        <Button variant="ghost" size="sm" onClick={exportProject} aria-label="Export project JSON">
          <Download className="h-4 w-4" /> <span className="hidden lg:inline">Export</span>
        </Button>
      </Tooltip>
      {project && (
        <Link href={`/export/${project.id}`}>
          <Button variant="outline" size="sm">Video export</Button>
        </Link>
      )}
      <Link href="/settings" aria-label="Settings">
        <Button variant="ghost" size="icon"><Settings className="h-4 w-4" /></Button>
      </Link>
    </div>
  );
}
