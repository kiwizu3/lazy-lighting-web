// Depth mode panel — Phase 6.
// Upload a photo, get an ESTIMATED depth map (luminance + edges —
// labelled everywhere as estimated, never AI), or import a real
// grayscale depth map instead. Seven depth presets sample the map in
// real time; mouse-move over the preview adds parallax. "Assign to
// surface" writes content { kind: 'depth', mediaId, depthMapId, params }
// via the store, and the engine renders it (src/lib/engine/sources.ts).
'use client';
import { useEffect, useRef, useState } from 'react';
import { saveMediaBlob } from '../lib/db';
import { useStudioStore } from '../lib/store';
import { makeNewSurface } from '../lib/surfaceFactory';
import type { Surface } from '../lib/schema';
import {
  DEPTH_ESTIMATE_LABEL,
  DEPTH_PRESETS,
  DEFAULT_DEPTH_PARAMS,
  coerceDepthParams,
  depthMapToBlob,
  drawDepthVisual,
  estimateDepthMap,
  type DepthParams,
  type DepthPresetId,
} from '../lib/depth';
import { Button } from './ui/button';
import { Select } from './ui/select';

function loadImageFile(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

export default function DepthMode() {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoImg, setPhotoImg] = useState<HTMLImageElement | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [depthSource, setDepthSource] = useState<'estimated' | 'manual'>('estimated');
  const [depthCanvas, setDepthCanvas] = useState<HTMLCanvasElement | null>(null);
  const [manualDepthImg, setManualDepthImg] = useState<HTMLImageElement | null>(null);
  const [manualDepthFile, setManualDepthFile] = useState<File | null>(null);
  const [params, setParams] = useState<DepthParams>(DEFAULT_DEPTH_PARAMS);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const parallaxRef = useRef({ x: 0, y: 0 });
  const depthCanvasRef = useRef<HTMLCanvasElement | null>(null);
  depthCanvasRef.current = depthCanvas;
  const photoMediaIdRef = useRef<string | null>(null);

  const selectedSurfaceId = useStudioStore((s) => s.selectedSurfaceId);
  const selectedSurface = useStudioStore((s) => s.project?.surfaces.find((x) => x.id === s.selectedSurfaceId) ?? null);

  // Estimate the depth map whenever the photo changes.
  useEffect(() => {
    if (!photoImg) {
      setDepthCanvas(null);
      return;
    }
    try {
      setDepthCanvas(estimateDepthMap(photoImg));
    } catch {
      setDepthCanvas(null);
    }
  }, [photoImg]);

  // Real-time preview loop (mouse parallax via parallaxRef).
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let running = true;
    const draw = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(draw);
      const p = paramsRef.current;
      const depth = depthSource === 'manual' ? manualDepthImg : depthCanvasRef.current;
      drawDepthVisual(ctx, canvas.width, canvas.height, now / 1000, {
        photo: photoImg,
        depth,
        params: { ...p, parallaxX: parallaxRef.current.x, parallaxY: parallaxRef.current.y },
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [photoImg, manualDepthImg, depthSource]);

  const onPhotoFile = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    setAssignMsg(null);
    photoMediaIdRef.current = null;
    try {
      const { img, url } = await loadImageFile(file);
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      setPhotoFile(file);
      setPhotoImg(img);
      setPhotoUrl(url);
      setDepthSource('estimated');
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not read that file.');
    }
  };

  const onManualDepthFile = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    try {
      const { img } = await loadImageFile(file);
      setManualDepthFile(file);
      setManualDepthImg(img);
      setDepthSource('manual');
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not read that file.');
    }
  };

  const onPreviewMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    parallaxRef.current = {
      x: Math.min(1, Math.max(-1, ((e.clientX - rect.left) / rect.width - 0.5) * 2)),
      y: Math.min(1, Math.max(-1, ((e.clientY - rect.top) / rect.height - 0.5) * 2)),
    };
  };

  const onPreviewClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setParams((p) => ({
      ...p,
      focusX: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      focusY: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }));
  };

  const assignToSurface = async () => {
    if (!photoImg || !photoFile) return;
    setSaving(true);
    setAssignMsg(null);
    try {
      let photoMediaId = photoMediaIdRef.current;
      if (!photoMediaId) {
        const rec = await saveMediaBlob(photoFile, photoFile.name);
        photoMediaId = rec?.id ?? null;
      }
      if (!photoMediaId) throw new Error('The photo could not be saved to the media library.');
      let depthMapId: string | null = null;
      if (depthSource === 'manual' && manualDepthFile) {
        const rec = await saveMediaBlob(manualDepthFile, manualDepthFile.name);
        depthMapId = rec?.id ?? null;
      } else if (depthCanvas) {
        const blob = await depthMapToBlob(depthCanvas);
        if (blob) {
          const rec = await saveMediaBlob(blob, `${photoFile.name.replace(/\.[^.]+$/, '')}-depth-map.png`);
          depthMapId = rec?.id ?? null;
        }
      }
      const p = coerceDepthParams(params);
      const content = {
        kind: 'depth',
        mediaId: photoMediaId,
        ...(depthMapId ? { depthMapId } : {}),
        params: {
          preset: p.preset,
          intensity: p.intensity,
          displacement: p.displacement,
          focusX: p.focusX,
          focusY: p.focusY,
          color1: p.color1,
          color2: p.color2,
        },
      } as unknown as Surface['content'];
      const store = useStudioStore.getState();
      if (selectedSurfaceId) {
        store.updateSurface(selectedSurfaceId, { content });
        setAssignMsg(`Depth visual assigned to “${selectedSurface?.name ?? 'selected surface'}”.`);
      } else {
        const surface = makeNewSurface('rect', { name: 'Depth', content });
        store.addSurface(surface);
        setAssignMsg('Depth visual added as a new surface (“Depth”). Select a surface first to replace its content instead.');
      }
    } catch (err) {
      setAssignMsg(err instanceof Error ? err.message : 'Could not assign the depth visual.');
    } finally {
      setSaving(false);
    }
  };

  const setParam = <K extends keyof DepthParams>(key: K, value: DepthParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">Depth mode</h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          Upload a photo and project it through a depth map. The map is estimated in-browser
          from the photo — <span className="text-amber-300">{DEPTH_ESTIMATE_LABEL}</span>.
          Or import your own grayscale depth image instead.
        </p>
      </div>

      <label className="block text-xs text-zinc-400">
        <span className="mb-1 block">Photo</span>
        <input
          type="file"
          accept="image/*"
          className="w-full text-xs text-zinc-300 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-xs file:text-zinc-100"
          onChange={(e) => void onPhotoFile(e.target.files?.[0])}
        />
      </label>

      <label className="block text-xs text-zinc-400">
        <span className="mb-1 block">Manual depth map (optional — grayscale image, used instead of the estimate)</span>
        <input
          type="file"
          accept="image/*"
          disabled={!photoImg}
          className="w-full text-xs text-zinc-300 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-xs file:text-zinc-100 disabled:opacity-50"
          onChange={(e) => void onManualDepthFile(e.target.files?.[0])}
        />
      </label>

      {photoError && <p className="text-xs text-rose-300" role="alert">{photoError}</p>}

      {photoImg && (
        <>
          <div>
            <canvas
              ref={previewRef}
              width={480}
              height={270}
              className="w-full cursor-crosshair rounded border border-zinc-800 bg-black"
              onMouseMove={onPreviewMouseMove}
              onMouseLeave={() => { parallaxRef.current = { x: 0, y: 0 }; }}
              onClick={onPreviewClick}
              aria-label="Depth preview — move the mouse for parallax, click to set the focus point"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Preview — move the mouse for parallax, click to set the focus point.
              {depthSource === 'estimated' ? ` ${DEPTH_ESTIMATE_LABEL}.` : ' Using your imported depth map.'}
            </p>
          </div>

          {depthSource === 'estimated' && depthCanvas && (
            <div>
              <p className="mb-1 text-xs text-zinc-400">Estimated depth map</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={depthCanvas.toDataURL()} alt="Estimated depth map (grayscale)" className="w-40 rounded border border-zinc-800" />
              <p className="mt-1 text-[11px] text-zinc-500">{DEPTH_ESTIMATE_LABEL}.</p>
            </div>
          )}

          <div className="space-y-3">
            <label className="block text-xs text-zinc-400">
              <span className="mb-1 block">Preset</span>
              <Select
                value={params.preset}
                onChange={(e) => setParam('preset', e.target.value as DepthPresetId)}
                options={DEPTH_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                aria-label="Depth preset"
              />
              <span className="mt-1 block text-[11px] text-zinc-500">
                {DEPTH_PRESETS.find((p) => p.id === params.preset)?.blurb}
              </span>
            </label>

            <label className="block text-xs text-zinc-400">
              <span className="mb-1 flex justify-between"><span>Depth intensity</span><span className="text-zinc-300">{params.intensity.toFixed(2)}</span></span>
              <input type="range" min={0} max={2} step={0.05} value={params.intensity} onChange={(e) => setParam('intensity', Number(e.target.value))} className="w-full accent-amber-500" aria-label="Depth intensity" />
            </label>

            <label className="block text-xs text-zinc-400">
              <span className="mb-1 flex justify-between"><span>Displacement (px)</span><span className="text-zinc-300">{Math.round(params.displacement)}</span></span>
              <input type="range" min={0} max={60} step={1} value={params.displacement} onChange={(e) => setParam('displacement', Number(e.target.value))} className="w-full accent-amber-500" aria-label="Displacement amount" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-zinc-400">
                <span className="mb-1 flex justify-between"><span>Focus X</span><span className="text-zinc-300">{params.focusX.toFixed(2)}</span></span>
                <input type="range" min={0} max={1} step={0.01} value={params.focusX} onChange={(e) => setParam('focusX', Number(e.target.value))} className="w-full accent-amber-500" aria-label="Focus point X" />
              </label>
              <label className="block text-xs text-zinc-400">
                <span className="mb-1 flex justify-between"><span>Focus Y</span><span className="text-zinc-300">{params.focusY.toFixed(2)}</span></span>
                <input type="range" min={0} max={1} step={0.01} value={params.focusY} onChange={(e) => setParam('focusY', Number(e.target.value))} className="w-full accent-amber-500" aria-label="Focus point Y" />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-zinc-400">
                <span className="mb-1 block">Colour 1</span>
                <input type="color" value={params.color1} onChange={(e) => setParam('color1', e.target.value)} className="h-8 w-full rounded border border-zinc-700 bg-zinc-900" aria-label="Depth colour 1" />
              </label>
              <label className="block text-xs text-zinc-400">
                <span className="mb-1 block">Colour 2</span>
                <input type="color" value={params.color2} onChange={(e) => setParam('color2', e.target.value)} className="h-8 w-full rounded border border-zinc-700 bg-zinc-900" aria-label="Depth colour 2" />
              </label>
            </div>
          </div>

          <div>
            <Button onClick={() => void assignToSurface()} disabled={saving} className="w-full">
              {saving ? 'Saving…' : selectedSurfaceId ? `Assign to “${selectedSurface?.name ?? 'selected surface'}”` : 'Add as new surface'}
            </Button>
            <p className="mt-1 text-[11px] text-zinc-500">
              Assigning saves the photo{depthSource === 'estimated' ? ' and the estimated depth map' : ' and your depth map'} to the media library.
              {selectedSurfaceId ? '' : ' No surface is selected, so a new one is created.'}
            </p>
            {assignMsg && <p className="mt-2 text-xs text-emerald-300" role="status">{assignMsg}</p>}
          </div>
        </>
      )}

      {!photoImg && (
        <p className="text-xs text-zinc-500">No photo yet — upload one to see the estimated depth map and presets.</p>
      )}
    </div>
  );
}
