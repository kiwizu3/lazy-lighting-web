// ProjectionCanvas — owns the <canvas> + WebGL engine lifecycle and the
// HTML interaction overlay (handles, hit testing, drag, snap, creation).
// The render loop reads project state via store.getState() so animation
// never re-renders React; the overlay subscribes to selection/surfaces only.
'use client';
import { useEffect, useRef, useState } from 'react';
import Studio from './Studio';
import { WebGLEngine } from '../lib/engine/renderer';
import type { Project, Surface } from '../lib/schema';
import { useStudioStore } from '../lib/store';
import { usePerformStore } from '../lib/performStore';
import { computeLiveMod } from '../lib/engine/liveMod';
import {
  clearTransition,
  getActiveTransition,
  switchSceneWithTransition,
  transitionDone,
  transitionOpacity,
} from '../lib/sceneTransition';
import { activeSceneClipAt, timelineTotalDuration } from '../lib/timeline';
import { applyMidiMessage } from '../lib/midi';
import { connectMidiBus, selectMidiBusInput, subscribeMidiBus } from '../lib/midiBus';
import {
  applyHomography,
  computeHomography,
  invertHomography,
  pointInQuad,
  UNIT_QUAD,
  type Pt,
} from '../lib/homography';
import { makeNewSurface } from '../lib/surfaceFactory';

export type CreationMode = { kind: 'polygon' } | { kind: 'freeform' } | { kind: 'freehand' } | null;

interface Props {
  creationMode: CreationMode;
  onCreationModeChange: (m: CreationMode) => void;
  /** Hide handles + interaction (performance mode / output window). */
  readOnly?: boolean;
  /** Follow the store's playback time exactly (output window mirrors the studio). */
  syncTime?: boolean;
  /** Called once the WebGL engine + canvas exist (video export hooks the canvas here). */
  onEngineReady?: (engine: WebGLEngine, canvas: HTMLCanvasElement) => void;
}

type Override = { id: string; patch: Partial<Surface> };

type DragState =
  | { kind: 'move'; surfaceId: string; startPt: Pt; origCorners: Pt[] }
  | { kind: 'corner'; surfaceId: string; index: number; origCorners: Pt[] }
  | { kind: 'rotate'; surfaceId: string; startAngle: number; origCorners: Pt[]; centroid: Pt }
  | { kind: 'curve'; surfaceId: string; startPt: Pt; startCurve: number }
  | { kind: 'vertex'; surfaceId: string; index: number; origVertices: Pt[]; origCorners: Pt[] }
  | { kind: 'freeform'; points: Pt[] }
  | null;

const GRID_STEP = 0.05;
const SNAP_THRESHOLD = 0.012;

function distPtToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

/** Map a local (u, v) point (top-down, 0..1) to a stage point via the quad. */
function localToStage(corners: Pt[], u: number, v: number): Pt {
  const [tl, tr, , bl] = corners;
  return {
    x: tl.x + u * (tr.x - tl.x) + v * (bl.x - tl.x),
    y: tl.y + u * (tr.y - tl.y) + v * (bl.y - tl.y),
  };
}

/** Map a stage point back to local (u, v) via the inverse homography. */
function stageToLocal(corners: Pt[], p: Pt): Pt | null {
  const h = computeHomography(UNIT_QUAD, corners);
  if (!h) return null;
  const inv = invertHomography(h);
  if (!inv) return null;
  return applyHomography(inv, p.x, p.y);
}

function rotateCorners(corners: Pt[], angleRad: number, centroid: Pt): Pt[] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return corners.map((p) => {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    return { x: centroid.x + dx * cos - dy * sin, y: centroid.y + dx * sin + dy * cos };
  });
}

