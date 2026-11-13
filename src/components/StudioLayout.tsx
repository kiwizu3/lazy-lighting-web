'use client';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, PanelLeft, PanelRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

function useDragResize(
  initial: number,
  min: number,
  max: number,
  direction: 1 | -1,
): { size: number; onPointerDown: (e: React.PointerEvent) => void } {
  const [size, setSize] = useState(initial);
  const startRef = useRef<{ x: number; size: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, size };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      if (!startRef.current) return;
      const next = startRef.current.size + (ev.clientX - startRef.current.x) * direction;
      setSize(Math.min(max, Math.max(min, next)));
    };
    const onUp = () => {
      startRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [size, min, max, direction]);

  return { size, onPointerDown };
}

export interface StudioLayoutProps {
  toolbar: ReactNode;
  left: ReactNode;
  right: ReactNode;
  stage: ReactNode;
  timeline: ReactNode;
}

export default function StudioLayout({ toolbar, left, right, stage, timeline }: StudioLayoutProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const leftDrag = useDragResize(280, 200, 420, 1);
  const rightDrag = useDragResize(300, 220, 460, -1);
  const timelineDrag = useDragResize(180, 100, 360, -1);

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-900">{toolbar}</header>

      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <>
            <aside style={{ width: leftDrag.size }} className="shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-900">
              {left}
            </aside>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize left panel"
              onPointerDown={leftDrag.onPointerDown}
              className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-amber-500/60"
            />
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-hidden bg-zinc-950">{stage}</div>
            {rightOpen && (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize right panel"
                  onPointerDown={rightDrag.onPointerDown}
                  className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-amber-500/60"
                />
                <aside style={{ width: rightDrag.size }} className="shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900">
                  {right}
                </aside>
              </>
            )}
          </div>

          {timelineOpen && (
            <>
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize timeline panel"
                onPointerDown={timelineDrag.onPointerDown}
                className="h-1 shrink-0 cursor-row-resize bg-zinc-800 hover:bg-amber-500/60"
              />
              <div style={{ height: timelineDrag.size }} className="shrink-0 overflow-y-auto border-t border-zinc-800 bg-zinc-900">
                {timeline}
              </div>
            </>
          )}
        </main>
      </div>

      <footer className="flex shrink-0 items-center gap-1 border-t border-zinc-800 bg-zinc-900 px-2 py-1">
        <Button variant="ghost" size="sm" onClick={() => setLeftOpen((v) => !v)} aria-label="Toggle left panel">
          <PanelLeft className="h-4 w-4" /> <span className="hidden sm:inline">Layers</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setRightOpen((v) => !v)} aria-label="Toggle right panel">
          <PanelRight className="h-4 w-4" /> <span className="hidden sm:inline">Inspector</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setTimelineOpen((v) => !v)} aria-label="Toggle timeline panel">
          {timelineOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          <span className="hidden sm:inline">Timeline</span>
        </Button>
        <span className={cn('ml-auto text-xs text-zinc-500')}>
          Lazy Lighting Web — v2 rebuild (Phase 1)
        </span>
      </footer>
    </div>
  );
}
