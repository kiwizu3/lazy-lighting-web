// Output window — Phase 5.
// Full-screen, read-only stage using the SAME WebGL engine as the editor
// (ProjectionCanvas in read-only mode, time synced from the studio), so the
// output matches the editor exactly. Receives the full project + playhead +
// active scene from the studio over BroadcastChannel ('lazy-lighting-output')
// and localStorage ('lazy-lighting-output-state'). Test-pattern mode
// (grid / checkerboard / corner markers / solid colours) is selected from
// ProjectorSetup via a BroadcastChannel message or a ?pattern= URL param.
// Falls back to the v1 Canvas 2D renderer when WebGL is unavailable
// (ProjectionCanvas's built-in fallback).
'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { migrateProject } from '../../lib/schema';
import { useStudioStore } from '../../lib/store';
import type { TestPattern } from '../../components/ProjectorSetup';

const ProjectionCanvas = dynamic(() => import('../../components/ProjectionCanvas'), { ssr: false });

const PATTERN_COLORS: Record<string, string> = {
  red: '#ef4444',
  green: '#22c55e',
  blue: '#3b82f6',
  white: '#ffffff',
};

function drawPattern(ctx: CanvasRenderingContext2D, pattern: TestPattern, w: number, h: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (pattern in PATTERN_COLORS) {
    ctx.fillStyle = PATTERN_COLORS[pattern];
    ctx.fillRect(0, 0, w, h);
    return;
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.fillStyle = '#fff';
  if (pattern === 'grid') {
    ctx.lineWidth = 1;
    for (let i = 1; i < 20; i++) {
      const x = (i / 20) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let i = 1; i < 20; i++) {
      const y = (i / 20) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  } else if (pattern === 'checkerboard') {
    const cols = 16;
    const rows = 9;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if ((x + y) % 2 === 0) ctx.fillRect((x / cols) * w, (y / rows) * h, w / cols, h / rows);
      }
    }
  } else if (pattern === 'corners') {
    const m = Math.min(w, h) * 0.08;
    const len = Math.min(w, h) * 0.12;
    ctx.lineWidth = 4;
    const corner = (x: number, y: number, dx: number, dy: number) => {
      ctx.beginPath();
      ctx.moveTo(x + dx * len, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * len);
      ctx.stroke();
    };
    corner(m, m, 1, 1);
    corner(w - m, m, -1, 1);
    corner(w - m, h - m, -1, -1);
    corner(m, h - m, 1, -1);
    // Centre cross.
    ctx.beginPath();
    ctx.moveTo(w / 2 - len / 2, h / 2);
    ctx.lineTo(w / 2 + len / 2, h / 2);
    ctx.moveTo(w / 2, h / 2 - len / 2);
    ctx.lineTo(w / 2, h / 2 + len / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, len / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.font = `${Math.max(16, Math.floor(h * 0.04))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`Lazy Lighting — ${pattern} test pattern`, w / 2, h - Math.max(16, h * 0.03));
}

export default function OutputPage() {
  const patternRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pattern, setPattern] = useState<TestPattern>('none');
  const [count, setCount] = useState(0);
  const [updatedAt, setUpdatedAt] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const project = useStudioStore((s) => s.project);
  const playing = useStudioStore((s) => s.playback.playing);
  const time = useStudioStore((s) => s.playback.time);

  // Initial pattern from the URL (?pattern=grid) — read in an effect so
  // the page stays statically renderable (no useSearchParams boundary).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('pattern') as TestPattern | null;
    if (q && ['grid', 'checkerboard', 'corners', 'red', 'green', 'blue', 'white', 'none'].includes(q)) {
      setPattern(q);
    }
  }, []);

  // Receive project + playhead + pattern from the studio.
  useEffect(() => {
    const applyProject = (raw: unknown) => {
      try {
        const project = migrateProject(raw);
        useStudioStore.getState().setProjectExternal(project);
        setCount(project.surfaces.length);
        setUpdatedAt(new Date().toLocaleTimeString());
      } catch {
        /* ignore malformed state */
      }
    };
    try {
      const raw = localStorage.getItem('lazy-lighting-output-state');
      if (raw) {
        const parsed = JSON.parse(raw) as { project?: unknown; surfaces?: unknown };
        if (parsed.project) applyProject(parsed.project);
        else if (parsed.surfaces) applyProject({ surfaces: parsed.surfaces });
      }
    } catch { /* no saved state yet */ }
    const bc = new BroadcastChannel('lazy-lighting-output');
    bc.onmessage = (e) => {
      if (e.data?.type === 'state' && e.data.project) applyProject(e.data.project);
      if (e.data?.type === 'playhead') {
        const st = useStudioStore.getState();
        if (typeof e.data.time === 'number') st.setTime(e.data.time);
        if (typeof e.data.playing === 'boolean') st.setPlaying(e.data.playing);
      }
      if (e.data?.type === 'pattern' && typeof e.data.pattern === 'string') {
        setPattern(e.data.pattern as TestPattern);
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'lazy-lighting-output-state' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as { project?: unknown; surfaces?: unknown };
          if (parsed.project) applyProject(parsed.project);
          else if (parsed.surfaces) applyProject({ surfaces: parsed.surfaces });
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      bc.close();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Test-pattern drawing.
  useEffect(() => {
    if (pattern === 'none') return;
    const canvas = patternRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const draw = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(180, Math.floor(rect.height));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) drawPattern(ctx, pattern, w, h);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [pattern]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <div ref={containerRef} className="relative min-h-0 flex-1">
        {pattern === 'none' ? (
          <div className="absolute inset-0">
            <ProjectionCanvas creationMode={null} onCreationModeChange={() => undefined} readOnly syncTime />
          </div>
        ) : (
          <canvas ref={patternRef} className="absolute inset-0 block h-full w-full" aria-label={`${pattern} test pattern`} />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 bg-black px-4 py-1 text-[11px] text-zinc-600">
        <span>
          💡 Lazy Lighting — Output Window · {count} surface{count === 1 ? '' : 's'}
          {updatedAt ? ` · synced ${updatedAt}` : ''}
          {project ? ` · ${project.name}` : ' · waiting for the studio…'}
          {playing ? ` · ▶ playing ${time.toFixed(1)}s` : ''}
          {pattern !== 'none' ? ` · test pattern: ${pattern} (clear it from Projector Setup)` : ''}
        </span>
        <span className="flex items-center gap-3">
          {pattern !== 'none' && (
            <button type="button" onClick={() => setPattern('none')} className="text-amber-300 underline">
              Clear test pattern
            </button>
          )}
          <button type="button" onClick={toggleFullscreen} className="text-zinc-300 underline">
            {isFullscreen ? 'Exit fullscreen' : 'Fullscreen (F)'}
          </button>
          <span>Unofficial web recreation — not affiliated with Audity Apps. Open the studio to control this output.</span>
        </span>
      </div>
    </div>
  );
}