export default function ProjectionCanvas({ creationMode, onCreationModeChange, readOnly = false, syncTime = false, onEngineReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<WebGLEngine | null>(null);
  const dragRef = useRef<DragState>(null);
  const overrideRef = useRef<Override | null>(null);
  const [override, setOverride] = useState<Override | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [previewPoints, setPreviewPoints] = useState<Pt[]>([]);
  const [strokePoints, setStrokePoints] = useState<Pt[]>([]);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);

  const selectedSurfaceId = useStudioStore((s) => s.selectedSurfaceId);
  const surfaces = useStudioStore((s) => s.project?.surfaces ?? []);
  const grid = useStudioStore((s) => s.grid);
  const snap = useStudioStore((s) => s.snap);
  const quality = useStudioStore((s) => s.quality);

  const selectedSurface = surfaces.find((s) => s.id === selectedSurfaceId) ?? null;
  const effectiveSelected: Surface | null = selectedSurface
    ? override && override.id === selectedSurface.id
      ? { ...selectedSurface, ...override.patch }
      : selectedSurface
    : null;

  const applyOverride = (o: Override | null) => {
    overrideRef.current = o;
    setOverride(o);
  };

  // ---- engine lifecycle + RAF loop ----
  // The loop is the Phase 5 integration point: it advances the playhead,
  // drives timeline scene switches, renders scene crossfades from transient
  // state, computes live modulation (audio / MIDI / LFO / keyframes) into
  // transient overrides, and keeps the project audio element on the playhead.
  // Nothing in the loop writes to the project store except the throttled
  // playhead time — no undo-stack flooding, no autosave storms.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    let engine: WebGLEngine | null = null;
    try {
      engine = new WebGLEngine(canvas, {
        quality: useStudioStore.getState().quality,
        onContextLost: (lost) => setContextLost(lost),
      });
    } catch (err) {
      console.warn('[ProjectionCanvas] WebGL unavailable', err);
      setWebglFailed(true);
      return;
    }
    engineRef.current = engine;
    onEngineReady?.(engine, canvas);
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      setSize({ w, h });
      engine?.setSize(w, h);
    });
    ro.observe(container);
    engine.setSize(container.clientWidth, container.clientHeight);

    let raf = 0;
    let last = performance.now();
    let t = useStudioStore.getState().playback.time;
    let lastPushed = 0;
    let running = true;
    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const state = useStudioStore.getState();
      const project = state.project;
      if (!project) {
        raf = requestAnimationFrame(loop);
        return;
      }
      // --- playhead ---
      if (syncTime) {
        t = state.playback.time;
      } else {
        if (state.playback.playing && !document.hidden) {
          t += dt;
          const total = timelineTotalDuration(project.timeline);
          if (t >= total) {
            if (project.timeline.loop) t %= total;
            else {
              t = total;
              state.setPlaying(false);
            }
          }
        } else if (Math.abs(state.playback.time - t) > 0.05) {
          // Seeked from the timeline ruler / transport while paused.
          t = state.playback.time;
        }
        if (now - lastPushed > 100 && (state.playback.playing || Math.abs(state.playback.time - t) > 0.001)) {
          lastPushed = now;
          state.setTime(t);
        }
      }

      // --- timeline drives scene switches (studio + performance mode;
      // the output window receives the switched project over BroadcastChannel) ---
      if (!syncTime) {
        const sceneClip = activeSceneClipAt(project.timeline, t);
        if (sceneClip && sceneClip.clip.sceneId && project.timeline.currentSceneId !== sceneClip.clip.sceneId) {
          switchSceneWithTransition(sceneClip.clip.sceneId);
        }
      }

      // --- project audio track follows the playhead ---
      const audioTrack = project.audioTracks?.[0];
      const audioEl = audioTrack
        ? document.querySelector<HTMLAudioElement>('audio[data-project-track]')
        : null;
      if (audioEl && audioTrack) {
        const trimStart = audioTrack.trimStart ?? 0;
        const trimEnd = audioTrack.trimEnd;
        const span = trimEnd !== undefined && trimEnd > trimStart ? trimEnd - trimStart : null;
        const audioPos = span !== null ? trimStart + (t % span) : trimStart + t;
        if (state.playback.playing) {
          if (audioEl.paused) void audioEl.play().catch(() => undefined);
          if (Math.abs(audioEl.currentTime - audioPos) > 0.5) {
            try {
              audioEl.currentTime = audioPos;
            } catch { /* not seekable yet */ }
          }
        } else if (!audioEl.paused) {
          audioEl.pause();
        }
      }

      // --- scene crossfade: merge outgoing + incoming surfaces ---
      let displayProject: Project = project;
      const transition = getActiveTransition();
      if (transition) {
        if (transitionDone(transition, now)) {
          clearTransition();
        } else {
          const p = transitionOpacity(transition, false, now);
          const incomingIds = new Set(project.surfaces.map((s) => s.id));
          const outgoingIds = new Set(transition.fromSurfaces.map((s) => s.id));
          // Surfaces that exist in both scenes stay solid (same mesh id
          // cannot render twice); only removed surfaces fade out and only
          // added surfaces fade in, so continuing surfaces never dip.
          const outgoing = transition.fromSurfaces
            .filter((s) => !incomingIds.has(s.id) && s.visible)
            .map((s) => ({ ...s, opacity: s.opacity * transitionOpacity(transition, true, now) }));
          const incoming = project.surfaces.map((s) =>
            outgoingIds.has(s.id) ? s : { ...s, opacity: s.opacity * p },
          );
          displayProject = { ...project, surfaces: [...outgoing, ...incoming] };
        }
      }

      // --- live modulation (audio / MIDI / LFO / keyframes / masters) ---
      const { overrides: liveOverrides, renderCtx } = computeLiveMod(
        displayProject,
        t,
        state.playback.bpm,
      );
      const overrides = new Map<string, Partial<Surface>>(liveOverrides);
      if (overrideRef.current) {
        const prev = overrides.get(overrideRef.current.id) ?? {};
        overrides.set(overrideRef.current.id, { ...prev, ...overrideRef.current.patch });
      }
      engine?.renderFrame(displayProject, t, overrides.size > 0 ? overrides : undefined, renderCtx);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
      engine?.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- MIDI: one bus listener applies messages to live values / scenes ----
  // The bus owns the single input subscription (shared with MidiController).
  // If mappings exist and MIDI was already permitted, auto-connect and pick
  // the first input; otherwise the MidiController panel is the explicit path.
  useEffect(() => {
    const unsubscribe = subscribeMidiBus((msg) => {
      const updates = applyMidiMessage(msg, usePerformStore.getState().midiMappings);
      for (const u of updates) {
        if (u.target === 'scene' && u.sceneId) {
          switchSceneWithTransition(u.sceneId);
          continue;
        }
        if (u.target === 'playback') {
          const store = useStudioStore.getState();
          if (msg.type === 'noteon') store.setPlaying(!store.playback.playing);
          else store.setPlaying(u.value > 0.5);
          continue;
        }
        const key = `${u.surfaceId ?? 'global'}:${u.target}`;
        usePerformStore.getState().setMidiLive(key, u.value);
      }
    });
    let cancelled = false;
    if (usePerformStore.getState().midiMappings.length > 0) {
      void connectMidiBus()
        .then((inputs) => {
          if (cancelled) return;
          if (inputs.length > 0) selectMidiBusInput(inputs[0].id);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setQuality(quality);
  }, [quality]);

  // ---- polygon creation: Enter / double-click finishes ----
  useEffect(() => {
    if (creationMode?.kind !== 'polygon') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishPolygon();
      }
      if (e.key === 'Escape') onCreationModeChange(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creationMode, previewPoints]);

  // ---- vertex deletion: capture-phase so it beats the global Delete shortcut ----
  const selectedVertexRef = useRef(selectedVertex);
  selectedVertexRef.current = selectedVertex;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedVertexRef.current !== null) {
        const store = useStudioStore.getState();
        const s = store.project?.surfaces.find((x) => x.id === store.selectedSurfaceId);
        if (!s || !s.vertices) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const idx = selectedVertexRef.current;
        const vertices = s.vertices.filter((_, i) => i !== idx);
        if (vertices.length >= 3) store.updateSurface(s.id, { vertices });
        setSelectedVertex(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const finishPolygon = () => {
    if (previewPoints.length < 3) {
      setPreviewPoints([]);
      onCreationModeChange(null);
      return;
    }
    const xs = previewPoints.map((p) => p.x);
    const ys = previewPoints.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const w = Math.max(0.01, maxX - minX);
    const h = Math.max(0.01, maxY - minY);
    const vertices = previewPoints.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h }));
    const corners: Pt[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    useStudioStore.getState().addSurface(makeNewSurface('polygon', { corners, vertices }));
    setPreviewPoints([]);
    onCreationModeChange(null);
  };

  const finishFreeform = (points: Pt[], shape: 'freeform' | 'freehand') => {
    setStrokePoints([]);
    dragRef.current = null;
    if (points.length < 3) {
      onCreationModeChange(null);
      return;
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const w = Math.max(0.01, maxX - minX);
    const h = Math.max(0.01, maxY - minY);
    const vertices = points.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h }));
    const corners: Pt[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    useStudioStore.getState().addSurface(makeNewSurface(shape, { corners, vertices }));
    onCreationModeChange(null);
  };

  // ---- pointer helpers ----
  const toNormalized = (e: React.PointerEvent): Pt => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const snapPoint = (p: Pt, excludeId?: string): { p: Pt; guides: { x?: number; y?: number } } => {
    if (!snap) return { p, guides: {} };
    const guides: { x?: number; y?: number } = {};
    let { x, y } = p;
    if (grid) {
      const gx = Math.round(x / GRID_STEP) * GRID_STEP;
      const gy = Math.round(y / GRID_STEP) * GRID_STEP;
      if (Math.abs(gx - x) < SNAP_THRESHOLD) {
        x = gx;
        guides.x = gx;
      }
      if (Math.abs(gy - y) < SNAP_THRESHOLD) {
        y = gy;
        guides.y = gy;
      }
    }
    const candidatesX: number[] = [];
    const candidatesY: number[] = [];
    for (const s of surfaces) {
      if (s.id === excludeId) continue;
      for (const c of s.corners) {
        candidatesX.push(c.x);
        candidatesY.push(c.y);
      }
    }
    for (const cx of candidatesX) {
      if (Math.abs(cx - x) < SNAP_THRESHOLD) {
        x = cx;
        guides.x = cx;
        break;
      }
    }
    for (const cy of candidatesY) {
      if (Math.abs(cy - y) < SNAP_THRESHOLD) {
        y = cy;
        guides.y = cy;
        break;
      }
    }
    return { p: { x, y }, guides };
  };

  const commitOverride = () => {
    const o = overrideRef.current;
    if (o) {
      useStudioStore.getState().updateSurface(o.id, o.patch);
    }
    applyOverride(null);
    setGuides({});
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    if (e.button !== 0) return;
    const pt = toNormalized(e);
    const store = useStudioStore.getState();

    // --- creation modes ---
    if (creationMode?.kind === 'polygon') {
      setPreviewPoints((prev) => [...prev, pt]);
      return;
    }
    if (creationMode?.kind === 'freeform' || creationMode?.kind === 'freehand') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { kind: 'freeform', points: [pt] };
      setStrokePoints([pt]);
      return;
    }

    const sel = effectiveSelected;
    // --- handles of the selected surface (screen-space hit test) ---
    if (sel && size.w > 0) {
      const toPx = (p: Pt) => ({ x: p.x * size.w, y: p.y * size.h });
      const px = { x: e.clientX - containerRef.current!.getBoundingClientRect().left, y: e.clientY - containerRef.current!.getBoundingClientRect().top };
      const near = (p: Pt) => Math.hypot(toPx(p).x - px.x, toPx(p).y - px.y) < 12;
      if (!sel.locked) {
        for (let i = 0; i < 4; i++) {
          if (near(sel.corners[i])) {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            dragRef.current = { kind: 'corner', surfaceId: sel.id, index: i, origCorners: sel.corners };
            return;
          }
        }
        // rotate handle: above the top-edge midpoint
        const midTop = { x: (sel.corners[0].x + sel.corners[1].x) / 2, y: (sel.corners[0].y + sel.corners[1].y) / 2 };
        const rotHandle = { x: midTop.x, y: midTop.y - 30 / size.h };
        if (near(rotHandle)) {
          const centroid = { x: (sel.corners[0].x + sel.corners[2].x) / 2, y: (sel.corners[0].y + sel.corners[2].y) / 2 };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          dragRef.current = {
            kind: 'rotate',
            surfaceId: sel.id,
            startAngle: Math.atan2(pt.y - centroid.y, pt.x - centroid.x),
            origCorners: sel.corners,
            centroid,
          };
          return;
        }
        // mid-edge handles: curve adjustment (curved surfaces only)
        if (sel.shape === 'curved') {
          const mids = [0, 1, 2, 3].map((i) => {
            const a = sel.corners[i];
            const b = sel.corners[(i + 1) % 4];
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          });
          if (mids.some((m) => near(m))) {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const curve = (sel as unknown as { curve?: number }).curve ?? 0;
            dragRef.current = { kind: 'curve', surfaceId: sel.id, startPt: pt, startCurve: curve };
            return;
          }
        }
        // vertex handles for polygon-like shapes
        if (sel.vertices && sel.vertices.length >= 3) {
          for (let i = 0; i < sel.vertices.length; i++) {
            const stage = localToStage(sel.corners, sel.vertices[i].x, sel.vertices[i].y);
            if (near(stage)) {
              setSelectedVertex(i);
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              dragRef.current = { kind: 'vertex', surfaceId: sel.id, index: i, origVertices: sel.vertices, origCorners: sel.corners };
              return;
            }
          }
        }
      }
    }

    // --- hit test: topmost surface first ---
    const sorted = [...surfaces].sort((a, b) => (b.z ?? 1) - (a.z ?? 1));
    const hit = sorted.find((s) => pointInQuad(pt, s.corners));
    if (hit) {
      store.selectSurface(hit.id);
      setSelectedVertex(null);
      if (!hit.locked) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = { kind: 'move', surfaceId: hit.id, startPt: pt, origCorners: hit.corners };
      }
    } else {
      store.selectSurface(null);
      setSelectedVertex(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pt = toNormalized(e);
    if (drag.kind === 'freeform') {
      const last = drag.points[drag.points.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 0.004) {
        drag.points.push(pt);
        setStrokePoints([...drag.points]);
      }
      return;
    }
    const { p: snapped, guides: g } = snapPoint(pt, drag.surfaceId);
    setGuides(g);
    if (drag.kind === 'move') {
      const dx = snapped.x - drag.startPt.x;
      const dy = snapped.y - drag.startPt.y;
      const corners = drag.origCorners.map((c) => ({ x: c.x + dx, y: c.y + dy }));
      applyOverride({ id: drag.surfaceId, patch: { corners } });
    } else if (drag.kind === 'corner') {
      const corners = [...drag.origCorners];
      corners[drag.index] = snapped;
      applyOverride({ id: drag.surfaceId, patch: { corners } });
    } else if (drag.kind === 'rotate') {
      const angle = Math.atan2(pt.y - drag.centroid.y, pt.x - drag.centroid.x);
      const corners = rotateCorners(drag.origCorners, angle - drag.startAngle, drag.centroid);
      applyOverride({ id: drag.surfaceId, patch: { corners } });
    } else if (drag.kind === 'curve') {
      const curve = Math.max(-1, Math.min(1, drag.startCurve + (pt.y - drag.startPt.y) * 4));
      applyOverride({ id: drag.surfaceId, patch: { curve } as unknown as Partial<Surface> });
    } else if (drag.kind === 'vertex') {
      const local = stageToLocal(drag.origCorners, snapped);
      if (!local) return;
      const vertices = drag.origVertices.map((v, i) =>
        i === drag.index ? { x: Math.min(1, Math.max(0, local.x)), y: Math.min(1, Math.max(0, local.y)) } : v,
      );
      applyOverride({ id: drag.surfaceId, patch: { vertices } });
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag?.kind === 'freeform' && creationMode) {
      finishFreeform(drag.points, creationMode.kind === 'freehand' ? 'freehand' : 'freeform');
      return;
    }
    if (drag) commitOverride();
    dragRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (creationMode?.kind === 'polygon') {
      finishPolygon();
      return;
    }
    // Add a vertex on the nearest polygon edge.
    const sel = effectiveSelected;
    if (!sel || !sel.vertices || sel.vertices.length < 3) return;
    const pt = toNormalized(e as unknown as React.PointerEvent);
    const stageVerts = sel.vertices.map((v) => localToStage(sel.corners, v.x, v.y));
    let best = -1;
    let bestDist = 0.015;
    for (let i = 0; i < stageVerts.length; i++) {
      const d = distPtToSegment(pt, stageVerts[i], stageVerts[(i + 1) % stageVerts.length]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0) return;
    const local = stageToLocal(sel.corners, pt);
    if (!local) return;
    const vertices = [...sel.vertices];
    vertices.splice(best + 1, 0, { x: Math.min(1, Math.max(0, local.x)), y: Math.min(1, Math.max(0, local.y)) });
    useStudioStore.getState().updateSurface(sel.id, { vertices });
  };

  if (webglFailed) {
    return (
      <div className="flex h-full flex-col">
        <div className="bg-amber-500/15 px-3 py-2 text-sm text-amber-200" role="status">
          WebGL unavailable — using classic Canvas 2D renderer
        </div>
        <div className="min-h-0 flex-1">
          <Studio />
        </div>
      </div>
    );
  }

  const sel = effectiveSelected;
  const toPx = (p: Pt) => ({ x: p.x * size.w, y: p.y * size.h });
  const midTop = sel ? { x: (sel.corners[0].x + sel.corners[1].x) / 2, y: (sel.corners[0].y + sel.corners[1].y) / 2 } : null;
  const rotHandle = midTop && size.h > 0 ? { x: midTop.x, y: midTop.y - 30 / size.h } : null;
  const mids = sel
    ? [0, 1, 2, 3].map((i) => {
        const a = sel.corners[i];
        const b = sel.corners[(i + 1) % 4];
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      })
    : [];

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-black" data-testid="projection-canvas">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      {grid && size.w > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.07) 1px, transparent 1px)',
            backgroundSize: '5% 5%',
          }}
        />
      )}
      {/* snap guide lines */}
      {guides.x !== undefined && size.w > 0 && (
        <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 w-px bg-amber-400" style={{ left: `${guides.x * 100}%` }} />
      )}
      {guides.y !== undefined && size.h > 0 && (
        <div aria-hidden className="pointer-events-none absolute left-0 right-0 h-px bg-amber-400" style={{ top: `${guides.y * 100}%` }} />
      )}
      {/* creation previews */}
      {(previewPoints.length > 0 || strokePoints.length > 0) && size.w > 0 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {previewPoints.length > 0 && (
            <>
              <polygon
                points={previewPoints.map((p) => `${p.x * size.w},${p.y * size.h}`).join(' ')}
                fill="rgba(245,158,11,0.15)"
                stroke="#f59e0b"
                strokeWidth={1.5}
              />
              {previewPoints.map((p, i) => (
                <circle key={i} cx={p.x * size.w} cy={p.y * size.h} r={4} fill="#f59e0b" />
              ))}
            </>
          )}
          {strokePoints.length > 1 && (
            <polyline
              points={strokePoints.map((p) => `${p.x * size.w},${p.y * size.h}`).join(' ')}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={2}
            />
          )}
        </svg>
      )}
      {/* interaction overlay */}
      <div
        className="absolute inset-0"
        style={{ touchAction: 'none', cursor: readOnly ? undefined : creationMode ? 'crosshair' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        role="application"
        aria-label="Projection stage"
      />
      {/* selection handles */}
      {sel && !creationMode && !readOnly && size.w > 0 && (
        <>
          {sel.corners.map((c, i) => {
            const p = toPx(c);
            return (
              <div
                key={`corner-${i}`}
                aria-hidden
                className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white bg-amber-500 shadow"
                style={{ left: p.x, top: p.y }}
              />
            );
          })}
          {rotHandle && (
            <div
              aria-hidden
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-500 shadow"
              style={{ left: rotHandle.x * size.w, top: rotHandle.y * size.h }}
              title="Drag to rotate"
            />
          )}
          {sel.shape === 'curved' &&
            mids.map((m, i) => {
              const p = toPx(m);
              return (
                <div
                  key={`mid-${i}`}
                  aria-hidden
                  className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-sky-500 shadow"
                  style={{ left: p.x, top: p.y }}
                  title="Drag to adjust curve"
                />
              );
            })}
          {sel.vertices &&
            sel.vertices.length >= 3 &&
            sel.vertices.map((v, i) => {
              const stage = localToStage(sel.corners, v.x, v.y);
              const p = toPx(stage);
              return (
                <div
                  key={`vertex-${i}`}
                  aria-hidden
                  className={`pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow ${
                    selectedVertex === i ? 'border-white bg-rose-500' : 'border-amber-500 bg-zinc-900'
                  }`}
                  style={{ left: p.x, top: p.y }}
                />
              );
            })}
          <div
            className="pointer-events-none absolute rounded bg-black/70 px-2 py-0.5 text-[11px] text-zinc-200"
            style={{ left: Math.min(size.w - 140, Math.max(4, toPx(sel.corners[0]).x)), top: Math.max(4, toPx(sel.corners[0]).y - 22) }}
          >
            {sel.name} · {sel.shape}
            {sel.locked ? ' · locked' : ''}
          </div>
        </>
      )}
      {creationMode && !readOnly && (
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-amber-500/90 px-2 py-1 text-xs font-medium text-black">
          {creationMode.kind === 'polygon'
            ? 'Click to place vertices — Enter or double-click to finish, Esc to cancel'
            : 'Drag to draw the outline — release to finish, Esc to cancel'}
        </div>
      )}
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70" role="alert">
          <div className="rounded bg-zinc-900 px-4 py-3 text-center text-sm text-zinc-200">
            <p className="font-medium text-amber-300">WebGL context lost</p>
            <p className="mt-1 text-zinc-400">The graphics context was lost. It will recover automatically when the browser restores it.</p>
          </div>
        </div>
      )}
    </div>
  );
}
