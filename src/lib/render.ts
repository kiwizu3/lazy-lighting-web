// Shared stage renderer — used by the Studio and by /output.
import type { Surface } from './types';
import { getVisual } from './visuals';
import { clipShapePath, drawWarped } from './warp';

export interface MediaMap {
  images: Map<string, HTMLImageElement>;
  videos: Map<string, HTMLVideoElement>;
  camera: HTMLVideoElement | null;
}
export interface RenderOpts {
  t: number; audioLevel: number; hueShift: number;
  mouseX: number; mouseY: number; // -0.5..0.5 parallax
  crossfade?: { prev: Surface[]; progress: number } | null; // 0..1
}

const canvasCache = new Map<string, HTMLCanvasElement>();
function getCanvas(key: string, w: number, h: number): HTMLCanvasElement {
  let c = canvasCache.get(key);
  if (!c) { c = document.createElement('canvas'); canvasCache.set(key, c); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

export function filterString(s: Surface, t: number): string {
  const e = (s as unknown as { effects?: import('./types').Effects }).effects;
  if (!e) return 'none';
  const hue = e.hue + (e.colorCycle > 0 ? (t * 40 * e.colorCycle) % 360 : 0);
  const parts = [
    e.blur ? `blur(${e.blur}px)` : '',
    `brightness(${e.brightness}%)`, `contrast(${e.contrast}%)`, `saturate(${e.saturate}%)`,
    hue ? `hue-rotate(${hue}deg)` : '',
    e.invert ? `invert(${e.invert}%)` : '', e.grayscale ? `grayscale(${e.grayscale}%)` : '',
  ].filter(Boolean);
  return parts.join(' ') || 'none';
}

function drawContentInto(ctx: CanvasRenderingContext2D, w: number, h: number, s: Surface, t: number, o: RenderOpts, media: MediaMap) {
  const c = s.content;
  ctx.clearRect(0, 0, w, h);
  const visualOpts = { audioLevel: o.audioLevel, hueShift: o.hueShift, speed: 1, colors: c.colors };
  if (c.kind === 'image' || c.kind === 'depth') {
    const img = media.images.get(s.id);
    if (img && img.complete && img.naturalWidth > 0) {
      if (c.kind === 'depth') {
        // Depth Mode: layered parallax slices offset by slice depth + mouse parallax.
        const slices = 10;
        for (let i = 0; i < slices; i++) {
          const sh = h / slices;
          const depthOff = (i - slices / 2) * c.depth * 14;
          const px = depthOff * o.mouseX * 4 + Math.sin(t * 0.8 + i) * c.depth * 2;
          const py = depthOff * o.mouseY * 2;
          ctx.drawImage(img, 0, i * sh, w, sh, px, i * sh + py, w, sh);
        }
        // soft vignette to sell depth
        const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      } else {
        // cover-fit
        const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
    } else {
      ctx.fillStyle = '#1f2937'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#9ca3af'; ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(c.kind === 'depth' ? 'Depth photo — upload an image' : 'Image — upload a photo', w / 2, h / 2);
    }
  } else if (c.kind === 'video') {
    const v = media.videos.get(s.id);
    if (v && v.readyState >= 2) {
      const scale = Math.max(w / v.videoWidth, h / v.videoHeight);
      const dw = v.videoWidth * scale, dh = v.videoHeight * scale;
      ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else { ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#9ca3af'; ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Video — pick a file', w / 2, h / 2); }
  } else if (c.kind === 'camera') {
    const v = media.camera;
    if (v && v.readyState >= 2) {
      const scale = Math.max(w / v.videoWidth, h / v.videoHeight);
      const dw = v.videoWidth * scale, dh = v.videoHeight * scale;
      ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else { ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#9ca3af'; ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Camera off — enable camera', w / 2, h / 2); }
  } else if (c.kind === 'draw') {
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h);
    // draw strokes (stored normalized)
    for (const st of c.strokes) {
      if (st.points.length < 2) continue;
      ctx.strokeStyle = st.color; ctx.lineWidth = st.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const wob = c.animateWobble ? Math.sin(t * 3) * 3 : 0;
      ctx.beginPath();
      st.points.forEach((p, i) => { const x = p.x * w + wob * Math.sin(p.y * 9 + t * 2); const y = p.y * h; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.stroke();
    }
    if (c.strokes.length === 0) { ctx.fillStyle = '#64748b'; ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Draw on this surface (Draw tab)', w / 2, h / 2); }
  } else {
    getVisual(c.visualId).draw(ctx, w, h, t, visualOpts);
  }
  // Text shape: overlay big text on top of the visual
  if (s.shape === 'text') {
    const txt = c.text || s.name;
    ctx.font = `bold ${Math.floor(h * 0.42)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.strokeText(txt, w / 2, h / 2);
    ctx.fillStyle = '#fff'; ctx.fillText(txt, w / 2, h / 2);
  }
}

function renderSurfaceList(ctx: CanvasRenderingContext2D, surfaces: Surface[], t: number, o: RenderOpts, media: MediaMap, globalAlpha = 1) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const sorted = [...surfaces].filter((s) => s.visible).sort((a, b) => a.z - b.z);
  for (const s of sorted) {
    const content = getCanvas(`content-${s.id}`, 640, 360);
    const cctx = content.getContext('2d')!;
    drawContentInto(cctx, 640, 360, s, t, o, media);

    const off = getCanvas(`off-${s.id}`, 640, 360);
    const octx = off.getContext('2d')!;
    octx.clearRect(0, 0, 640, 360);
    const eff = (s as unknown as { effects?: import('./types').Effects }).effects;
    octx.save();
    octx.filter = filterString(s, t);
    // zoom / rotate / slide around centre
    const zoom = eff?.zoom ?? 1, rot = ((eff?.rotate ?? 0) * Math.PI) / 180;
    const slide = eff && eff.slideSpeed ? ((t * eff.slideSpeed * 40) % 640) : 0;
    octx.translate(320, 180); octx.rotate(rot); octx.scale(zoom, zoom); octx.translate(-320 + slide, -180);
    const tileX = eff?.tileX ?? 1, tileY = eff?.tileY ?? 1;
    if (tileX > 1 || tileY > 1) {
      for (let ty = 0; ty < tileY; ty++) for (let tx = 0; tx < tileX; tx++)
        octx.drawImage(content, (tx * 640) / tileX, (ty * 360) / tileY, 640 / tileX, 360 / tileY);
    } else if (eff && eff.kaleidoSegments > 0) {
      const segs = eff.kaleidoSegments;
      octx.translate(320, 180);
      for (let i = 0; i < segs; i++) {
        octx.save(); octx.rotate((i / segs) * Math.PI * 2);
        octx.beginPath(); octx.moveTo(0, 0); octx.arc(0, 0, 420, -Math.PI / segs, Math.PI / segs); octx.closePath(); octx.clip();
        octx.drawImage(content, -320, -180, 640, 360); octx.restore();
      }
    } else {
      octx.drawImage(content, 0, 0);
    }
    octx.restore();
    // clip to shape path
    const clipped = getCanvas(`clip-${s.id}`, 640, 360);
    const clctx = clipped.getContext('2d')!;
    clctx.clearRect(0, 0, 640, 360);
    clctx.save(); clipShapePath(clctx, s.shape, 640, 360, s.points, s.mask); clctx.drawImage(off, 0, 0); clctx.restore();

    ctx.save();
    ctx.globalAlpha = s.opacity * globalAlpha;
    if (s.shape === 'cube') {
      // front face warped + shaded top/side faces (isometric box)
      drawWarped(ctx, clipped, s.corners, W, H, s.curve);
      const [tl, tr, br, bl] = s.corners.map((p) => ({ x: p.x * W, y: p.y * H }));
      const depth = 26;
      ctx.globalAlpha = s.opacity * globalAlpha * 0.75;
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(tl.x + depth, tl.y - depth); ctx.lineTo(tr.x + depth, tr.y - depth); ctx.lineTo(tr.x, tr.y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.moveTo(tr.x, tr.y); ctx.lineTo(tr.x + depth, tr.y - depth); ctx.lineTo(br.x + depth, br.y - depth); ctx.lineTo(br.x, br.y); ctx.closePath(); ctx.fill();
    } else {
      drawWarped(ctx, clipped, s.corners, W, H, s.curve);
    }
    ctx.restore();
  }
}

export function renderStage(ctx: CanvasRenderingContext2D, surfaces: Surface[], t: number, o: RenderOpts, media: MediaMap) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (o.crossfade && o.crossfade.progress < 1) {
    renderSurfaceList(ctx, o.crossfade.prev, t, o, media, 1 - o.crossfade.progress);
    renderSurfaceList(ctx, surfaces, t, o, media, o.crossfade.progress);
  } else {
    renderSurfaceList(ctx, surfaces, t, o, media, 1);
  }
}
