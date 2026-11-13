// Tracking panel — Phase 6.
// Hand / face tracking via MediaPipe tasks-vision (loaded only when the
// user enables tracking — dynamic import, never in the initial bundle),
// with an honest motion-tracking fallback (camera motion centroid) when
// the models cannot load. Values flow into the Phase 5 live-modulation
// path: mapped values are written to performStore.trackingLive
// (`global:<target>`) and computeLiveMod applies them with audio / MIDI /
// LFO / keyframes. Nothing here is a parallel system.
'use client';
import { useEffect, useRef, useState } from 'react';
import { startCamera, stopCamera, getCameraStream } from '../lib/camera';
import { usePerformStore } from '../lib/performStore';
import {
  DEFAULT_TRACKING_MAPPINGS,
  TrackingEngine,
  mapTrackingValue,
  readTrackingSource,
  trackingSourceLabel,
  type TrackingFrame,
  type TrackingMapping,
  type TrackingStatus,
} from '../lib/tracking';
import { Button } from './ui/button';

const MAPPINGS_KEY = 'lazy-lighting-tracking-mappings-v1';

function loadMappings(): TrackingMapping[] {
  try {
    const raw = localStorage.getItem(MAPPINGS_KEY);
    if (!raw) return DEFAULT_TRACKING_MAPPINGS;
    const parsed = JSON.parse(raw) as TrackingMapping[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_TRACKING_MAPPINGS;
    return parsed;
  } catch {
    return DEFAULT_TRACKING_MAPPINGS;
  }
}

const NEUTRAL: Record<string, number> = {
  hue: 0,
  scale: 1,
  effectIntensity: 1,
  rotation: 0,
  brightness: 1,
  density: 1,
};

const TARGET_LABELS: Record<string, string> = {
  hue: 'Hue',
  scale: 'Scale',
  effectIntensity: 'Effect intensity',
  rotation: 'Rotation',
  brightness: 'Brightness',
  density: 'Density',
};

export default function TrackingPanel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<TrackingEngine | null>(null);
  const mappingsRef = useRef<TrackingMapping[]>(loadMappings());
  const lastWriteRef = useRef(0);
  const lastReadoutRef = useRef(0);
  const lastFrameRef = useRef<TrackingFrame | null>(null);

  const [mappings, setMappings] = useState<TrackingMapping[]>(mappingsRef.current);
  const [status, setStatus] = useState<TrackingStatus>({ mode: 'off', handModel: 'idle', faceModel: 'idle', error: null });
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [readout, setReadout] = useState<TrackingFrame | null>(null);
  const [liveValues, setLiveValues] = useState<Record<string, number>>({});
  const [manualMsg, setManualMsg] = useState<string | null>(null);

  const enabled = status.mode !== 'off';

  useEffect(() => {
    mappingsRef.current = mappings;
    try {
      localStorage.setItem(MAPPINGS_KEY, JSON.stringify(mappings));
    } catch { /* storage unavailable */ }
  }, [mappings]);

  useEffect(() => {
    // Clean up on unmount: stop detection + release the shared camera.
    return () => {
      engineRef.current?.stop();
      engineRef.current = null;
      usePerformStore.getState().clearTrackingLive();
    };
  }, []);

  const drawPreview = (frame: TrackingFrame) => {
    const canvas = previewRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (video.readyState >= 2 && video.videoWidth > 0) {
      // Mirror horizontally (selfie view).
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.restore();
    }
    // Landmark dots (mirrored to match the preview).
    const dot = (x: number, y: number, color: string, r: number) => {
      ctx.beginPath();
      ctx.arc((1 - x) * w, y * h, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    for (const hand of frame.handLandmarks) {
      for (const p of hand) dot(p.x, p.y, '#22d3ee', 2.5);
    }
    for (const face of frame.faceLandmarks) {
      for (const p of face) dot(p.x, p.y, '#f472b6', 1.5);
    }
    if (frame.mode === 'motion' && frame.motionX !== null && frame.motionY !== null) {
      ctx.beginPath();
      ctx.arc((1 - frame.motionX) * w, frame.motionY * h, 6 + frame.motionAmount * 10, 0, Math.PI * 2);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  };

  const onFrame = (frame: TrackingFrame) => {
    lastFrameRef.current = frame;
    drawPreview(frame);
    const now = performance.now();
    // Throttle store writes to ~15 Hz so the render loop (not React) is
    // the only per-frame consumer.
    if (now - lastWriteRef.current >= 66) {
      lastWriteRef.current = now;
      const perf = usePerformStore.getState();
      const nextLive: Record<string, number> = {};
      for (const m of mappingsRef.current) {
        if (!m.enabled) continue;
        const raw = readTrackingSource(frame, m.source);
        const value = raw === null ? NEUTRAL[m.target] : mapTrackingValue(m, raw);
        perf.setTrackingLive(`global:${m.target}`, value);
        nextLive[m.id] = value;
      }
      setLiveValues(nextLive);
    }
    if (now - lastReadoutRef.current >= 150) {
      lastReadoutRef.current = now;
      setReadout(frame);
    }
  };

  const enableTracking = async () => {
    setEnabling(true);
    setCameraError(null);
    try {
      const stream = await startCamera();
      const video = videoRef.current;
      if (!video) throw new Error('The preview video element is not ready.');
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const engine = new TrackingEngine();
      engineRef.current = engine;
      const mode = await engine.enable(video);
      setStatus({ ...engine.status });
      engine.start(onFrame);
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Could not start the camera.');
      stopCamera();
      engineRef.current = null;
    } finally {
      setEnabling(false);
    }
  };

  const disableTracking = () => {
    engineRef.current?.stop();
    engineRef.current = null;
    stopCamera();
    usePerformStore.getState().clearTrackingLive();
    setStatus({ mode: 'off', handModel: 'idle', faceModel: 'idle', error: null });
    setReadout(null);
    setLiveValues({});
    const video = videoRef.current;
    if (video) video.srcObject = null;
    const canvas = previewRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const updateMapping = (id: string, patch: Partial<TrackingMapping>) => {
    setMappings((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const modeLabel =
    status.mode === 'mediapipe'
      ? 'Hand/face tracking (MediaPipe)'
      : status.mode === 'motion'
        ? 'Motion tracking (no hand/face model)'
        : 'Tracking off';

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">Hand / face tracking</h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          Map your hand and face to visual parameters in real time. Enabling downloads the
          MediaPipe hand + face models (~12 MB) on first use. If the models cannot load,
          the panel falls back to motion tracking and says so — it never claims hand/face
          tracking when it is not running.
        </p>
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-xs">
        <p className="font-medium text-zinc-200">Status: {modeLabel}</p>
        {enabled && (
          <p className="mt-1 text-zinc-400">
            Hand model: {status.handModel} · Face model: {status.faceModel}
            {readout?.handDetected ? ' · ✋ hand detected' : ''}
            {readout?.faceDetected ? ' · 🙂 face detected' : ''}
            {status.mode === 'motion' && readout ? ` · motion ${(readout.motionAmount * 100).toFixed(0)}%` : ''}
          </p>
        )}
        {status.error && <p className="mt-1 text-amber-200">{status.error}</p>}
        {cameraError && <p className="mt-1 text-rose-300" role="alert">{cameraError}</p>}
      </div>

      <div>
        <canvas ref={previewRef} width={320} height={180} className="w-full rounded border border-zinc-800 bg-black" aria-label="Camera preview with tracking landmarks" />
        <video ref={videoRef} muted playsInline className="hidden" aria-hidden />
        <p className="mt-1 text-[11px] text-zinc-500">
          Camera preview with landmark dots. The camera is shared with camera surfaces in the project.
        </p>
      </div>

      <div className="flex gap-2">
        {!enabled ? (
          <Button onClick={() => void enableTracking()} disabled={enabling} className="flex-1">
            {enabling ? 'Loading models…' : 'Enable tracking'}
          </Button>
        ) : (
          <Button variant="outline" onClick={disableTracking} className="flex-1">
            Stop tracking
          </Button>
        )}
      </div>

      {enabled && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            disableTracking();
            setManualMsg('Tracking stopped and values reset to neutral. Drive the same parameters by hand from the Modulation tab (LFO / keyframes) or the Audio tab.');
          }}
        >
          Use manual controls instead
        </Button>
      )}
      {manualMsg && <p className="text-xs text-emerald-300" role="status">{manualMsg}</p>}
      {enabled && (
        <p className="text-[11px] text-zinc-500">
          Manual fallback: tracking is stopped and values reset to neutral. Drive the same
          parameters by hand from the Modulation tab (LFO / keyframes) instead.
        </p>
      )}

      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Mappings → live modulation</h4>
        {mappings.map((m) => {
          const live = liveValues[m.id];
          return (
            <div key={m.id} className="rounded border border-zinc-800 bg-zinc-900 p-2.5">
              <label className="flex items-center gap-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={m.enabled}
                  onChange={(e) => updateMapping(m.id, { enabled: e.target.checked })}
                  className="accent-amber-500"
                />
                <span>
                  {trackingSourceLabel(m.source)} → {TARGET_LABELS[m.target] ?? m.target}
                </span>
                {live !== undefined && m.enabled && enabled && (
                  <span className="ml-auto font-mono text-[11px] text-amber-300">{live.toFixed(2)}</span>
                )}
              </label>
              <label className="mt-2 block text-[11px] text-zinc-400">
                <span className="mb-1 flex justify-between"><span>Sensitivity</span><span className="text-zinc-300">{m.sensitivity.toFixed(2)}×</span></span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={m.sensitivity}
                  disabled={!m.enabled}
                  onChange={(e) => updateMapping(m.id, { sensitivity: Number(e.target.value) })}
                  className="w-full accent-amber-500 disabled:opacity-50"
                  aria-label={`Sensitivity for ${trackingSourceLabel(m.source)} to ${m.target}`}
                />
              </label>
              <p className="mt-1 text-[11px] text-zinc-500">
                Range {m.min} – {m.max} · {m.enabled ? 'live' : 'off'}
              </p>
            </div>
          );
        })}
        <p className="text-[11px] text-zinc-500">
          Values apply globally (all surfaces) through the same live-modulation path as
          audio, MIDI and LFO. In motion mode only the Motion X / Y rows have a signal.
        </p>
      </div>

      {!getCameraStream() && !enabled && (
        <p className="text-[11px] text-zinc-500">
          Camera permission is requested when you enable tracking. If it is denied, allow
          camera access in the browser address bar and try again.
        </p>
      )}
    </div>
  );
}
