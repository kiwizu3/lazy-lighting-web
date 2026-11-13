'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Effects, Project, Pt, Scene, ShapeKind, Surface } from '../lib/types';
import { cloneSurface, defaultContent, defaultEffects, makeSurface, uid } from '../lib/types';
import { VISUALS, VISUAL_CATEGORIES, getVisual } from '../lib/visuals';
import { deleteProject, demoProject, listProjects, saveProject, seedIfEmpty } from '../lib/projects';
import { pointInQuad } from '../lib/warp';
import { defaultBlobPoints, defaultSilhouettePoints } from '../lib/warp';
import { renderStage, type MediaMap } from '../lib/render';

type Tab = 'Shapes' | 'Visuals' | 'Media' | 'Draw' | 'Project';
type ExportRes = '720' | '1080' | '4k';

const RES_MAP: Record<ExportRes, [number, number]> = { '720': [1280, 720], '1080': [1920, 1080], '4k': [3840, 2160] };

function normalizeProject(p: Project): Project {
  const fix = (s: Surface): Surface => ({
    ...s,
    effects: s.effects ?? defaultEffects(),
    content: { ...defaultContent(), ...s.content, strokes: s.content?.strokes ?? [] },
    corners: s.corners ?? [{ x: 0.1, y: 0.15 }, { x: 0.55, y: 0.15 }, { x: 0.55, y: 0.75 }, { x: 0.1, y: 0.75 }],
  });
  return { ...p, surfaces: p.surfaces.map(fix), scenes: p.scenes.map((sc) => ({ ...sc, surfaces: sc.surfaces.map(fix) })) };
}

