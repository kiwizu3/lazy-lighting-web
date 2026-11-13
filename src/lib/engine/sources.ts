// Content sources -> three.js textures, one per surface.
// Visuals reuse the v1 Canvas 2D generators from src/lib/visuals.ts (drawn
// onto an offscreen canvas, uploaded as a CanvasTexture). Shader visuals
// (src/lib/shaders.ts) render through the shared offscreen ShaderStageRenderer
// into the same content canvas. Image / video blobs are resolved from
// IndexedDB by mediaId (no data-URL embedding needed); imageDataUrl /
// videoObjectUrl still work as fallbacks. Effects run on the content canvas
// via applyEffects() before the texture upload (video/camera go through a
// canvas too when effects are enabled, so effects apply there as well).
import * as THREE from 'three';
import type { Surface } from '../schema';
import { getVisual } from '../visuals';
import { defaultBlobPoints } from '../warp';
import { getCameraStream } from './cameraBus';
import { getMediaBlob } from '../db';
import { getShaderVisual, type ShaderParams } from '../shaders';
import { ShaderStageRenderer } from './shaderStage';
import { applyEffects, type EffectInstance } from '../effectPipeline';
import { coerceDepthParams, drawDepthVisual, estimateDepthMap } from '../depth';
import type { SurfaceRenderCtx } from './liveMod';

const VISUAL_W = 480;
const VISUAL_H = 270;

type ContentExtra = {
  colors?: [string, string];
  params?: Partial<ShaderParams>;
  strokes?: { points: { x: number; y: number }[]; color: string; size: number; opacity?: number; text?: string }[];
  animateWobble?: boolean;
  text?: string;
  imageDataUrl?: string;
  videoObjectUrl?: string;
  loop?: boolean;
  playbackRate?: number;
  fit?: 'cover' | 'contain' | 'fill';
  /** Grayscale depth map media id (estimated or user-imported). */
  depthMapId?: string;
};

function extra(surface: Surface): ContentExtra {
  return (surface.content ?? {}) as unknown as ContentExtra;
}

