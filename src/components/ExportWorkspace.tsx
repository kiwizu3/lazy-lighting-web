// Export workspace — Phase 6 (functional).
// Records the REAL render loop: the stage below is a live ProjectionCanvas
// whose WebGL backing store is resized to the exact export resolution
// while the playhead runs from t=0, so scene switches, transitions and
// keyframes happen inside the recording. WebM via MediaRecorder;
// MP4 only when the browser can record it directly, or via an optional
// in-browser FFmpeg.wasm transcode after the WebM export.
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Download, Film, Loader2, VideoOff, XCircle } from 'lucide-react';
import { getMediaBlob, loadProject, saveMediaBlob } from '../lib/db';
import type { Project } from '../lib/schema';
import { useStudioStore } from '../lib/store';
import {
  EXPORT_RESOLUTIONS,
  canRecordMp4Directly,
  defaultExportDuration,
  runExport,
  type ExportFps,
  type ExportFormat,
  type ExportHandle,
  type ExportProgress,
  type ExportResolution,
  type ExportResult,
} from '../lib/exportEngine';
import { convertWebmToMp4 } from '../lib/mp4Convert';
import type { WebGLEngine } from '../lib/engine/renderer';
import { Button } from './ui/button';
import { Select } from './ui/select';

const ProjectionCanvas = dynamic(() => import('./ProjectionCanvas'), { ssr: false });

type ExportPhase = 'idle' | 'recording' | 'done' | 'error' | 'cancelled';

