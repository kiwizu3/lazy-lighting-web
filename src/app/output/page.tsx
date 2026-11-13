'use client';
import { useEffect, useRef, useState } from 'react';
import type { Surface } from '../../lib/types';
import { defaultEffects } from '../../lib/types';
import { renderStage, type MediaMap } from '../../lib/render';

/**
 * Output Window / Link receiver mode.
 * Full-screen, read-only stage. Receives project state from the Studio via
 * BroadcastChannel ('lazy-lighting-output') and localStorage
 * ('lazy-lighting-output-state'). Open it on a projector / second display
 * while the controls stay on the studio device.
 */
export default function OutputPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfacesRef = useRef<Surface[]>([]);
  const [count, setCount] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  const videosRef = useRef(new Map<string, HTMLVideoElement>());

  useEffect(() => {
    const apply = (surfaces: Surface[]) => {
      const fixed = surfaces.map((s) => ({ ...s, effects: s.effects ?? defaultEffects(), content: { ...s.content, strokes: s.content?.strokes ?? [] } }));
      surfacesRef.current = fixed;
      setCount(fixed.length);
      setUpdatedAt(new Date().toLocaleTimeString());
      for (const s of fixed) {
        if (s.content.imageDataUrl && !imagesRef.current.has(s.id)) {
          const img = new Image(); img.src = s.content.imageDataUrl; imagesRef.current.set(s.id, img);
        }
      }
    };
    try {
      const raw = localStorage.getItem('lazy-lighting-output-state');
      if (raw) apply((JSON.parse(raw) as { surfaces: Surface[] }).surfaces ?? []);
    } catch { /* no saved state yet */ }
    const bc = new BroadcastChannel('lazy-lighting-output');
    bc.onmessage = (e) => { if (e.data?.type === 'state' && Array.isArray(e.data.surfaces)) apply(e.data.surfaces); };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'lazy-lighting-output-state' && e.newValue) {
        try { apply((JSON.parse(e.newValue) as { surfaces: Surface[] }).surfaces ?? []); } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => { bc.close(); window.removeEventListener('storage', onStorage); };
  }, []);

  useEffect(() => {
    let raf = 0; const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const media: MediaMap = { images: imagesRef.current, videos: videosRef.current, camera: null };
          renderStage(ctx, surfacesRef.current, t, { t, audioLevel: 0, hueShift: 0, mouseX: 0, mouseY: 0, crossfade: null }, media);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <canvas ref={canvasRef} width={1920} height={1080} className="w-full h-auto flex-1 object-contain bg-black" />
      <div className="flex items-center justify-between px-4 py-1 text-[11px] text-zinc-600 bg-black">
        <span>💡 Lazy Lighting — Output Window · {count} surface{count === 1 ? '' : 's'}{updatedAt ? ` · synced ${updatedAt}` : ''}</span>
        <span>Unofficial web recreation — not affiliated with Audity Apps. Open the studio to control this output.</span>
      </div>
    </div>
  );
}