function Slider({ label, value, min, max, step = 1, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="block text-xs text-zinc-400">
      <span className="flex justify-between"><span>{label}</span><span className="text-zinc-200">{format ? format(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-amber-400" />
    </label>
  );
}

export default function Studio() {
  const [project, setProject] = useState<Project | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('Visuals');
  const [visualCat, setVisualCat] = useState<string>('All');
  const [brushColor, setBrushColor] = useState('#f59e0b');
  const [brushSize, setBrushSize] = useState(6);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [micOn, setMicOn] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [bpm, setBpm] = useState(120);
  const [lfoTarget, setLfoTarget] = useState<'none' | 'opacity' | 'zoom' | 'hue'>('none');
  const [lfoDepth, setLfoDepth] = useState(0.3);
  const [midiStatus, setMidiStatus] = useState('MIDI not connected');
  const [exportRes, setExportRes] = useState<ExportRes>('1080');
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [recNote, setRecNote] = useState('');
  const [playing, setPlaying] = useState(false);
  const [showIdx, setShowIdx] = useState(0);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioName, setAudioName] = useState('');
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(30);
  const [volume, setVolume] = useState(0.8);
  const [savedMsg, setSavedMsg] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [motionNote] = useState('Motion tracking (camera movement) — approximate expressive control; not real hand/face tracking.');

  const stageCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<Project | null>(null);
  const selectedRef = useRef<string | null>(null);
  const audioLevelRef = useRef(0);
  const bpmRef = useRef(120);
  const lfoRef = useRef({ target: 'none' as typeof lfoTarget, depth: 0.3 });
  const mouseRef = useRef({ x: 0, y: 0 });
  const crossfadeRef = useRef<{ prev: Surface[]; start: number; duration: number } | null>(null);
  const showRef = useRef({ playing: false, idx: 0, sceneStart: 0 });
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  const videosRef = useRef(new Map<string, HTMLVideoElement>());
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drawingRef = useRef<{ surfaceId: string; stroke: { x: number; y: number }[] } | null>(null);
  const dragRef = useRef<{ corner: number; surfaceId: string } | { edge: 'top' | 'bottom' | 'left' | 'right'; surfaceId: string } | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);

  projectRef.current = project;
  selectedRef.current = selectedId;
  bpmRef.current = bpm;
  lfoRef.current = { target: lfoTarget, depth: lfoDepth };

  // ---- load / seed ----
  useEffect(() => {
    const p = normalizeProject(seedIfEmpty());
    setProject(p); setProjectName(p.name); setBpm(p.bpm); setProjects(listProjects());
    if (typeof window !== 'undefined') bcRef.current = new BroadcastChannel('lazy-lighting-output');
    return () => { bcRef.current?.close(); };
  }, []);

  // ---- sync to output window ----
  useEffect(() => {
    if (!project) return;
    try {
      localStorage.setItem('lazy-lighting-output-state', JSON.stringify({ surfaces: project.surfaces, updatedAt: Date.now() }));
      bcRef.current?.postMessage({ type: 'state', surfaces: project.surfaces });
    } catch { /* storage full — ignore */ }
  }, [project]);

  // ---- media caches ----
  useEffect(() => {
    if (!project) return;
    for (const s of project.surfaces) {
      if (s.content.imageDataUrl && !imagesRef.current.get(s.id)?.src?.endsWith(s.content.imageDataUrl.slice(-32))) {
        const img = new Image(); img.src = s.content.imageDataUrl; imagesRef.current.set(s.id, img);
      }
      if (s.content.videoObjectUrl && !videosRef.current.has(s.id)) {
        const v = document.createElement('video');
        v.src = s.content.videoObjectUrl; v.loop = true; v.muted = true; v.playsInline = true;
        v.play().catch(() => undefined); videosRef.current.set(s.id, v);
      }
    }
  }, [project]);

  // ---- render loop ----
  useEffect(() => {
    let raf = 0; const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      const canvas = stageCanvasRef.current; const p = projectRef.current;
      if (canvas && p) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // mic audio level
          if (analyserRef.current) {
            const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
            analyserRef.current.getByteFrequencyData(buf);
            let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
            audioLevelRef.current = Math.min(1, (sum / buf.length / 128) * 1.6);
          }
          // show auto-advance
          if (showRef.current.playing && p.scenes.length > 0) {
            const cur = p.scenes[showRef.current.idx];
            if (cur && t - showRef.current.sceneStart > cur.duration) {
              const next = (showRef.current.idx + 1) % p.scenes.length;
              showRef.current.idx = next; showRef.current.sceneStart = t;
              setShowIdx(next);
              switchScene(p.scenes[next], true);
            }
          }
          // LFO on selected surface
          let surfaces = p.surfaces;
          const lfo = lfoRef.current;
          if (lfo.target !== 'none' && selectedRef.current) {
            const v = Math.sin((2 * Math.PI * bpmRef.current * t) / 60) * lfo.depth;
            surfaces = surfaces.map((s) => {
              if (s.id !== selectedRef.current) return s;
              if (lfo.target === 'opacity') return { ...s, opacity: Math.max(0, Math.min(1, s.opacity + v)) };
              if (lfo.target === 'zoom') return { ...s, effects: { ...s.effects, zoom: Math.max(0.3, s.effects.zoom + v) } };
              return { ...s, effects: { ...s.effects, hue: s.effects.hue + v * 60 } };
            });
          }
          const cf = crossfadeRef.current;
          const media: MediaMap = { images: imagesRef.current, videos: videosRef.current, camera: cameraVideoRef.current };
          renderStage(ctx, surfaces, t, {
            t, audioLevel: audioLevelRef.current, hueShift: 0,
            mouseX: mouseRef.current.x, mouseY: mouseRef.current.y,
            crossfade: cf ? { prev: cf.prev, progress: Math.min(1, (t - cf.start) / cf.duration) } : null,
          }, media);
          if (cf && (t - cf.start) / cf.duration >= 1) crossfadeRef.current = null;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const meter = setInterval(() => setAudioLevel(audioLevelRef.current), 250);
    return () => { cancelAnimationFrame(raf); clearInterval(meter); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- helpers ----
  const updateProject = useCallback((fn: (p: Project) => Project) => {
    setProject((prev) => { if (!prev) return prev; const next = fn(prev); projectRef.current = next; return next; });
  }, []);
  const updateSurface = useCallback((id: string, patch: Partial<Surface> | ((s: Surface) => Surface)) => {
    updateProject((p) => ({ ...p, surfaces: p.surfaces.map((s) => (s.id === id ? (typeof patch === 'function' ? patch(s) : { ...s, ...patch }) : s)) }));
  }, [updateProject]);
  const updateEffects = useCallback((id: string, patch: Partial<Effects>) => {
    updateSurface(id, (s) => ({ ...s, effects: { ...s.effects, ...patch } }));
  }, [updateSurface]);
  const selected = project?.surfaces.find((s) => s.id === selectedId) ?? null;

  const switchScene = useCallback((scene: Scene, withTransition = true) => {
    const p = projectRef.current; if (!p) return;
    if (withTransition && p.transition !== 'cut') {
      crossfadeRef.current = { prev: p.surfaces, start: (performance.now() - LOOP_EPOCH) / 1000, duration: p.transitionDuration };
    }
    updateProject((prev) => ({ ...prev, surfaces: scene.surfaces.map(cloneSurface), currentSceneId: scene.id }));
  }, [updateProject]);

  // ---- shapes ----
  const addSurface = (shape: ShapeKind) => {
    if (!project) return;
    const n = project.surfaces.length;
    const off = (n % 3) * 0.08;
    const surf = makeSurface({
      shape, name: `${shape[0].toUpperCase() + shape.slice(1)} ${n + 1}`,
      corners: [{ x: 0.12 + off, y: 0.15 + off }, { x: 0.5 + off, y: 0.15 + off }, { x: 0.5 + off, y: 0.7 + off }, { x: 0.12 + off, y: 0.7 + off }],
      z: n + 1,
      points: shape === 'freehand' ? defaultBlobPoints() : shape === 'silhouette' ? defaultSilhouettePoints() : undefined,
      content: { ...defaultContent(shape === 'text' ? 'neon-sign' : shape === 'circle' ? 'neon-rings' : 'aurora'), text: shape === 'text' ? 'HELLO' : undefined },
    });
    updateProject((p) => ({ ...p, surfaces: [...p.surfaces, surf] }));
    setSelectedId(surf.id);
  };

  // ---- camera / mic / midi ----
  const toggleCamera = async () => {
    if (cameraOn) { cameraStreamRef.current?.getTracks().forEach((tr) => tr.stop()); cameraStreamRef.current = null; setCameraOn(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) { cameraVideoRef.current.srcObject = stream; await cameraVideoRef.current.play().catch(() => undefined); }
      setCameraOn(true); setCameraError('');
    } catch { setCameraError('Camera access denied or unavailable.'); }
  };
  const toggleMic = async () => {
    if (micOn) { micStreamRef.current?.getTracks().forEach((tr) => tr.stop()); micStreamRef.current = null; analyserRef.current = null; setMicOn(false); audioLevelRef.current = 0; return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new AC(); audioCtxRef.current = ac;
      const src = ac.createMediaStreamSource(stream); const an = ac.createAnalyser(); an.fftSize = 512; src.connect(an); analyserRef.current = an;
      setMicOn(true);
    } catch { setCameraError('Microphone access denied.'); }
  };
  const connectMidi = async () => {
    const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<{ inputs: Map<string, { onmidimessage: ((e: { data: Uint8Array }) => void) | null }> }> };
    if (!nav.requestMIDIAccess) { setMidiStatus('MIDI not available in this browser'); return; }
    try {
      const access = await nav.requestMIDIAccess();
      let connected = false;
      access.inputs.forEach((input) => {
        connected = true;
        input.onmidimessage = (e) => {
          if (!e.data) return;
          const [status, cc, val] = e.data;
          if (status >= 0xb0 && status < 0xc0 && selectedRef.current) {
            const norm = val / 127; const id = selectedRef.current;
            if (cc === 1) updateSurface(id, (s) => ({ ...s, opacity: norm }));
            if (cc === 7) updateEffects(id, { zoom: 0.5 + norm * 2 });
            if (cc === 74) updateEffects(id, { hue: norm * 360 });
          }
        };
      });
      setMidiStatus(connected ? 'MIDI connected — CC1 opacity, CC7 zoom, CC74 hue' : 'MIDI available — no device found');
    } catch { setMidiStatus('MIDI access denied'); }
  };

  // ---- stage pointer handling ----
  const stagePoint = (e: React.PointerEvent): Pt => {
    const r = stageWrapRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const approxUV = (p: Pt, quad: [Pt, Pt, Pt, Pt]): Pt => {
    // bilinear-ish approximation: u along top/bottom edges, v along left/right edges
    const u = Math.max(0, Math.min(1, (p.x - quad[0].x) / Math.max(0.001, quad[1].x - quad[0].x)));
    const v = Math.max(0, Math.min(1, (p.y - quad[0].y) / Math.max(0.001, quad[3].y - quad[0].y)));
    return { x: u, y: v };
  };
  const onStagePointerDown = (e: React.PointerEvent) => {
    if (!project) return;
    const p = stagePoint(e);
    mouseRef.current = { x: p.x - 0.5, y: p.y - 0.5 };
    if (tab === 'Draw' && selected?.content.kind === 'draw') {
      const uv = approxUV(p, selected.corners);
      drawingRef.current = { surfaceId: selected.id, stroke: [uv] };
      // append a fresh in-progress stroke; moves extend its last entry
      setProject((prev) => prev ? { ...prev, surfaces: prev.surfaces.map((s) => s.id === selected.id ? { ...s, content: { ...s.content, strokes: [...s.content.strokes, { points: [uv], color: brushColor, size: brushSize }] } } : s) } : prev);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }
    const hit = [...project.surfaces].sort((a, b) => b.z - a.z).find((s) => s.visible && pointInQuad(p, s.corners));
    setSelectedId(hit ? hit.id : null);
  };
  const onStagePointerMove = (e: React.PointerEvent) => {
    if (!project) return;
    const p = stagePoint(e);
    mouseRef.current = { x: p.x - 0.5, y: p.y - 0.5 };
    if (drawingRef.current && selected) {
      const uv = approxUV(p, selected.corners);
      drawingRef.current.stroke.push(uv);
      const stroke = drawingRef.current.stroke;
      // extend the last (in-progress) stroke
      setProject((prev) => prev ? { ...prev, surfaces: prev.surfaces.map((s) => s.id === selected.id ? { ...s, content: { ...s.content, strokes: s.content.strokes.map((st, i) => i === s.content.strokes.length - 1 ? { ...st, points: stroke } : st) } } : s) } : prev);
      return;
    }
    if (dragRef.current) {
      const d = dragRef.current;
      if ('corner' in d) {
        updateSurface(d.surfaceId, (s) => { const corners = [...s.corners] as [Pt, Pt, Pt, Pt]; corners[d.corner] = { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }; return { ...s, corners }; });
      } else {
        updateSurface(d.surfaceId, (s) => ({ ...s, curve: Math.max(-1, Math.min(1, (p.x - 0.5) * 2)) }));
      }
    }
  };
  const onStagePointerUp = () => {
    if (drawingRef.current) {
      const d = drawingRef.current; drawingRef.current = null;
      // strokes were preview-committed on move; if only one point, drop it
      if (d.stroke.length < 2) {
        setProject((prev) => prev ? { ...prev, surfaces: prev.surfaces.map((s) => s.id === d.surfaceId ? { ...s, content: { ...s.content, strokes: s.content.strokes.slice(0, -1) } } : s) } : prev);
      }
    }
    dragRef.current = null;
  };

  // ---- files ----
  const compressImage = (file: File, cb: (url: string) => void) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = img.width * scale; c.height = img.height * scale;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/jpeg', 0.8)); URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  const onImageFile = (file: File) => { if (!selected) return; compressImage(file, (dataUrl) => updateSurface(selected.id, (s) => ({ ...s, content: { ...s.content, kind: s.content.kind === 'depth' ? 'depth' : 'image', imageDataUrl: dataUrl } }))); };
  const onVideoFile = (file: File) => { if (!selected) return; const url = URL.createObjectURL(file); updateSurface(selected.id, (s) => ({ ...s, content: { ...s.content, kind: 'video', videoObjectUrl: url, videoName: file.name } })); };
  const onAudioFile = (file: File) => {
    const url = URL.createObjectURL(file); setAudioUrl(url); setAudioName(file.name); setTrimEnd(30);
    if (audioElRef.current) { audioElRef.current.src = url; audioElRef.current.volume = volume; }
  };

  // ---- export ----
  const startRecording = () => {
    const canvas = stageCanvasRef.current; if (!canvas) return;
    const [w, h] = RES_MAP[exportRes];
    const prevW = canvas.width, prevH = canvas.height;
    canvas.width = w; canvas.height = h;
    const stream = canvas.captureStream(30);
    let combined: MediaStream = stream; let note = 'Video only — no audio track attached.';
    if (audioElRef.current && audioUrl) {
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ac = audioCtxRef.current ?? new AC(); audioCtxRef.current = ac;
        const src = ac.createMediaElementSource(audioElRef.current);
        const dest = ac.createMediaStreamDestination();
        src.connect(dest); src.connect(ac.destination);
        combined = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
        note = 'Recording video + audio track.';
      } catch { /* fall back to video-only */ }
    }
    const rec = new MediaRecorder(combined, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
    recChunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) recChunksRef.current.push(e.data); };
    rec.onstop = () => {
      canvas.width = prevW; canvas.height = prevH;
      const blob = new Blob(recChunksRef.current, { type: 'video/webm' });
      setDownloadUrl(URL.createObjectURL(blob)); setRecording(false);
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
    rec.start(250); mediaRecorderRef.current = rec; setRecording(true); setRecSeconds(0); setRecNote(note);
    recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
  };
  const stopRecording = () => mediaRecorderRef.current?.stop();

  const saveCurrent = () => {
    if (!project) return;
    const p = { ...project, name: projectName || project.name };
    saveProject(p); setProject(p); setProjects(listProjects()); setSavedMsg(`Saved "${p.name}" ✓`);
    setTimeout(() => setSavedMsg(''), 2500);
  };

  if (!project) return <div className="min-h-screen bg-black text-zinc-200 flex items-center justify-center">Loading Lazy Lighting…</div>;
  const surfaces = project.surfaces;
  const sel = selected;
  const [stageW, stageH] = RES_MAP[exportRes];

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-zinc-200 flex flex-col">
      {/* top bar */}
      <header className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-[#111114]">
        <span className="text-lg font-bold">💡 <span className="text-amber-400">Lazy Lighting</span> <span className="text-zinc-500 text-sm font-normal">Web</span></span>
        <input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm w-48" placeholder="Project name" />
        <button onClick={saveCurrent} className="bg-amber-400 text-black text-sm font-semibold px-3 py-1.5 rounded">Save</button>
        <button onClick={() => { const w = window.open('/output', '_blank', 'width=1280,height=720'); if (!w) alert('Allow pop-ups to open the Output Window.'); }} className="bg-cyan-500 text-black text-sm font-semibold px-3 py-1.5 rounded">Open Output Window</button>
        <button onClick={() => { const url = `${location.origin}/output`; navigator.clipboard?.writeText(url).then(() => setSavedMsg('Output link copied ✓')); }} className="bg-zinc-800 text-sm px-3 py-1.5 rounded border border-zinc-700">Copy Link URL</button>
        <button onClick={() => stageWrapRef.current?.requestFullscreen?.()} className="bg-zinc-800 text-sm px-3 py-1.5 rounded border border-zinc-700">Present ⛶</button>
        <span className="ml-auto text-xs text-zinc-500 hidden md:block">Unofficial web recreation — not affiliated with Audity Apps.</span>
        {savedMsg && <span className="text-xs text-emerald-400">{savedMsg}</span>}
      </header>

      <div className="flex flex-1 min-h-0">
        {/* left sidebar */}
        <aside className="w-64 shrink-0 border-r border-zinc-800 bg-[#101013] flex flex-col min-h-0">
          <div className="flex flex-wrap gap-1 p-2 border-b border-zinc-800">
            {(['Shapes', 'Visuals', 'Media', 'Draw', 'Project'] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`text-xs px-2 py-1 rounded ${tab === t ? 'bg-amber-400 text-black font-semibold' : 'bg-zinc-800'}`}>{t}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {tab === 'Shapes' && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-400">Map any surface. Drag corners on the stage to align it; mid-edge handles bend the edge around curves.</p>
                {(['rect', 'circle', 'text', 'cube', 'silhouette', 'freehand'] as ShapeKind[]).map((sh) => (
                  <button key={sh} onClick={() => addSurface(sh)} className="w-full text-left bg-zinc-800 hover:bg-zinc-700 rounded px-3 py-2 text-sm capitalize">＋ {sh === 'rect' ? 'Square / Rectangle' : sh}</button>
                ))}
                <div className="pt-2">
                  <p className="text-xs font-semibold text-zinc-300 mb-1">Surfaces ({surfaces.length})</p>
                  {surfaces.map((s) => (
                    <div key={s.id} onClick={() => setSelectedId(s.id)} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded cursor-pointer ${selectedId === s.id ? 'bg-amber-400/20 text-amber-300' : 'hover:bg-zinc-800'}`}>
                      <input type="checkbox" checked={s.visible} onChange={(e) => { e.stopPropagation(); updateSurface(s.id, { visible: e.target.checked }); }} />
                      <span className="flex-1 truncate">{s.name}</span>
                      <button onClick={(e) => { e.stopPropagation(); updateProject((p) => ({ ...p, surfaces: p.surfaces.filter((x) => x.id !== s.id) })); }} className="text-zinc-500 hover:text-red-400">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tab === 'Visuals' && (
              <div className="space-y-2">
                <select value={visualCat} onChange={(e) => setVisualCat(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm">
                  <option>All</option>{VISUAL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <p className="text-xs text-zinc-500">{VISUALS.length} built-in visuals — {VISUALS.filter((v) => v.category === 'Halloween').length} Halloween, {VISUALS.filter((v) => v.category === 'Christmas').length} Christmas.</p>
                <div className="grid grid-cols-2 gap-2">
                  {VISUALS.filter((v) => visualCat === 'All' || v.category === visualCat).map((v) => (
                    <button key={v.id} onClick={() => sel && updateSurface(sel.id, (s) => ({ ...s, content: { ...s.content, kind: 'visual', visualId: v.id } }))} disabled={!sel} className={`text-left text-xs rounded px-2 py-2 border ${sel?.content.visualId === v.id ? 'border-amber-400 bg-amber-400/10 text-amber-300' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700'} disabled:opacity-40`}>
                      <span className="block font-semibold">{v.name}</span><span className="text-zinc-500">{v.category}</span>
                    </button>
                  ))}
                </div>
                {!sel && <p className="text-xs text-amber-400">Select a surface first.</p>}
              </div>
            )}
            {tab === 'Media' && (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs font-semibold mb-1">Image (saved in project)</p>
                  <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onImageFile(e.target.files[0])} className="text-xs w-full" />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1">Video (session-only — re-pick after reload)</p>
                  <input type="file" accept="video/*" onChange={(e) => e.target.files?.[0] && onVideoFile(e.target.files[0])} className="text-xs w-full" />
                  {sel?.content.videoName && <p className="text-xs text-zinc-500 mt-1">{sel.content.videoName}</p>}
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1">Live camera as content</p>
                  <button onClick={toggleCamera} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-xs">{cameraOn ? 'Stop camera' : 'Enable camera'}</button>
                  {cameraError && <p className="text-xs text-red-400 mt-1">{cameraError}</p>}
                  <p className="text-xs text-zinc-500 mt-1">Then set the selected surface&apos;s content to Camera (right panel).</p>
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1">Depth Mode — photo → depth-aware shape</p>
                  <p className="text-xs text-zinc-500">Upload a photo (Image above), set content to Depth, then use the Depth slider in the right panel. Move your mouse over the stage for parallax.</p>
                  <button onClick={() => sel && updateSurface(sel.id, (s) => ({ ...s, content: { ...s.content, kind: 'depth' } }))} disabled={!sel} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-xs mt-1 disabled:opacity-40">Apply Depth to selected</button>
                </div>
              </div>
            )}
            {tab === 'Draw' && (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-zinc-400">Pick a surface, set its content to Draw (right panel), then draw directly on the stage. Strokes are stored in the project.</p>
                <label className="block text-xs">Brush color <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="ml-2" /></label>
                <Slider label="Brush size" value={brushSize} min={2} max={30} onChange={setBrushSize} />
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={sel?.content.animateWobble ?? false} onChange={(e) => sel && updateSurface(sel.id, (s) => ({ ...s, content: { ...s.content, animateWobble: e.target.checked } }))} /> Animate wobble</label>
                <button onClick={() => sel && updateSurface(sel.id, (s) => ({ ...s, content: { ...s.content, strokes: [] } }))} disabled={!sel} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-xs disabled:opacity-40">Clear drawing</button>
                <button onClick={() => sel && updateSurface(sel.id, (s) => ({ ...s, content: { ...s.content, kind: 'draw' } }))} disabled={!sel} className="bg-amber-400 text-black rounded px-3 py-1.5 text-xs font-semibold disabled:opacity-40">Use Draw on selected</button>
              </div>
            )}
            {tab === 'Project' && (
              <div className="space-y-3 text-sm">
                <button onClick={saveCurrent} className="w-full bg-amber-400 text-black font-semibold rounded px-3 py-2 text-sm">Save project</button>
                <div>
                  <p className="text-xs font-semibold mb-1">Saved projects</p>
                  {projects.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-xs py-1">
                      <button onClick={() => { const np = normalizeProject(p); setProject(np); setProjectName(np.name); setSelectedId(null); }} className="flex-1 text-left hover:text-amber-300 truncate">{p.name}</button>
                      <button onClick={() => { const copy = { ...JSON.parse(JSON.stringify(p)) as Project, id: uid('proj'), name: p.name + ' (copy)' }; saveProject(copy); setProjects(listProjects()); }} className="text-zinc-400">⧉</button>
                      <button onClick={() => { deleteProject(p.id); setProjects(listProjects()); }} className="text-red-400">✕</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${project.name.replace(/\W+/g, '-')}.json`; a.click(); }} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs">Export JSON</button>
                  <label className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs cursor-pointer">Import JSON<input type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; f.text().then((t) => { try { const np = normalizeProject(JSON.parse(t) as Project); setProject(np); setProjectName(np.name); setProjects(listProjects()); } catch { setSavedMsg('Invalid project file'); } }); }} /></label>
                </div>
                <button onClick={() => { const d = demoProject(); setProject(d); setProjectName(d.name); }} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs">Load demo project</button>
                <p className="text-xs text-zinc-500">Projects live in this browser (localStorage). Videos are session-only; images are stored compressed.</p>
              </div>
            )}
          </div>
        </aside>

        {/* center: stage + timeline */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex-1 flex items-center justify-center bg-black p-3 min-h-0 overflow-auto">
            <div ref={stageWrapRef} className="relative w-full max-w-5xl aspect-video bg-black rounded overflow-hidden select-none" style={{ touchAction: 'none' }}
              onPointerDown={onStagePointerDown} onPointerMove={onStagePointerMove} onPointerUp={onStagePointerUp} onPointerLeave={onStagePointerUp}>
              <canvas ref={stageCanvasRef} width={1280} height={720} className="absolute inset-0 w-full h-full" />
              {/* corner + edge handles for selected surface */}
              {sel && sel.corners.map((c, i) => (
                <div key={i} className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-amber-400 border-2 border-black cursor-move z-10"
                  style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                  onPointerDown={(e) => { e.stopPropagation(); dragRef.current = { corner: i, surfaceId: sel.id }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }} />
              ))}
              {sel && ([['top'], ['bottom'], ['left'], ['right']] as const).map(([edge]) => {
                const x = (sel.corners[0].x + sel.corners[1].x) / 2;
                const y = (sel.corners[0].y + sel.corners[3].y) / 2;
                const px = edge === 'left' ? sel.corners[0].x : edge === 'right' ? sel.corners[1].x : x;
                const py = edge === 'top' ? sel.corners[0].y : edge === 'bottom' ? sel.corners[3].y : y;
                return (
                  <div key={edge} title="Drag to bend edge (curve)" className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-cyan-400 border-2 border-black cursor-ew-resize z-10"
                    style={{ left: `${px * 100}%`, top: `${py * 100}%` }}
                    onPointerDown={(e) => { e.stopPropagation(); dragRef.current = { edge, surfaceId: sel.id }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }} />
                );
              })}
              <div className="absolute left-2 top-2 text-[10px] bg-black/60 rounded px-2 py-1 text-zinc-300 pointer-events-none">
                {sel ? `${sel.name} — drag corners to align · cyan dots bend edges` : 'Click a surface to select it'} · {stageW}×{stageH} stage
              </div>
              {recording && <div className="absolute right-2 top-2 text-xs bg-red-600 rounded px-2 py-1 font-bold">● REC {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, '0')}</div>}
            </div>
          </div>

          {/* scenes + timeline */}
          <div className="border-t border-zinc-800 bg-[#111114] p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold">Scenes</span>
              {project.scenes.map((sc, i) => (
                <button key={sc.id} onClick={() => { setShowIdx(i); switchScene(sc); }} className={`text-xs px-2 py-1 rounded border ${project.currentSceneId === sc.id ? 'bg-amber-400 text-black border-amber-400 font-semibold' : 'bg-zinc-800 border-zinc-700'}`}>{sc.name} · {sc.duration}s</button>
              ))}
              <button onClick={() => { const sc: Scene = { id: uid('scene'), name: `Scene ${project.scenes.length + 1}`, duration: 10, surfaces: project.surfaces.map(cloneSurface) }; updateProject((p) => ({ ...p, scenes: [...p.scenes, sc] })); }} className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1">＋ Scene (snapshot)</button>
              <button onClick={() => { const cur = project.scenes.find((s) => s.id === project.currentSceneId); if (!cur) return; const sc: Scene = { id: uid('scene'), name: cur.name + ' copy', duration: cur.duration, surfaces: cur.surfaces.map(cloneSurface) }; updateProject((p) => ({ ...p, scenes: [...p.scenes, sc] })); }} className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1">Duplicate</button>
              <button onClick={() => { if (project.scenes.length <= 1) return; updateProject((p) => ({ ...p, scenes: p.scenes.filter((s) => s.id !== p.currentSceneId) })); }} className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1">Delete current</button>
              <select value={project.transition} onChange={(e) => updateProject((p) => ({ ...p, transition: e.target.value as Project['transition'] }))} className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1">
                <option value="fade">Fade</option><option value="dissolve">Dissolve</option><option value="cut">Cut</option>
              </select>
              <Slider label="Transition" value={project.transitionDuration} min={0.2} max={3} step={0.1} onChange={(v) => updateProject((p) => ({ ...p, transitionDuration: v }))} format={(v) => `${v.toFixed(1)}s`} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => {
                if (playing) { setPlaying(false); showRef.current.playing = false; return; }
                if (project.scenes.length === 0) return;
                showRef.current = { playing: true, idx: 0, sceneStart: (performance.now() - LOOP_EPOCH) / 1000 };
                setShowIdx(0); setPlaying(true); switchScene(project.scenes[0]);
              }} className="bg-emerald-500 text-black text-xs font-bold px-3 py-1.5 rounded">{playing ? '■ Stop show' : '▶ Play Show'}</button>
              <span className="text-xs text-zinc-500">Timeline: scenes play in order, auto-advancing after each duration.</span>
              {project.scenes.map((sc, i) => (
                <span key={sc.id} className={`text-xs px-2 py-1 rounded ${i === showIdx && playing ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800'}`}>{sc.name}
                  <input type="number" min={2} max={120} value={sc.duration} onChange={(e) => updateProject((p) => ({ ...p, scenes: p.scenes.map((x) => x.id === sc.id ? { ...x, duration: Number(e.target.value) || 10 } : x) }))} className="w-12 ml-1 bg-zinc-900 border border-zinc-700 rounded px-1 text-xs" />s
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-2">
              <span className="text-xs font-semibold">Audio track</span>
              <input type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && onAudioFile(e.target.files[0])} className="text-xs" />
              {audioName && <span className="text-xs text-zinc-400">{audioName}</span>}
              <button onClick={() => { const a = audioElRef.current; if (!a || !audioUrl) return; if (audioPlaying) { a.pause(); setAudioPlaying(false); } else { a.currentTime = trimStart; a.play().catch(() => undefined); setAudioPlaying(true); } }} disabled={!audioUrl} className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 disabled:opacity-40">{audioPlaying ? '⏸ Pause' : '▶ Play audio'}</button>
              <Slider label="Trim start" value={trimStart} min={0} max={60} onChange={setTrimStart} format={(v) => `${v}s`} />
              <Slider label="Trim end" value={trimEnd} min={5} max={120} onChange={setTrimEnd} format={(v) => `${v}s`} />
              <Slider label="Volume" value={Math.round(volume * 100)} min={0} max={100} onChange={(v) => { setVolume(v / 100); if (audioElRef.current) audioElRef.current.volume = v / 100; }} format={(v) => `${v}%`} />
              <span className="text-xs text-zinc-500">Export: {recNote || 'record the show with audio when a track is attached.'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-2">
              <span className="text-xs font-semibold">Export show</span>
              {(['720', '1080', '4k'] as ExportRes[]).map((r) => (
                <button key={r} onClick={() => setExportRes(r)} className={`text-xs px-2 py-1 rounded border ${exportRes === r ? 'bg-amber-400 text-black border-amber-400 font-semibold' : 'bg-zinc-800 border-zinc-700'}`}>{r === '720' ? '720p' : r === '1080' ? '1080p' : '4K'}</button>
              ))}
              {!recording
                ? <button onClick={startRecording} className="bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded">● Record</button>
                : <button onClick={stopRecording} className="bg-zinc-200 text-black text-xs font-bold px-3 py-1.5 rounded">■ Stop &amp; prepare download</button>}
              {downloadUrl && <a href={downloadUrl} download={`lazy-lighting-${exportRes}.webm`} className="text-xs bg-emerald-500 text-black font-semibold px-3 py-1.5 rounded">⬇ Download .webm ({exportRes})</a>}
              <span className="text-xs text-zinc-500">“Export once, play without your phone” — open /output on any screen, or play the downloaded file.</span>
            </div>
          </div>
        </main>

        {/* right panel */}
        <aside className="w-72 shrink-0 border-l border-zinc-800 bg-[#101013] overflow-y-auto p-3 space-y-3">
          {sel ? (
            <>
              <div>
                <input value={sel.name} onChange={(e) => updateSurface(sel.id, { name: e.target.value })} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm font-semibold" />
                <p className="text-xs text-zinc-500 mt-1">{sel.shape} · z {sel.z} · {sel.content.kind}</p>
              </div>
              <div>
                <p className="text-xs font-semibold mb-1">Content</p>
                <div className="flex flex-wrap gap-1">
                  {(['visual', 'image', 'video', 'camera', 'draw', 'depth'] as const).map((k) => (
                    <button key={k} onClick={() => updateSurface(sel.id, (s) => ({ ...s, content: { ...s.content, kind: k } }))} className={`text-xs px-2 py-1 rounded capitalize ${sel.content.kind === k ? 'bg-amber-400 text-black font-semibold' : 'bg-zinc-800'}`}>{k}</button>
                  ))}
                </div>
                {sel.content.kind === 'visual' && <p className="text-xs text-zinc-400 mt-1">Current: {getVisual(sel.content.visualId).name} — pick another in the Visuals tab.</p>}
                {sel.shape === 'text' && <input value={sel.content.text ?? ''} onChange={(e) => updateSurface(sel.id, (s) => ({ ...s, content: { ...s.content, text: e.target.value } }))} className="w-full mt-2 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm" placeholder="Text on shape" />}
                {sel.content.kind === 'depth' && <div className="mt-2"><Slider label="Depth strength" value={Math.round(sel.content.depth * 100)} min={0} max={100} onChange={(v) => updateSurface(sel.id, (s) => ({ ...s, content: { ...s.content, depth: v / 100 } }))} format={(v) => `${v}%`} /></div>}
                <div className="flex gap-2 mt-2">
                  <label className="text-xs flex-1">Color 1 <input type="color" value={sel.content.colors[0]} onChange={(e) => updateSurface(sel.id, (s) => ({ ...s, content: { ...s.content, colors: [e.target.value, s.content.colors[1]] } }))} className="w-full h-7" /></label>
                  <label className="text-xs flex-1">Color 2 <input type="color" value={sel.content.colors[1]} onChange={(e) => updateSurface(sel.id, (s) => ({ ...s, content: { ...s.content, colors: [s.content.colors[0], e.target.value] } }))} className="w-full h-7" /></label>
                </div>
              </div>
              <Slider label="Opacity" value={Math.round(sel.opacity * 100)} min={0} max={100} onChange={(v) => updateSurface(sel.id, { opacity: v / 100 })} format={(v) => `${v}%`} />
              <Slider label="Z-order" value={sel.z} min={1} max={20} onChange={(v) => updateSurface(sel.id, { z: v })} />
              <Slider label="Edge curve" value={Math.round(sel.curve * 100)} min={-100} max={100} onChange={(v) => updateSurface(sel.id, { curve: v / 100 })} format={(v) => `${v}%`} />
              <div>
                <p className="text-xs font-semibold mb-1">Mask</p>
                <div className="flex gap-1">{(['none', 'circle', 'rounded', 'cutout'] as const).map((m) => (
                  <button key={m} onClick={() => updateSurface(sel.id, { mask: m })} className={`text-xs px-2 py-1 rounded capitalize ${sel.mask === m ? 'bg-amber-400 text-black font-semibold' : 'bg-zinc-800'}`}>{m}</button>
                ))}</div>
              </div>
              <div className="border-t border-zinc-800 pt-3 space-y-2">
                <p className="text-xs font-semibold">Effects — live</p>
                <Slider label="Blur" value={sel.effects.blur} min={0} max={12} onChange={(v) => updateEffects(sel.id, { blur: v })} format={(v) => `${v}px`} />
                <Slider label="Brightness" value={sel.effects.brightness} min={0} max={200} onChange={(v) => updateEffects(sel.id, { brightness: v })} format={(v) => `${v}%`} />
                <Slider label="Contrast" value={sel.effects.contrast} min={0} max={200} onChange={(v) => updateEffects(sel.id, { contrast: v })} format={(v) => `${v}%`} />
                <Slider label="Saturate" value={sel.effects.saturate} min={0} max={200} onChange={(v) => updateEffects(sel.id, { saturate: v })} format={(v) => `${v}%`} />
                <Slider label="Hue" value={sel.effects.hue} min={0} max={360} onChange={(v) => updateEffects(sel.id, { hue: v })} format={(v) => `${v}°`} />
                <Slider label="Invert" value={sel.effects.invert} min={0} max={100} onChange={(v) => updateEffects(sel.id, { invert: v })} format={(v) => `${v}%`} />
                <Slider label="Grayscale" value={sel.effects.grayscale} min={0} max={100} onChange={(v) => updateEffects(sel.id, { grayscale: v })} format={(v) => `${v}%`} />
                <Slider label="Zoom" value={Math.round(sel.effects.zoom * 100)} min={50} max={300} onChange={(v) => updateEffects(sel.id, { zoom: v / 100 })} format={(v) => `${v}%`} />
                <Slider label="Rotate" value={sel.effects.rotate} min={-180} max={180} onChange={(v) => updateEffects(sel.id, { rotate: v })} format={(v) => `${v}°`} />
                <Slider label="Kaleidoscope" value={sel.effects.kaleidoSegments} min={0} max={12} onChange={(v) => updateEffects(sel.id, { kaleidoSegments: v })} format={(v) => v === 0 ? 'off' : `${v} segments`} />
                <Slider label="Tile X" value={sel.effects.tileX} min={1} max={6} onChange={(v) => updateEffects(sel.id, { tileX: v })} />
                <Slider label="Tile Y" value={sel.effects.tileY} min={1} max={6} onChange={(v) => updateEffects(sel.id, { tileY: v })} />
                <Slider label="Slide speed" value={Math.round(sel.effects.slideSpeed * 100)} min={0} max={100} onChange={(v) => updateEffects(sel.id, { slideSpeed: v / 100 })} format={(v) => `${v}%`} />
                <Slider label="Color cycle" value={Math.round(sel.effects.colorCycle * 100)} min={0} max={100} onChange={(v) => updateEffects(sel.id, { colorCycle: v / 100 })} format={(v) => v === 0 ? 'off' : `${v}%`} />
              </div>
              <div className="border-t border-zinc-800 pt-3 space-y-2">
                <p className="text-xs font-semibold">Audio / BPM / MIDI</p>
                <button onClick={toggleMic} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs">{micOn ? '🎙 Mic reactive: ON' : '🎙 Enable mic (audio-reactive)'}</button>
                <div className="h-2 bg-zinc-800 rounded overflow-hidden"><div className="h-full bg-emerald-400" style={{ width: `${Math.round(audioLevel * 100)}%` }} /></div>
                <p className="text-[11px] text-zinc-500">Audio level: {Math.round(audioLevel * 100)}% — drives visuals.</p>
                <Slider label="BPM" value={bpm} min={60} max={180} onChange={(v) => { setBpm(v); updateProject((p) => ({ ...p, bpm: v })); }} />
                <label className="block text-xs text-zinc-400">LFO target
                  <select value={lfoTarget} onChange={(e) => setLfoTarget(e.target.value as typeof lfoTarget)} className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200">
                    <option value="none">None</option><option value="opacity">Opacity</option><option value="zoom">Zoom / scale</option><option value="hue">Hue</option>
                  </select>
                </label>
                <Slider label="LFO depth" value={Math.round(lfoDepth * 100)} min={0} max={100} onChange={(v) => setLfoDepth(v / 100)} format={(v) => `${v}%`} />
                <button onClick={connectMidi} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs">Connect MIDI</button>
                <p className="text-[11px] text-zinc-500">{midiStatus}</p>
                <p className="text-[11px] text-zinc-500">{motionNote}</p>
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-400">No surface selected. Add a shape on the left, or click a surface on the stage.</p>
          )}
          <p className="text-[11px] text-zinc-600 pt-4">Lazy Lighting Web — unofficial recreation of the Lazy Lighting iOS app (Audity Apps). Not affiliated with or endorsed by Audity Apps.</p>
        </aside>
      </div>

      {/* hidden media elements */}
      <video ref={cameraVideoRef} muted playsInline className="hidden" />
      <audio ref={audioElRef} src={audioUrl || undefined} onEnded={() => setAudioPlaying(false)} onTimeUpdate={(e) => { const a = e.currentTarget; if (trimEnd > 0 && a.currentTime >= trimEnd) { a.pause(); setAudioPlaying(false); } }} className="hidden" />
    </div>
  );
}

// Shared epoch so the rAF loop and event handlers agree on "seconds since page load".
const LOOP_EPOCH = typeof performance !== 'undefined' ? performance.now() : 0;