const MP4_UNAVAILABLE_NOTE =
  'MP4 export is not available in this browser build — WebM is provided.';

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function ExportWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const engineRef = useRef<{ engine: WebGLEngine; canvas: HTMLCanvasElement } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const exportHandleRef = useRef<ExportHandle | null>(null);

  const [res, setRes] = useState<ExportResolution>('1080');
  const [fps, setFps] = useState<ExportFps>(30);
  const [durationMode, setDurationMode] = useState<'timeline' | 'custom'>('timeline');
  const [customSeconds, setCustomSeconds] = useState(10);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [bitrate, setBitrate] = useState<8 | 16 | 32>(16);
  const [format, setFormat] = useState<ExportFormat>('webm');
  const [mp4Direct, setMp4Direct] = useState(false);

  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMediaId, setSavedMediaId] = useState<string | null>(null);
  const [mp4State, setMp4State] = useState<'idle' | 'converting' | 'done' | 'failed'>('idle');
  const [mp4Progress, setMp4Progress] = useState(0);
  const [mp4Error, setMp4Error] = useState<string | null>(null);
  const [mp4Url, setMp4Url] = useState<string | null>(null);

  // Phase 7 fix: the mount effect's unmount cleanup used to read resultUrl /
  // mp4Url from a stale closure (captured at mount, always null), so blob
  // URLs created later were never revoked on unmount. Track them in refs
  // that stay current, and let the cleanup read the refs.
  const resultUrlRef = useRef<string | null>(null);
  const mp4UrlRef = useRef<string | null>(null);
  useEffect(() => { resultUrlRef.current = resultUrl; }, [resultUrl]);
  useEffect(() => { mp4UrlRef.current = mp4Url; }, [mp4Url]);

  useEffect(() => {
    setMp4Direct(canRecordMp4Directly());
    (async () => {
      const p = await loadProject(projectId);
      if (p) {
        setProject(p);
        useStudioStore.getState().setProject(p);
      } else {
        setMissing(true);
      }
    })();
    return () => {
      exportHandleRef.current?.cancel();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      if (mp4UrlRef.current) URL.revokeObjectURL(mp4UrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ---- project audio track -> hidden <audio data-project-track> ----
  // The render loop keeps this element on the playhead; the export engine
  // taps it into the recording when audio is included.
  const audioTrack = project?.audioTracks?.[0] ?? null;
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    el.pause();
    el.removeAttribute('src');
    el.load();
    if (!audioTrack) return;
    if (audioTrack.url) {
      el.src = audioTrack.url;
      return;
    }
    if (audioTrack.mediaId) {
      void getMediaBlob(audioTrack.mediaId).then((rec) => {
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
  }, [audioTrack?.mediaId, audioTrack?.url]);

  const onEngineReady = useCallback((engine: WebGLEngine, canvas: HTMLCanvasElement) => {
    engineRef.current = { engine, canvas };
    setEngineReady(true);
  }, []);

  const timelineSeconds = project ? defaultExportDuration(project) : 60;
  const durationSec = durationMode === 'timeline' ? timelineSeconds : Math.max(1, Math.min(600, customSeconds));

  const startExport = () => {
    if (!project || !engineRef.current) return;
    setError(null);
    setResult(null);
    setSavedMediaId(null);
    setMp4State('idle');
    setMp4Error(null);
    if (mp4Url) {
      URL.revokeObjectURL(mp4Url);
      setMp4Url(null);
    }
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      setResultUrl(null);
    }
    setPhase('recording');
    setProgress({ elapsedSec: 0, totalSec: durationSec, percent: 0 });
    const handle = runExport(
      project,
      { canvas: engineRef.current.canvas, engine: engineRef.current.engine, audioEl: audioRef.current },
      { resolution: res, fps, durationSec, includeAudio, bitrateMbps: bitrate, format },
      { onProgress: (p) => setProgress(p) },
    );
    exportHandleRef.current = handle;
    void handle.promise
      .then((r) => {
        const url = URL.createObjectURL(r.blob);
        setResult(r);
        setResultUrl(url);
        setPhase('done');
        exportHandleRef.current = null;
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'ExportCancelledError') {
          setPhase('cancelled');
        } else {
          setError(err instanceof Error ? err.message : 'Export failed.');
          setPhase('error');
        }
        exportHandleRef.current = null;
      });
  };

  const cancelExport = () => {
    exportHandleRef.current?.cancel();
  };

  const saveToAssets = async () => {
    if (!result || !project) return;
    const ext = result.format === 'mp4' ? 'mp4' : 'webm';
    const rec = await saveMediaBlob(
      result.blob,
      `${project.name.replace(/[^\w\-]+/g, '-').toLowerCase() || 'project'}-export.${ext}`,
    );
    if (rec) setSavedMediaId(rec.id);
    else setError('Could not save the export to the media library (IndexedDB write failed).');
  };

  const convertToMp4 = async () => {
    if (!result || result.format === 'mp4') return;
    setMp4State('converting');
    setMp4Error(null);
    setMp4Progress(0);
    try {
      const mp4 = await convertWebmToMp4(result.blob, (p) => setMp4Progress(p.progress));
      const url = URL.createObjectURL(mp4);
      setMp4Url(url);
      setMp4State('done');
    } catch (err) {
      setMp4State('failed');
      setMp4Error(err instanceof Error ? err.message : 'MP4 conversion failed.');
    }
  };

  const recording = phase === 'recording';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <Link href="/" className="text-sm font-semibold text-amber-400 hover:text-amber-300">← Dashboard</Link>
          <h1 className="text-lg font-bold">Export — Lazy Lighting</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {missing ? (
          <p className="text-sm text-zinc-400">Project not found in this browser. <Link href="/" className="text-amber-400 underline">Back to dashboard</Link></p>
        ) : !project ? (
          <p className="text-sm text-zinc-400">Loading project…</p>
        ) : (
          <>
            <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="text-base font-semibold">{project.name}</h2>
              <p className="mt-1 text-sm text-zinc-400">
                {project.surfaces.length} surface{project.surfaces.length === 1 ? '' : 's'} · {project.scenes.length} scene{project.scenes.length === 1 ? '' : 's'} · timeline {timelineSeconds}s · canvas {project.canvas.width} × {project.canvas.height}
              </p>
              <div className="mt-4 flex gap-2">
                <Link href={`/studio/${project.id}`}><Button variant="outline">Open in studio</Button></Link>
                <Button variant="outline" onClick={() => useStudioStore.getState().exportProject()}>
                  <Download className="h-4 w-4" /> Download project JSON
                </Button>
              </div>
            </section>

            {/* Live stage — this is the canvas that gets recorded. */}
            <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
                <Film className="h-4 w-4 text-amber-400" /> Stage preview — what gets recorded
              </h2>
              <div className="aspect-video w-full overflow-hidden rounded border border-zinc-800 bg-black">
                <ProjectionCanvas creationMode={null} onCreationModeChange={() => undefined} readOnly onEngineReady={onEngineReady} />
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {engineReady
                  ? 'The stage above is the recording source. It plays from the start of the timeline when you record.'
                  : 'Starting the stage…'}
              </p>
              <audio ref={audioRef} data-project-track preload="auto" className="hidden" aria-hidden />
            </section>

            <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="mb-4 text-base font-semibold">Video export</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm text-zinc-300">
                  <span className="mb-1 block text-xs text-zinc-400">Resolution</span>
                  <Select value={res} onChange={(e) => setRes(e.target.value as ExportResolution)} options={Object.entries(EXPORT_RESOLUTIONS).map(([value, r]) => ({ value, label: r.label }))} aria-label="Export resolution" disabled={recording} />
                </label>
                <label className="block text-sm text-zinc-300">
                  <span className="mb-1 block text-xs text-zinc-400">Frame rate</span>
                  <Select value={String(fps)} onChange={(e) => setFps(Number(e.target.value) as ExportFps)} options={[
                    { value: '24', label: '24 fps' },
                    { value: '30', label: '30 fps' },
                    { value: '60', label: '60 fps' },
                  ]} aria-label="Export frame rate" disabled={recording} />
                </label>
                <label className="block text-sm text-zinc-300">
                  <span className="mb-1 block text-xs text-zinc-400">Duration</span>
                  <Select value={durationMode} onChange={(e) => setDurationMode(e.target.value as 'timeline' | 'custom')} options={[
                    { value: 'timeline', label: `Full timeline — ${timelineSeconds}s` },
                    { value: 'custom', label: 'Custom length…' },
                  ]} aria-label="Export duration source" disabled={recording} />
                </label>
                <label className="block text-sm text-zinc-300">
                  <span className="mb-1 block text-xs text-zinc-400">Quality (video bitrate)</span>
                  <Select value={String(bitrate)} onChange={(e) => setBitrate(Number(e.target.value) as 8 | 16 | 32)} options={[
                    { value: '8', label: '8 Mbps' },
                    { value: '16', label: '16 Mbps' },
                    { value: '32', label: '32 Mbps' },
                  ]} aria-label="Export bitrate" disabled={recording} />
                </label>
                {durationMode === 'custom' && (
                  <label className="block text-sm text-zinc-300">
                    <span className="mb-1 block text-xs text-zinc-400">Custom length (seconds, 1–600)</span>
                    <input
                      type="number"
                      min={1}
                      max={600}
                      value={customSeconds}
                      disabled={recording}
                      onChange={(e) => setCustomSeconds(Math.max(1, Math.min(600, Number(e.target.value) || 1)))}
                      className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none disabled:opacity-50"
                    />
                  </label>
                )}
                <label className="block text-sm text-zinc-300">
                  <span className="mb-1 block text-xs text-zinc-400">Format</span>
                  <Select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} options={[
                    { value: 'webm', label: 'WebM (all browsers)' },
                    ...(mp4Direct ? [{ value: 'mp4', label: 'MP4 — recorded directly (this browser)' }] : []),
                  ]} aria-label="Export format" disabled={recording} />
                </label>
              </div>

              <label className="mt-4 flex items-start gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={includeAudio}
                  disabled={recording || !audioTrack}
                  onChange={(e) => setIncludeAudio(e.target.checked)}
                  className="mt-0.5 accent-amber-500"
                />
                <span>
                  Include project audio in the recording
                  {!audioTrack && ' — no audio track is set on this project, so exports are video-only.'}
                  {audioTrack && ` — “${audioTrack.name}” will be mixed in. You will hear it while recording.`}
                </span>
              </label>

              <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                Records the live stage in real time ({durationSec}s at {fps} fps) — scene switches,
                transitions and keyframed animation all play through. 60 fps capture depends on the
                display and encoder and may fall back to the display refresh rate. 4K recording is
                heavy; on slower machines it may drop frames. Keep this tab visible until the
                recording finishes — the render loop pauses when the tab is hidden.
              </p>

              {!recording ? (
                <Button className="mt-4" onClick={startExport} disabled={!engineReady}>
                  <Film className="h-4 w-4" /> Record video ({durationSec}s, {EXPORT_RESOLUTIONS[res].label.split(' — ')[0]}, {fps} fps)
                </Button>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-amber-200">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Recording… {progress ? `${formatClock(progress.elapsedSec)} / ${formatClock(progress.totalSec)} (${Math.round(progress.percent)}%)` : ''}
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-zinc-800" role="progressbar" aria-valuenow={progress ? Math.round(progress.percent) : 0} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-amber-500 transition-all" style={{ width: `${progress?.percent ?? 0}%` }} />
                  </div>
                  <Button variant="outline" onClick={cancelExport}>
                    <XCircle className="h-4 w-4" /> Cancel recording
                  </Button>
                </div>
              )}

              {phase === 'cancelled' && (
                <p className="mt-4 text-sm text-zinc-400" role="status">Recording cancelled — nothing was saved.</p>
              )}
              {phase === 'error' && error && (
                <p className="mt-4 flex items-start gap-2 text-sm text-rose-300" role="alert">
                  <VideoOff className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
              )}

              {phase === 'done' && result && resultUrl && (
                <div className="mt-5 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-sm font-medium text-emerald-300" role="status">
                    Export complete — {(result.blob.size / 1024 / 1024).toFixed(1)} MB · {EXPORT_RESOLUTIONS[result.resolution].label} · {result.fps} fps · {result.format.toUpperCase()}
                  </p>
                  {result.audioNote && <p className="text-sm text-amber-200">{result.audioNote}</p>}
                  {result.audioIncluded && <p className="text-sm text-zinc-400">Audio was mixed into the recording.</p>}
                  <video src={resultUrl} controls className="aspect-video w-full rounded border border-zinc-800 bg-black" />
                  <div className="flex flex-wrap gap-2">
                    <a href={resultUrl} download={`${project.name.replace(/[^\w\-]+/g, '-').toLowerCase() || 'project'}-export.${result.format}`} className="inline-flex h-9 items-center gap-2 rounded-md bg-amber-500 px-3 text-sm font-medium text-black hover:bg-amber-400">
                      <Download className="h-4 w-4" /> Download .{result.format}
                    </a>
                    <Button variant="outline" onClick={saveToAssets} disabled={!!savedMediaId}>
                      {savedMediaId ? 'Saved to assets ✓' : 'Save to assets'}
                    </Button>
                    {result.format === 'webm' && mp4State !== 'done' && (
                      <Button variant="outline" onClick={convertToMp4} disabled={mp4State === 'converting'}>
                        {mp4State === 'converting' ? `Converting… ${Math.round(mp4Progress * 100)}%` : 'Convert to MP4 (in-browser)'}
                      </Button>
                    )}
                    {mp4State === 'done' && mp4Url && (
                      <a href={mp4Url} download={`${project.name.replace(/[^\w\-]+/g, '-').toLowerCase() || 'project'}-export.mp4`} className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-500">
                        <Download className="h-4 w-4" /> Download .mp4
                      </a>
                    )}
                  </div>
                  {savedMediaId && (
                    <p className="text-xs text-zinc-400">Saved to the media library (asset id {savedMediaId}). Find it under Media in the studio.</p>
                  )}
                  {result.format === 'webm' && mp4State === 'idle' && (
                    <p className="text-xs text-zinc-500">
                      MP4 conversion runs in-browser via FFmpeg.wasm and downloads the encoder (~31 MB) on first use.
                      {!mp4Direct && ' This browser cannot record MP4 directly, so conversion is the only MP4 path.'}
                    </p>
                  )}
                  {mp4State === 'failed' && (
                    <p className="text-sm text-amber-200" role="alert">
                      {mp4Error} {MP4_UNAVAILABLE_NOTE}
                    </p>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
