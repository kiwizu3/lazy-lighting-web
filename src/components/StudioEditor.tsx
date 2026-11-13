// Shared editor shell for /studio and /studio/[projectId].
// Loads the requested project from IndexedDB (falls back to the demo project
// with a notice), then renders the Phase 2 WebGL ProjectionCanvas inside
// the v2 shell. The v1 Studio component is kept intact as a fallback (used
// by ProjectionCanvas itself when WebGL is unavailable) but is no longer
// the editor stage.
//
// Phase 5: tabbed sidebars (every tab is a working Phase 3/4 panel — no
// placeholders), the real TimelineEditor at the bottom, PerformanceMode,
// ProjectorSetup, BroadcastChannel sync to the output window, and the
// hidden project-audio element the render loop keeps on the playhead.
'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import StudioLayout from './StudioLayout';
import TopToolbar from './TopToolbar';
import ShapeToolbar from './ShapeToolbar';
import LayersPanel from './LayersPanel';
import PropertiesPanel from './PropertiesPanel';
import MediaLibrary from './MediaLibrary';
import VisualLibrary from './VisualLibrary';
import DrawingWorkspace from './DrawingWorkspace';
import MaskEditor from './MaskEditor';
import SceneManager from './SceneManager';
import EffectsPanel from './EffectsPanel';
import AudioAnalyzer from './AudioAnalyzer';
import MidiController from './MidiController';
import ModulationEditor from './ModulationEditor';
import TimelineEditor from './TimelineEditor';
import PerformanceMode from './PerformanceMode';
import ProjectorSetup from './ProjectorSetup';
import type { CreationMode } from './ProjectionCanvas';
import { useKeyboardShortcuts } from '../lib/shortcuts';
import { ensureDemoSeeded, useStudioStore } from '../lib/store';
import { getMediaBlob } from '../lib/db';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

// three.js touches WebGL at construction time only, but the engine module
// is client-only by design — load the canvas without SSR.
const ProjectionCanvas = dynamic(() => import('./ProjectionCanvas'), { ssr: false });
const DepthMode = dynamic(() => import('./DepthMode'), { ssr: false });
const TrackingPanel = dynamic(() => import('./TrackingPanel'), { ssr: false });

const LEFT_TABS = [
  { id: 'shapes', label: 'Shapes' },
  { id: 'layers', label: 'Layers' },
  { id: 'media', label: 'Media' },
  { id: 'visuals', label: 'Visuals' },
  { id: 'draw', label: 'Draw' },
  { id: 'masks', label: 'Masks' },
  { id: 'scenes', label: 'Scenes' },
] as const;

const RIGHT_TABS = [
  { id: 'properties', label: 'Properties' },
  { id: 'effects', label: 'Effects' },
  { id: 'audio', label: 'Audio' },
  { id: 'midi', label: 'MIDI' },
  { id: 'modulation', label: 'Modulation' },
  { id: 'depth', label: 'Depth' },
  { id: 'tracking', label: 'Tracking' },
] as const;

type LeftTab = (typeof LEFT_TABS)[number]['id'];
type RightTab = (typeof RIGHT_TABS)[number]['id'];

