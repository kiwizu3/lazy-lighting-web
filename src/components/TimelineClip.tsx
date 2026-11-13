// Timeline clip — Phase 5.
// Draggable horizontally (move), edge handles (trim), with duplicate /
// split-at-playhead / delete actions. Dragging updates local position live
// and commits to the store on release, so the undo stack gets one entry
// per drag, not one per pixel.
'use client';
import { useRef, useState } from 'react';
import type { TimelineClip } from '../lib/schema';

interface Props {
  clip: TimelineClip;
  pxPerSec: number;
  selected: boolean;
  playheadTime: number;
  onSelect: () => void;
  onMove: (start: number) => void;
  onTrim: (start: number, duration: number) => void;
  onDuplicate: () => void;
  onSplit: () => void;
  onDelete: () => void;
}

export default function TimelineClip({
  clip, pxPerSec, selected, playheadTime, onSelect, onMove, onTrim, onDuplicate, onSplit, onDelete,
}: Props) {
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const [trimOffset, setTrimOffset] = useState<{ edge: 'left' | 'right'; delta: number } | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'left' | 'right'; startX: number; origStart: number; origDuration: number } | null>(null);

  const start = clip.start + (dragOffset ?? 0) + (trimOffset?.edge === 'left' ? trimOffset.delta : 0);
  const duration =
    clip.duration + (trimOffset?.edge === 'left' ? -trimOffset.delta : trimOffset?.edge === 'right' ? trimOffset.delta : 0);
  const left = Math.max(0, start) * pxPerSec;
  const width = Math.max(8, duration * pxPerSec);

  const beginDrag = (e: React.PointerEvent, mode: 'move' | 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, origStart: clip.start, origDuration: clip.duration };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaSec = (e.clientX - drag.startX) / pxPerSec;
    if (drag.mode === 'move') {
      setDragOffset(Math.max(-drag.origStart, deltaSec));
    } else if (drag.mode === 'left') {
      const d = Math.min(drag.origDuration - 0.1, Math.max(-drag.origStart, deltaSec));
      setTrimOffset({ edge: 'left', delta: d });
    } else {
      setTrimOffset({ edge: 'right', delta: Math.max(0.1 - drag.origDuration, deltaSec) });
    }
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.mode === 'move' && dragOffset !== null) {
      onMove(Math.max(0, clip.start + dragOffset));
      setDragOffset(null);
    } else if (trimOffset) {
      const nextStart = Math.max(0, clip.start + (trimOffset.edge === 'left' ? trimOffset.delta : 0));
      const nextDuration = Math.max(0.1, clip.duration + (trimOffset.edge === 'left' ? -trimOffset.delta : trimOffset.delta));
      onTrim(nextStart, nextDuration);
      setTrimOffset(null);
    }
  };

  const canSplit = playheadTime > clip.start && playheadTime < clip.start + clip.duration;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Clip ${clip.label || clip.id} — ${clip.start.toFixed(1)}s to ${(clip.start + clip.duration).toFixed(1)}s`}
      className={`group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded border text-left ${
        selected ? 'border-amber-400 bg-amber-500/30' : 'border-zinc-600 bg-zinc-700/70 hover:border-zinc-400'
      }`}
      style={{ left, width }}
      onPointerDown={(e) => beginDrag(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') onDelete();
      }}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 hover:bg-amber-400"
        title="Drag to trim start"
        onPointerDown={(e) => beginDrag(e, 'left')}
      />
      <span
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 hover:bg-amber-400"
        title="Drag to trim end"
        onPointerDown={(e) => beginDrag(e, 'right')}
      />
      <span className="block truncate px-2 py-1 text-[11px] text-zinc-100">
        {clip.label || (clip.sceneId ? 'Scene clip' : clip.mediaId ? 'Media clip' : 'Clip')}
        <span className="ml-1 text-zinc-400">{clip.speed !== 1 ? `${clip.speed.toFixed(2)}×` : ''}</span>
      </span>
      {selected && (
        <span className="absolute bottom-0.5 right-1 flex gap-1">
          <button type="button" title="Duplicate clip" onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="rounded bg-black/60 px-1 text-[10px] text-zinc-200 hover:text-amber-300">⧉</button>
          <button type="button" title="Split at playhead" disabled={!canSplit} onClick={(e) => { e.stopPropagation(); onSplit(); }} className="rounded bg-black/60 px-1 text-[10px] text-zinc-200 hover:text-amber-300 disabled:opacity-30">✂</button>
          <button type="button" title="Delete clip" onClick={(e) => { e.stopPropagation(); onDelete(); }} className="rounded bg-black/60 px-1 text-[10px] text-red-300">✕</button>
        </span>
      )}
    </div>
  );
}
