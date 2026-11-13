// Timeline track row — Phase 5.
// Renders a track's clips (TimelineClip) and, for animation / effect
// tracks, its keyframes as draggable dots on a lane below the clips.
// Keyframe dots drag horizontally to change time; the selected keyframe is
// edited numerically in the TimelineEditor's inspector.
'use client';
import { useRef, useState } from 'react';
import type { TimelineKeyframe, TimelineTrack } from '../lib/schema';
import TimelineClip from './TimelineClip';

interface Props {
  track: TimelineTrack;
  pxPerSec: number;
  playheadTime: number;
  selectedClipId: string | null;
  selectedKeyframeId: string | null;
  onSelectClip: (clipId: string | null) => void;
  onMoveClip: (clipId: string, start: number) => void;
  onTrimClip: (clipId: string, start: number, duration: number) => void;
  onDuplicateClip: (clipId: string) => void;
  onSplitClip: (clipId: string) => void;
  onDeleteClip: (clipId: string) => void;
  onSelectKeyframe: (keyframeId: string | null) => void;
  onMoveKeyframe: (keyframeId: string, time: number) => void;
  onDeleteTrack: () => void;
}

const KIND_LABEL: Record<TimelineTrack['kind'], string> = {
  video: 'Video',
  image: 'Image',
  audio: 'Audio',
  animation: 'Animation',
  effect: 'Effect',
};

export default function TimelineTrackRow({
  track, pxPerSec, playheadTime, selectedClipId, selectedKeyframeId,
  onSelectClip, onMoveClip, onTrimClip, onDuplicateClip, onSplitClip, onDeleteClip,
  onSelectKeyframe, onMoveKeyframe, onDeleteTrack,
}: Props) {
  const [kfDrag, setKfDrag] = useState<{ id: string; offset: number } | null>(null);
  const dragRef = useRef<{ id: string; startX: number; origTime: number } | null>(null);
  const isKeyframeTrack = track.kind === 'animation' || track.kind === 'effect';

  const beginKfDrag = (e: React.PointerEvent, kf: TimelineKeyframe) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectKeyframe(kf.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: kf.id, startX: e.clientX, origTime: kf.time };
  };

  const moveKf = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaSec = (e.clientX - drag.startX) / pxPerSec;
    setKfDrag({ id: drag.id, offset: Math.max(-drag.origTime, deltaSec) });
  };

  const endKf = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (kfDrag && kfDrag.id === drag.id) {
      onMoveKeyframe(drag.id, Math.max(0, drag.origTime + kfDrag.offset));
    }
    setKfDrag(null);
  };

  return (
    <div className="flex border-b border-zinc-800">
      <div className="w-28 shrink-0 border-r border-zinc-800 px-2 py-1.5">
        <p className="truncate text-xs font-medium text-zinc-200">{track.name}</p>
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">{KIND_LABEL[track.kind]}</p>
        <button type="button" onClick={onDeleteTrack} className="mt-1 text-[10px] text-zinc-500 underline hover:text-red-300">
          Remove track
        </button>
      </div>
      <div
        className="relative min-w-0 flex-1"
        style={{ height: isKeyframeTrack ? 72 : 44 }}
        onClick={() => {
          onSelectClip(null);
          onSelectKeyframe(null);
        }}
      >
        {/* keyframe lane */}
        {isKeyframeTrack && (
          <div className="absolute inset-x-0 bottom-0 h-6 border-t border-zinc-800/70 bg-zinc-900/60">
            {track.keyframes.map((kf) => {
              const t = kf.time + (kfDrag?.id === kf.id ? kfDrag.offset : 0);
              return (
                <button
                  key={kf.id}
                  type="button"
                  aria-label={`Keyframe ${kf.param} = ${kf.value} at ${kf.time.toFixed(2)}s`}
                  title={`${kf.param} = ${kf.value} @ ${t.toFixed(2)}s — drag to move`}
                  className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border ${
                    selectedKeyframeId === kf.id ? 'border-amber-300 bg-amber-400' : 'border-zinc-300 bg-zinc-500 hover:bg-amber-300'
                  }`}
                  style={{ left: Math.max(0, t) * pxPerSec }}
                  onPointerDown={(e) => beginKfDrag(e, kf)}
                  onPointerMove={moveKf}
                  onPointerUp={endKf}
                  onPointerCancel={endKf}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectKeyframe(kf.id);
                  }}
                />
              );
            })}
          </div>
        )}
        {track.clips.map((clip) => (
          <TimelineClip
            key={clip.id}
            clip={clip}
            pxPerSec={pxPerSec}
            selected={selectedClipId === clip.id}
            playheadTime={playheadTime}
            onSelect={() => onSelectClip(clip.id)}
            onMove={(start) => onMoveClip(clip.id, start)}
            onTrim={(start, duration) => onTrimClip(clip.id, start, duration)}
            onDuplicate={() => onDuplicateClip(clip.id)}
            onSplit={() => onSplitClip(clip.id)}
            onDelete={() => onDeleteClip(clip.id)}
          />
        ))}
      </div>
    </div>
  );
}