function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Panel tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`rounded px-2 py-1 text-xs ${
            active === t.id
              ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/60'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Broadcast the project + playhead to the output window (same browser). */
function OutputSync() {
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('lazy-lighting-output');
    } catch {
      bc = null;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const postState = () => {
      const p = useStudioStore.getState().project;
      if (!p) return;
      bc?.postMessage({ type: 'state', project: p });
      try {
        localStorage.setItem(
          'lazy-lighting-output-state',
          JSON.stringify({ project: p, surfaces: p.surfaces, updatedAt: Date.now() }),
        );
      } catch {
        /* storage full / unavailable — BroadcastChannel still carries state */
      }
    };
    const unsub = useStudioStore.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(postState, 400);
    });
    const iv = setInterval(() => {
      const st = useStudioStore.getState();
      if (!bc || !st.project) return;
      bc.postMessage({
        type: 'playhead',
        time: st.playback.time,
        playing: st.playback.playing,
        sceneId: st.project.timeline.currentSceneId,
      });
    }, 200);
    postState();
    return () => {
      unsub();
      clearInterval(iv);
      if (timer) clearTimeout(timer);
      bc?.close();
    };
  }, []);
  return null;
}

/** Hidden project-audio element; the render loop keeps it on the playhead. */
function ProjectAudioPlayer() {
  const track = useStudioStore((s) => s.project?.audioTracks?.[0] ?? null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaId = track?.mediaId;
  const url = track?.url;
  const volume = track?.volume ?? 1;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    el.pause();
    el.removeAttribute('src');
    el.load();
    if (!mediaId && !url) return;
    if (url) {
      el.src = url;
      return;
    }
    if (mediaId) {
      void getMediaBlob(mediaId).then((rec) => {
        if (cancelled || !rec) return;
        objectUrl = URL.createObjectURL(rec.blob);
        el.src = objectUrl;
      });
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId, url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  return <audio ref={audioRef} data-project-track preload="auto" className="hidden" aria-hidden />;
}

/** Stage wrapper that letterboxes the canvas to the project's output aspect. */
function AspectStage({ children }: { children: React.ReactNode }) {
  const aspect = useStudioStore((s) => s.project?.settings.aspect ?? '16:9');
  const customW = useStudioStore((s) => s.project?.settings.customAspectWidth ?? 16);
  const customH = useStudioStore((s) => s.project?.settings.customAspectHeight ?? 9);
  const ratio = aspect === 'custom' ? customW / customH : aspect === '4:3' ? 4 / 3 : aspect === '21:9' ? 21 / 9 : 16 / 9;
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      let w = rect.width;
      let h = w / ratio;
      if (h > rect.height) {
        h = rect.height;
        w = h * ratio;
      }
      setSize({ w: Math.floor(w), h: Math.floor(h) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);

  return (
    <div ref={containerRef} className="flex h-full w-full items-center justify-center overflow-hidden bg-black">
      <div
        className="relative"
        style={size.w > 0 ? { width: size.w, height: size.h } : { width: '100%', height: '100%' }}
      >
        {children}
      </div>
    </div>
  );
}

export default function StudioEditor({ projectId }: { projectId?: string }) {
  useKeyboardShortcuts();
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creationMode, setCreationMode] = useState<CreationMode>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>('shapes');
  const [rightTab, setRightTab] = useState<RightTab>('properties');
  const [showProjectorSetup, setShowProjectorSetup] = useState(false);
  const performanceMode = useStudioStore((s) => s.performanceMode);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = useStudioStore.getState();
      if (projectId) {
        const loaded = await store.loadProjectById(projectId);
        if (!loaded && !cancelled) {
          const demo = await ensureDemoSeeded();
          if (demo && !cancelled) {
            store.setProject(demo);
            setNotice(`Project “${projectId}” was not found — opened the demo project instead.`);
          }
        }
      } else if (!store.project) {
        const demo = await ensureDemoSeeded();
        if (demo && !cancelled) store.setProject(demo);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading studio…
      </div>
    );
  }

  const left = (
    <div className="space-y-4 p-3">
      <TabBar tabs={LEFT_TABS} active={leftTab} onChange={(id) => setLeftTab(id as LeftTab)} />
      {leftTab === 'shapes' && <ShapeToolbar creationMode={creationMode} onCreationModeChange={setCreationMode} />}
      {leftTab === 'layers' && <LayersPanel />}
      {leftTab === 'media' && <MediaLibrary />}
      {leftTab === 'visuals' && <VisualLibrary />}
      {leftTab === 'draw' && <DrawingWorkspace />}
      {leftTab === 'masks' && <MaskEditor />}
      {leftTab === 'scenes' && <SceneManager />}
    </div>
  );

  const right = (
    <div className="space-y-4 p-3">
      <TabBar tabs={RIGHT_TABS} active={rightTab} onChange={(id) => setRightTab(id as RightTab)} />
      {rightTab === 'properties' && <PropertiesPanel />}
      {rightTab === 'effects' && <EffectsPanel />}
      {rightTab === 'audio' && <AudioAnalyzer />}
      {rightTab === 'midi' && <MidiController />}
      {rightTab === 'modulation' && <ModulationEditor />}
      {rightTab === 'depth' && <DepthMode />}
      {rightTab === 'tracking' && <TrackingPanel />}
      <div className="border-t border-zinc-800 pt-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Output</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => window.open('/output', '_blank', 'noopener')}>
            Open output window ↗
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowProjectorSetup(true)}>
            Projector setup
          </Button>
          <Button variant="outline" size="sm" onClick={() => useStudioStore.getState().setPerformanceMode(true)}>
            Performance mode
          </Button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Open on a projector / second display while you work here.</p>
      </div>
    </div>
  );

  const timeline = (
    <div className="h-full">
      <TimelineEditor />
    </div>
  );

  return (
    <div className="h-screen">
      <OutputSync />
      <ProjectAudioPlayer />
      {performanceMode && <PerformanceMode />}
      {notice && (
        <div className="bg-amber-500/15 px-4 py-2 text-center text-sm text-amber-200" role="status">
          {notice}
          <button type="button" className="ml-3 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      <StudioLayout
        toolbar={<TopToolbar onOpenProjectorSetup={() => setShowProjectorSetup(true)} />}
        left={left}
        right={right}
        stage={
          <AspectStage>
            <ProjectionCanvas creationMode={creationMode} onCreationModeChange={setCreationMode} />
          </AspectStage>
        }
        timeline={timeline}
      />
      <Dialog open={showProjectorSetup} onOpenChange={setShowProjectorSetup} title="Projector setup" className="max-w-2xl">
        <ProjectorSetup onClose={() => setShowProjectorSetup(false)} />
      </Dialog>
    </div>
  );
}