function makePlaceholderTexture(label: string, sub?: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = VISUAL_W;
  canvas.height = VISUAL_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, VISUAL_W, VISUAL_H);
  ctx.fillStyle = '#9ca3af';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, VISUAL_W / 2, VISUAL_H / 2 - 10);
  if (sub) {
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText(sub, VISUAL_W / 2, VISUAL_H / 2 + 16);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawTextOverlay(ctx: CanvasRenderingContext2D, surface: Surface): void {
  const txt = extra(surface).text ?? surface.name;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.font = `bold ${Math.floor(h * 0.42)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(txt, w / 2, h / 2);
  ctx.fillStyle = '#fff';
  ctx.fillText(txt, w / 2, h / 2);
}

/** Clip the content canvas to the silhouette polygon (local vertices). */
function clipToSilhouette(ctx: CanvasRenderingContext2D, surface: Surface): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const pts = surface.vertices && surface.vertices.length >= 3 ? surface.vertices : defaultBlobPoints();
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = p.x * w;
    const y = p.y * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
}

interface CachedSource {
  sig: string;
  texture: THREE.Texture;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  finalCanvas: HTMLCanvasElement | null;
  video: HTMLVideoElement | null;
  image: HTMLImageElement | null;
  imageFailed: boolean;
  /** Estimated depth map derived from the photo (cached per entry). */
  depthCanvas: HTMLCanvasElement | null;
}

function effectsSignature(surface: Surface): string {
  return JSON.stringify(surface.effects ?? []);
}

export class SourceManager {
  private cache = new Map<string, CachedSource>();
  private cameraVideo: HTMLVideoElement | null = null;
  private cameraTexture: THREE.VideoTexture | null = null;
  private cameraPlaceholder: THREE.CanvasTexture | null = null;
  private cameraStreamSeen: MediaStream | null = null;
  private imagesByMediaId = new Map<string, HTMLImageElement>();
  private videosByMediaId = new Map<string, string>();
  private pendingMedia = new Set<string>();
  private ownedObjectUrls = new Set<string>();
  private shaderStage = new ShaderStageRenderer(VISUAL_W, VISUAL_H);

  /** Register an image element for a mediaId (Phase 3 media library hook). */
  registerImage(mediaId: string, img: HTMLImageElement): void {
    this.imagesByMediaId.set(mediaId, img);
  }

  // ---- IndexedDB media resolver (Phase 5) ----
  // Loads a blob by mediaId, caches an object URL, and assigns the decoded
  // image / video to every cached surface entry waiting on that mediaId.
  // No data-URL embedding is needed: surfaces render after reload from
  // IndexedDB alone.

  private resolveImageMedia(mediaId: string): void {
    if (this.imagesByMediaId.has(mediaId) || this.pendingMedia.has(`img:${mediaId}`)) return;
    this.pendingMedia.add(`img:${mediaId}`);
    void getMediaBlob(mediaId).then((rec) => {
      this.pendingMedia.delete(`img:${mediaId}`);
      if (!rec) return;
      const url = URL.createObjectURL(rec.blob);
      this.ownedObjectUrls.add(url);
      const img = new Image();
      img.onload = () => {
        this.imagesByMediaId.set(mediaId, img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        this.ownedObjectUrls.delete(url);
      };
      img.src = url;
    });
  }

  private resolveVideoMedia(mediaId: string): string | null {
    const cached = this.videosByMediaId.get(mediaId);
    if (cached) return cached;
    if (this.pendingMedia.has(`vid:${mediaId}`)) return null;
    this.pendingMedia.add(`vid:${mediaId}`);
    void getMediaBlob(mediaId).then((rec) => {
      this.pendingMedia.delete(`vid:${mediaId}`);
      if (!rec) return;
      const url = URL.createObjectURL(rec.blob);
      this.ownedObjectUrls.add(url);
      this.videosByMediaId.set(mediaId, url);
      // The next frame's signature flips from resolved:no to resolved:yes,
      // so getOrCreate rebuilds the entry with the real video.
    });
    return null;
  }

  private signature(surface: Surface): string {
    const c = surface.content ?? {};
    const e = extra(surface);
    return [
      surface.id,
      surface.shape,
      c.kind,
      (c as { visualId?: string }).visualId ?? '',
      (c as { mediaId?: string }).mediaId ?? '',
      e.text ?? '',
      e.imageDataUrl ? `img:${e.imageDataUrl.length}:${e.imageDataUrl.slice(0, 64)}` : '',
      e.videoObjectUrl ?? '',
      JSON.stringify(e.strokes ?? []),
      JSON.stringify((e as { params?: unknown }).params ?? ''),
      JSON.stringify(e.colors ?? ''),
      e.animateWobble ? 'wob' : '',
      surface.vertices ? `v${surface.vertices.length}` : '',
      e.loop !== undefined ? `loop:${e.loop}` : '',
      e.playbackRate !== undefined ? `rate:${e.playbackRate}` : '',
      e.fit ?? '',
      e.depthMapId ?? '',
      effectsSignature(surface),
      // Media-resolved URLs change the entry: include the resolved URL when known.
      (c as { mediaId?: string }).mediaId
        ? `resolved:${this.videosByMediaId.get((c as { mediaId?: string }).mediaId!) ?? this.imagesByMediaId.has((c as { mediaId?: string }).mediaId!) ? 'yes' : 'no'}`
        : '',
    ].join('|');
  }

  private hasEnabledEffects(surface: Surface): boolean {
    return (surface.effects ?? []).some((fx) => (fx as EffectInstance).enabled !== false);
  }

  private getOrCreate(surface: Surface): CachedSource {
    const sig = this.signature(surface);
    const prev = this.cache.get(surface.id);
    if (prev && prev.sig === sig) return prev;
    if (prev) this.disposeEntry(prev);
    const entry: CachedSource = { sig, texture: null as unknown as THREE.Texture, canvas: null, ctx: null, finalCanvas: null, video: null, image: null, imageFailed: false, depthCanvas: null };
    const kind = surface.content?.kind ?? 'visual';
    const e = extra(surface);
    const mediaId = (surface.content as { mediaId?: string }).mediaId;

    if (kind === 'video') {
      // Stored loop / playbackRate are honoured (not hardcoded). Muted stays
      // on: browsers block autoplay with sound, and projection video is
      // visual-only by design.
      const url = e.videoObjectUrl ?? (mediaId ? this.videosByMediaId.get(mediaId) ?? this.resolveVideoMedia(mediaId) : null);
      const useCanvas = this.hasEnabledEffects(surface);
      if (url) {
        const video = document.createElement('video');
        video.src = url;
        video.loop = e.loop ?? true;
        video.playbackRate = e.playbackRate ?? 1;
        video.muted = true;
        video.playsInline = true;
        void video.play().catch(() => undefined);
        entry.video = video;
        if (useCanvas) {
          const canvas = document.createElement('canvas');
          canvas.width = VISUAL_W;
          canvas.height = VISUAL_H;
          entry.canvas = canvas;
          entry.ctx = canvas.getContext('2d');
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          entry.texture = tex;
        } else {
          const tex = new THREE.VideoTexture(video);
          tex.colorSpace = THREE.SRGBColorSpace;
          entry.texture = tex;
        }
      } else {
        entry.texture = makePlaceholderTexture('Video — loading…', mediaId ? 'Resolving from media library' : 'Pick a file');
        if (mediaId) this.resolveVideoMedia(mediaId);
      }
    } else if (kind === 'camera') {
      if (this.hasEnabledEffects(surface)) {
        const canvas = document.createElement('canvas');
        canvas.width = VISUAL_W;
        canvas.height = VISUAL_H;
        entry.canvas = canvas;
        entry.ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        entry.texture = tex;
      } else {
        entry.texture = this.cameraTextureFor();
      }
    } else {
      // visual / image / draw / depth: drawn onto a canvas each frame.
      const canvas = document.createElement('canvas');
      canvas.width = VISUAL_W;
      canvas.height = VISUAL_H;
      entry.canvas = canvas;
      entry.ctx = canvas.getContext('2d');
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      entry.texture = tex;
      if (kind === 'image' || kind === 'depth') {
        if (e.imageDataUrl) {
          const image = new Image();
          image.onload = () => {
            entry.image = image;
          };
          image.onerror = () => {
            entry.imageFailed = true;
          };
          image.src = e.imageDataUrl;
          entry.image = image;
        } else if (mediaId) {
          const img = this.imagesByMediaId.get(mediaId) ?? null;
          if (img) entry.image = img;
          else this.resolveImageMedia(mediaId);
        }
        // Depth surfaces may carry a second image: the depth map itself.
        if (kind === 'depth' && e.depthMapId) this.resolveImageMedia(e.depthMapId);
      }
    }
    this.cache.set(surface.id, entry);
    return entry;
  }

  private cameraTextureFor(): THREE.Texture {
    const stream = getCameraStream();
    if (stream) {
      if (!this.cameraVideo || this.cameraStreamSeen !== stream) {
        if (this.cameraVideo) {
          this.cameraVideo.srcObject = null;
        } else {
          this.cameraVideo = document.createElement('video');
          this.cameraVideo.muted = true;
          this.cameraVideo.playsInline = true;
        }
        this.cameraVideo.srcObject = stream;
        void this.cameraVideo.play().catch(() => undefined);
        this.cameraStreamSeen = stream;
        if (this.cameraTexture) this.cameraTexture.dispose();
        this.cameraTexture = new THREE.VideoTexture(this.cameraVideo);
        this.cameraTexture.colorSpace = THREE.SRGBColorSpace;
      }
      return this.cameraTexture as THREE.Texture;
    }
    if (!this.cameraPlaceholder) {
      this.cameraPlaceholder = makePlaceholderTexture('Camera not started', 'Enable camera in Properties');
    }
    return this.cameraPlaceholder;
  }

  private getCameraVideo(): HTMLVideoElement | null {
    // Ensure the camera texture (and its video element) exists.
    this.cameraTextureFor();
    return this.cameraVideo;
  }

  /** Draw an image into ctx honouring the surface's fit mode. */
  private drawImageFitted(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | HTMLVideoElement,
    w: number,
    h: number,
    fit: 'cover' | 'contain' | 'fill',
    iw: number,
    ih: number,
  ): void {
    if (fit === 'fill') {
      ctx.drawImage(img, 0, 0, w, h);
      return;
    }
    const scale = fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  /** Texture for a surface at time t (seconds). Redraws canvas sources. */
  getTexture(surface: Surface, time: number, renderCtx?: SurfaceRenderCtx): THREE.Texture | null {
    const entry = this.getOrCreate(surface);
    const kind = surface.content?.kind ?? 'visual';
    const ctx = renderCtx;
    const audioLevel = ctx?.audioLevel ?? 0;
    const timeScale = ctx?.speed ?? 1;
    const t = time * timeScale;

    if (kind === 'camera' && !entry.canvas) {
      // Stream may have started since this entry was created.
      const fresh = this.cameraTextureFor();
      if (fresh !== entry.texture) {
        entry.texture = fresh;
      }
      return entry.texture;
    }
    if (kind === 'video' && !entry.canvas) {
      // Keep stored playbackRate in sync if it changed without a rebuild.
      const rate = extra(surface).playbackRate ?? 1;
      if (entry.video && entry.video.playbackRate !== rate) entry.video.playbackRate = rate;
      return entry.texture;
    }
    if (!entry.canvas || !entry.ctx) return entry.texture;
    const c2d = entry.ctx;
    const w = VISUAL_W;
    const h = VISUAL_H;
    const e = extra(surface);
    c2d.save();
    c2d.clearRect(0, 0, w, h);
    if (surface.shape === 'silhouette') clipToSilhouette(c2d, surface);
    if (kind === 'image') {
      const mediaId = (surface.content as { mediaId?: string }).mediaId;
      const img = entry.image ?? (mediaId ? this.imagesByMediaId.get(mediaId) ?? null : null);
      if (img) entry.image = img;
      if (img && img.complete && img.naturalWidth > 0) {
        this.drawImageFitted(c2d, img, w, h, e.fit ?? 'cover', img.naturalWidth, img.naturalHeight);
      } else {
        if (mediaId) this.resolveImageMedia(mediaId);
        c2d.fillStyle = '#1f2937';
        c2d.fillRect(0, 0, w, h);
        c2d.fillStyle = '#9ca3af';
        c2d.font = '20px sans-serif';
        c2d.textAlign = 'center';
        c2d.fillText(entry.imageFailed ? 'Image failed to load' : 'Image — loading…', w / 2, h / 2);
      }
    } else if (kind === 'video') {
      const video = entry.video;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        this.drawImageFitted(c2d, video, w, h, e.fit ?? 'cover', video.videoWidth, video.videoHeight);
      } else {
        c2d.fillStyle = '#1f2937';
        c2d.fillRect(0, 0, w, h);
        c2d.fillStyle = '#9ca3af';
        c2d.font = '20px sans-serif';
        c2d.textAlign = 'center';
        c2d.fillText('Video — loading…', w / 2, h / 2);
      }
    } else if (kind === 'camera') {
      const video = this.getCameraVideo();
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        this.drawImageFitted(c2d, video, w, h, 'cover', video.videoWidth, video.videoHeight);
      } else {
        c2d.fillStyle = '#1f2937';
        c2d.fillRect(0, 0, w, h);
        c2d.fillStyle = '#9ca3af';
        c2d.font = '20px sans-serif';
        c2d.textAlign = 'center';
        c2d.fillText('Camera — loading…', w / 2, h / 2);
      }
    } else if (kind === 'draw') {
      c2d.fillStyle = '#0f172a';
      c2d.fillRect(0, 0, w, h);
      for (const st of e.strokes ?? []) {
        c2d.save();
        c2d.globalAlpha = st.opacity ?? 1;
        c2d.strokeStyle = st.color;
        c2d.fillStyle = st.color;
        c2d.lineWidth = st.size;
        c2d.lineCap = 'round';
        c2d.lineJoin = 'round';
        const wob = e.animateWobble ? Math.sin(t * 3) * 3 : 0;
        if (st.text) {
          // Text stroke: rendered at its anchor point.
          const anchor = st.points[0];
          if (anchor) {
            c2d.font = `${Math.max(12, st.size * 2)}px sans-serif`;
            c2d.textBaseline = 'top';
            c2d.fillText(st.text, anchor.x * w + wob, anchor.y * h);
          }
          c2d.restore();
          continue;
        }
        if (st.points.length === 1) {
          const p = st.points[0];
          c2d.beginPath();
          c2d.arc(p.x * w + wob, p.y * h, Math.max(1, st.size / 2), 0, Math.PI * 2);
          c2d.fill();
          c2d.restore();
          continue;
        }
        if (st.points.length < 2) {
          c2d.restore();
          continue;
        }
        c2d.beginPath();
        st.points.forEach((p, i) => {
          const x = p.x * w + wob * Math.sin(p.y * 9 + t * 2);
          const y = p.y * h;
          if (i === 0) c2d.moveTo(x, y);
          else c2d.lineTo(x, y);
        });
        c2d.stroke();
        c2d.restore();
      }
      if ((e.strokes ?? []).length === 0) {
        c2d.fillStyle = '#64748b';
        c2d.font = '18px sans-serif';
        c2d.textAlign = 'center';
        c2d.fillText('Draw on this surface (Draw tab)', w / 2, h / 2);
      }
    } else if (kind === 'depth') {
      // Depth visual (Phase 6): the photo + a depth map (user-imported, or
      // estimated from the photo's brightness — see src/lib/depth.ts)
      // drive one of the depth presets. Without either image, fall back
      // to the aurora visual so the surface is never blank.
      const mediaId = (surface.content as { mediaId?: string }).mediaId;
      const photo =
        (entry.image && entry.image.complete && entry.image.naturalWidth > 0 ? entry.image : null) ??
        (mediaId ? this.imagesByMediaId.get(mediaId) ?? null : null);
      if (photo && entry.image !== photo) entry.image = photo;
      const depthMapId = e.depthMapId;
      let depthMap: HTMLImageElement | HTMLCanvasElement | null = null;
      if (depthMapId) {
        const dm = this.imagesByMediaId.get(depthMapId) ?? null;
        if (dm && dm.complete && dm.naturalWidth > 0) depthMap = dm;
        else this.resolveImageMedia(depthMapId);
      }
      if (!depthMap && photo && photo.complete && photo.naturalWidth > 0) {
        // No explicit depth map: estimate one from the photo, once.
        if (!entry.depthCanvas) {
          try {
            entry.depthCanvas = estimateDepthMap(photo);
          } catch { /* estimation failed — presets fall back to the photo */ }
        }
        depthMap = entry.depthCanvas;
      }
      if (photo || depthMap) {
        const params = coerceDepthParams(e.params);
        drawDepthVisual(c2d, w, h, t, { photo, depth: depthMap, params });
      } else {
        getVisual((surface.content as { visualId?: string }).visualId ?? 'aurora').draw(c2d, w, h, t, {
          audioLevel,
          hueShift: 0,
          speed: timeScale,
          colors: e.colors ?? ['#f59e0b', '#06b6d4'],
        });
      }
    } else {
      // visual (default): shader visuals render via the shared GLSL stage,
      // classic visuals via the v1 canvas generators.
      const visualId = (surface.content as { visualId?: string }).visualId ?? 'aurora';
      const shader = getShaderVisual(visualId);
      if (shader && this.shaderStage.available) {
        const base = shader.defaults;
        const params: ShaderParams = {
          ...base,
          ...(e.params ?? {}),
          color1: e.colors?.[0] ?? e.params?.color1 ?? base.color1,
          color2: e.colors?.[1] ?? e.params?.color2 ?? base.color2,
          density: (e.params?.density ?? base.density) * (ctx?.density ?? 1),
          ...(ctx?.shaderParams ?? {}),
        };
        const out = this.shaderStage.render(visualId, params, t, audioLevel);
        if (out) {
          c2d.drawImage(out, 0, 0, w, h);
        } else {
          getVisual('aurora').draw(c2d, w, h, t, { audioLevel, hueShift: 0, speed: timeScale, colors: e.colors ?? ['#f59e0b', '#06b6d4'] });
        }
      } else {
        getVisual(visualId).draw(c2d, w, h, t, {
          audioLevel,
          hueShift: 0,
          speed: timeScale,
          colors: e.colors ?? ['#f59e0b', '#06b6d4'],
        });
      }
    }
    if (surface.shape === 'text') drawTextOverlay(c2d, surface);
    c2d.restore();

    // ---- effects + live-modulation blit ----
    const effects = (surface.effects ?? []) as EffectInstance[];
    const enabledEffects = effects.filter((fx) => fx.enabled !== false);
    const scale = ctx?.scale ?? 1;
    const brightness = ctx?.brightness ?? 1;
    const hue = ctx?.hue ?? 0;
    const needsFinal =
      enabledEffects.length > 0 || Math.abs(scale - 1) > 0.001 || Math.abs(brightness - 1) > 0.001 || Math.abs(hue) > 0.01;
    if (needsFinal) {
      let src: HTMLCanvasElement = entry.canvas;
      if (enabledEffects.length > 0) {
        const intensity = ctx?.effectIntensity ?? 1;
        const scaled = intensity === 1 ? enabledEffects : enabledEffects.map((fx) => ({ ...fx, intensity: (fx.intensity ?? 1) * intensity }));
        src = applyEffects(src, scaled, t, audioLevel);
      }
      if (!entry.finalCanvas) {
        entry.finalCanvas = document.createElement('canvas');
      }
      const final = entry.finalCanvas;
      final.width = src.width;
      final.height = src.height;
      const fctx = final.getContext('2d');
      if (fctx) {
        fctx.save();
        fctx.clearRect(0, 0, final.width, final.height);
        const filters: string[] = [];
        if (Math.abs(brightness - 1) > 0.001) filters.push(`brightness(${brightness.toFixed(3)})`);
        if (Math.abs(hue) > 0.01) filters.push(`hue-rotate(${hue.toFixed(1)}deg)`);
        if (filters.length > 0) {
          try {
            fctx.filter = filters.join(' ');
          } catch { /* filter unsupported — draw unfiltered */ }
        }
        if (Math.abs(scale - 1) > 0.001) {
          fctx.translate(final.width / 2, final.height / 2);
          fctx.scale(scale, scale);
          fctx.translate(-final.width / 2, -final.height / 2);
        }
        fctx.drawImage(src, 0, 0, final.width, final.height);
        fctx.restore();
      }
      const tex = entry.texture as THREE.CanvasTexture;
      if (tex.image !== final) tex.image = final;
      tex.needsUpdate = true;
      return tex;
    }
    const tex = entry.texture as THREE.CanvasTexture;
    if (tex.image !== entry.canvas) tex.image = entry.canvas;
    tex.needsUpdate = true;
    return tex;
  }

  /** Drop cached textures for surfaces no longer in the project. */
  prune(activeIds: Set<string>): void {
    for (const [id, entry] of [...this.cache.entries()]) {
      if (!activeIds.has(id)) {
        this.disposeEntry(entry);
        this.cache.delete(id);
      }
    }
  }

  /** Force every cached texture to be rebuilt (e.g. after context restore). */
  invalidateAll(): void {
    for (const entry of this.cache.values()) this.disposeEntry(entry);
    this.cache.clear();
    if (this.cameraTexture) {
      this.cameraTexture.dispose();
      this.cameraTexture = null;
    }
    this.cameraStreamSeen = null;
    if (this.cameraPlaceholder) {
      this.cameraPlaceholder.dispose();
      this.cameraPlaceholder = null;
    }
  }

  private disposeEntry(entry: CachedSource): void {
    if (entry.video) {
      entry.video.pause();
      entry.video.removeAttribute('src');
      entry.video.load();
    }
    entry.texture?.dispose();
  }

  dispose(): void {
    for (const entry of this.cache.values()) this.disposeEntry(entry);
    this.cache.clear();
    if (this.cameraVideo) {
      this.cameraVideo.srcObject = null;
      this.cameraVideo = null;
    }
    this.cameraTexture?.dispose();
    this.cameraTexture = null;
    this.cameraPlaceholder?.dispose();
    this.cameraPlaceholder = null;
    this.shaderStage.dispose();
    for (const url of this.ownedObjectUrls) URL.revokeObjectURL(url);
    this.ownedObjectUrls.clear();
    this.imagesByMediaId.clear();
    this.videosByMediaId.clear();
  }
}
