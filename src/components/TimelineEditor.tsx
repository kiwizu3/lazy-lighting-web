// Timeline editor — Phase 5.
// Tracks (video / image / audio / animation / effect-automation) with clips
// (move / trim / duplicate / split at playhead / speed) and keyframes
// (linear interpolation, draggable dots + numeric inputs) on animation and
// effect tracks. The playhead drives actual playback: ProjectionCanvas
// switches scenes at clip boundaries, samples keyframes, and follows the
// audio track position. No GSAP here — plain rAF already drives the loop,
// and GSAP would add nothing but a dependency.
'use client';
import { useEffect, useRef, useState } from 'react';
import { useStudioStore } from '../lib/store';
import type { TimelineTrackKind } from '../lib/schema';
import { timelineTotalDuration } from '../lib/timeline';
import { listMedia, type MediaMeta } from '../lib/db';
import { mediaKind } from '../lib/media';
import TimelineTrackRow from './TimelineTrack';
import { Button } from './ui/button';
import { Slider } from './ui/slider';

const TRACK_KINDS: TimelineTrackKind[] = ['video', 'image', 'audio', 'animation', 'effect'];
const KEYFRAME_PARAMS = ['opacity', 'scale', 'brightness', 'speed', 'rotation', 'hue', 'zoom', 'density', 'effectIntensity'];

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export default function TimelineEditor() {
  const project = useStudioStore((s) => s.project);
  const timeline = project?.timeline ?? null;
  const scenes = project?.scenes ?? [];
  const playing = useStudioStore((s) => s.playback.playing);
  const time = useStudioStore((s) => s.playback.time);
  const bpm = useStudioStore((s) => s.playback.bpm);
  const [pxPerSec, setPxPerSec] = useState(12);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [newTrackKind, setNewTrackKind] = useState<TimelineTrackKind>('animation');
  const [sceneClipSceneId, setSceneClipSceneId] = useState('');
  const [mediaClipId, setMediaClipId] = useState('');
  const [media, setMedia] = useState<MediaMeta[]>([]);
  const [kfParam, setKfParam] = useState('opacity');
  const [kfValue, setKfValue] = useState(1);
  const [kfSurfaceId, setKfSurfaceId] = useState('');
  const rulerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void listMedia().then(setMedia);
  }, []);

  const store = useStudioStore.getState();
  const total = timelineTotalDuration(timeline);
  const duration = timeline?.duration ?? 60;
  const loop = timeline?.loop ?? true;
  const bpmSync = timeline?.bpmSync ?? false;

  const selectedClip = timeline?.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId) ?? null;
  const selectedClipTrack = timeline?.tracks.find((t) => t.clips.some((c) => c.id === selectedClipId)) ?? null;
  const selectedKf = timeline?.tracks.flatMap((t) => t.keyframes).find((k) => k.id === selectedKeyframeId) ?? null;
  const selectedKfTrack = timeline?.tracks.find((t) => t.keyframes.some((k) => k.id === selectedKeyframeId)) ?? null;

  const seekFromEvent = (e: React.PointerEvent) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = Math.min(total, Math.max(0, (e.clientX - rect.left) / pxPerSec));
    store.setTime(t);
  };

  const ensureTrack = (kind: TimelineTrackKind): string => {
    const existing = useStudioStore.getState().project?.timeline.tracks.find((t) => t.kind === kind);
    if (existing) return existing.id;
    store.addTimelineTrack(kind);
    const created = useStudioStore.getState().project?.timeline.tracks.find((t) => t.kind === kind);
    return created?.id ?? '';
  };

  const addSceneClip = () => {
    if (!sceneClipSceneId) return;
    const scene = scenes.find((s) => s.id === sceneClipSceneId);
    const trackId = ensureTrack('animation');
    if (!trackId) return;
    store.addTimelineClip(trackId, {
      start: Math.round(time * 10) / 10,
      duration: 5,
      label: scene?.name ?? 'Scene',
      sceneId: sceneClipSceneId,
      speed: 1,
    });
  };

  const addMediaClip = () => {
    if (!mediaClipId) return;
    const meta = media.find((m) => m.id === mediaClipId);
    const kind = meta ? mediaKind({ type: meta.type, name: meta.name }) : null;
    if (!kind || kind === 'draw') return;
    const trackKind: TimelineTrackKind = kind === 'audio' ? 'audio' : kind;
    const trackId = ensureTrack(trackKind);
    if (!trackId) return;
    store.addTimelineClip(trackId, {
      start: Math.round(time * 10) / 10,
      duration: 5,
      label: meta?.name ?? 'Media',
      mediaId: mediaClipId,
      speed: 1,
    });
  };

  const addKeyframe = () => {
    const track = timeline?.tracks.find((t) => t.kind === 'animation' || t.kind === 'effect');
    const trackId = track?.id ?? ensureTrack('animation');
    if (!trackId) return;
    store.addTimelineKeyframe(trackId, {
      time: Math.round(time * 100) / 100,
      param: kfParam,
      value: kfValue,
      surfaceId: kfSurfaceId || undefined,
    });
  };

  if (!project || !timeline) {
    return <p className="p-3 text-xs text-zinc-500">No project open.</p>;
  }

  const beatSec = 60 / Math.max(1, bpm);
  const rulerTicks: number[] = [];
  if (bpmSync) {
    for (let t = 0; t <= total; t += beatSec) rulerTicks.push(t);
  } else {
    for (let t = 0; t <= total; t += 5) rulerTicks.push(t);
  }

  return (
    <div className="flex h-full flex-col text-zinc-100">
      {/* Transport */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <Button size="sm" variant={playing ? 'secondary' : 'default'} onClick={() => store.setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            store.setPlaying(false);
            store.setTime(0);
          }}
        >
          ■ Stop
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-zinc-300">
          <input type="checkbox" checked={loop} onChange={(e) => store.setTimelineLoop(e.target.checked)} className="accent-amber-400" />
          Loop
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-300">
          <input type="checkbox" checked={bpmSync} onChange={(e) => store.setTimelineBpmSync(e.target.checked)} className="accent-amber-400" />
          BPM sync grid ({bpm} BPM)
        </label>
        <span className="font-mono text-xs text-zinc-200" aria-label="Current time">
          {fmt(time)} / {fmt(total)}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-zinc-300">
          Total
          <input
            type="number"
            min={1}
            max={3600}
            step={1}
            value={duration}
            onChange={(e) => store.setTimelineDuration(Number(e.target.value) || 60)}
            className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
            aria-label="Timeline duration in seconds"
          />
          s
        </label>
        <span className="w-40">
          <Slider label="Zoom" value={pxPerSec} min={4} max={60} step={1} onChange={setPxPerSec} format={(v) => `${v}px/s`} />
        </span>
      </div>

      {/* Add controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs">
        <select
          value={newTrackKind}
          onChange={(e) => setNewTrackKind(e.target.value as TimelineTrackKind)}
          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100"
          aria-label="New track kind"
        >
          {TRACK_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => store.addTimelineTrack(newTrackKind)}>+ Track</Button>
        <span className="mx-1 h-4 w-px bg-zinc-700" />
        <select
          value={sceneClipSceneId}
          onChange={(e) => setSceneClipSceneId(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100"
          aria-label="Scene for new clip"
        >
          <option value="">Scene clip…</option>
          {scenes.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={!sceneClipSceneId} onClick={addSceneClip}>+ Scene clip at playhead</Button>
        <select
          value={mediaClipId}
          onChange={(e) => setMediaClipId(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100"
          aria-label="Media for new clip"
        >
          <option value="">Media clip…</option>
          {media.filter((m) => mediaKind({ type: m.type, name: m.name }) !== 'draw').map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={!mediaClipId} onClick={addMediaClip}>+ Media clip at playhead</Button>
        <span className="mx-1 h-4 w-px bg-zinc-700" />
        <select
          value={kfParam}
          onChange={(e) => setKfParam(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100"
          aria-label="Keyframe parameter"
        >
          {KEYFRAME_PARAMS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <input
          type="number"
          step={0.05}
          value={kfValue}
          onChange={(e) => setKfValue(Number(e.target.value) || 0)}
          className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
          aria-label="Keyframe value"
        />
        <select
          value={kfSurfaceId}
          onChange={(e) => setKfSurfaceId(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100"
          aria-label="Keyframe surface (empty = selected surface)"
        >
          <option value="">selected surface</option>
          {project.surfaces.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={addKeyframe}>+ Keyframe at playhead</Button>
      </div>

      {/* Ruler + tracks */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex">
          <div className="w-28 shrink-0" />
          <div
            ref={rulerRef}
            className="relative h-6 shrink-0 cursor-pointer border-b border-zinc-800 bg-zinc-900"
            style={{ width: total * pxPerSec }}
            onPointerDown={seekFromEvent}
            role="slider"
            aria-label="Seek — click the ruler to move the playhead"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={Math.round(time * 10) / 10}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') store.setTime(Math.max(0, time - 1));
              if (e.key === 'ArrowRight') store.setTime(Math.min(total, time + 1));
            }}
          >
            {rulerTicks.map((t) => (
              <span key={t} className="absolute top-0 bottom-0 border-l border-zinc-700 pl-1 text-[9px] leading-6 text-zinc-500" style={{ left: t * pxPerSec }}>
                {fmt(t)}
              </span>
            ))}
            <span className="absolute top-0 bottom-0 w-0.5 bg-amber-400" style={{ left: time * pxPerSec }} />
          </div>
        </div>
        {timeline.tracks.length === 0 && (
          <p className="p-3 text-xs text-zinc-500">
            No tracks yet — add a track, then a scene or media clip at the playhead. Clips drive
            playback: scene clips switch scenes at their boundaries, keyframes animate parameters.
          </p>
        )}
        <div className="relative">
          {timeline.tracks.map((track) => (
            <TimelineTrackRow
              key={track.id}
              track={track}
              pxPerSec={pxPerSec}
              playheadTime={time}
              selectedClipId={selectedClipId}
              selectedKeyframeId={selectedKeyframeId}
              onSelectClip={setSelectedClipId}
              onMoveClip={(id, start) => store.updateTimelineClip(id, { start })}
              onTrimClip={(id, start, duration) => store.updateTimelineClip(id, { start, duration })}
              onDuplicateClip={(id) => store.duplicateTimelineClip(id)}
              onSplitClip={(id) => store.splitTimelineClip(id, time)}
              onDeleteClip={(id) => {
                store.removeTimelineClip(id);
                setSelectedClipId(null);
              }}
              onSelectKeyframe={setSelectedKeyframeId}
              onMoveKeyframe={(id, t) => store.updateTimelineKeyframe(id, { time: t })}
              onDeleteTrack={() => store.removeTimelineTrack(track.id)}
            />
          ))}
          {/* playhead overlay */}
          <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-amber-400" style={{ left: 112 + time * pxPerSec }} />
        </div>
      </div>

      {/* Inspectors */}
      {(selectedClip || selectedKf) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 px-3 py-1.5 text-xs">
          {selectedClip && (
            <>
              <span className="font-medium text-zinc-200">Clip: {selectedClip.label || selectedClip.id}</span>
              <label>
                Start
                <input type="number" step={0.1} min={0} value={Math.round(selectedClip.start * 100) / 100} onChange={(e) => store.updateTimelineClip(selectedClip.id, { start: Math.max(0, Number(e.target.value) || 0) })} className="ml-1 w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100" />
              </label>
              <label>
                Duration
                <input type="number" step={0.1} min={0.1} value={Math.round(selectedClip.duration * 100) / 100} onChange={(e) => store.updateTimelineClip(selectedClip.id, { duration: Math.max(0.1, Number(e.target.value) || 0.1) })} className="ml-1 w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100" />
              </label>
              <label>
                Speed
                <input type="number" step={0.05} min={0.1} max={4} value={selectedClip.speed} onChange={(e) => store.updateTimelineClip(selectedClip.id, { speed: Math.min(4, Math.max(0.1, Number(e.target.value) || 1)) })} className="ml-1 w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100" />
              </label>
              <label>
                Label
                <input type="text" value={selectedClip.label} onChange={(e) => store.updateTimelineClip(selectedClip.id, { label: e.target.value })} className="ml-1 w-32 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100" />
              </label>
              {selectedClipTrack?.kind === 'animation' && (
                <label>
                  Scene
                  <select value={selectedClip.sceneId ?? ''} onChange={(e) => store.updateTimelineClip(selectedClip.id, { sceneId: e.target.value || undefined })} className="ml-1 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100">
                    <option value="">—</option>
                    {scenes.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <Button size="sm" variant="outline" onClick={() => store.splitTimelineClip(selectedClip.id, time)} disabled={!(time > selectedClip.start && time < selectedClip.start + selectedClip.duration)}>
                Split at playhead
              </Button>
              <Button size="sm" variant="outline" onClick={() => store.duplicateTimelineClip(selectedClip.id)}>Duplicate</Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  store.removeTimelineClip(selectedClip.id);
                  setSelectedClipId(null);
                }}
              >
                Delete
              </Button>
            </>
          )}
          {selectedKf && (
            <>
              <span className="font-medium text-zinc-200">Keyframe{selectedKfTrack ? ` (${selectedKfTrack.name})` : ''}</span>
              <label>
                Time
                <input type="number" step={0.01} min={0} value={Math.round(selectedKf.time * 100) / 100} onChange={(e) => store.updateTimelineKeyframe(selectedKf.id, { time: Math.max(0, Number(e.target.value) || 0) })} className="ml-1 w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100" />
              </label>
              <label>
                Param
                <select value={selectedKf.param} onChange={(e) => store.updateTimelineKeyframe(selectedKf.id, { param: e.target.value })} className="ml-1 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100">
                  {KEYFRAME_PARAMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                Value
                <input type="number" step={0.05} value={selectedKf.value} onChange={(e) => store.updateTimelineKeyframe(selectedKf.id, { value: Number(e.target.value) || 0 })} className="ml-1 w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100" />
              </label>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  store.removeTimelineKeyframe(selectedKf.id);
                  setSelectedKeyframeId(null);
                }}
              >
                Delete keyframe
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
