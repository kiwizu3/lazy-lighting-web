// Media helpers (Phase 3) — all client-side, no server involved.
// Media blobs live in IndexedDB via src/lib/db.ts (do not modify it);
// this file only validates, classifies and previews files before they
// are stored there.
//
// Storage trade-off (see MediaLibrary): images are stored as Blob records
// in IndexedDB and surfaced to the engine as object URLs / data URLs.
// Small images (<= IMAGE_DATA_URL_MAX_BYTES) are embedded as data URLs on
// the surface so they survive a reload; larger ones use a session-only
// blob: object URL and must be re-picked after reopening the project.
// Phase 5 should add an engine-side media resolver (load the blob from
// IndexedDB by mediaId) so no embedding is needed at all.
import { getMediaBlob, saveMediaBlob, type MediaRecord } from './db';

export type MediaKind = 'image' | 'video' | 'audio' | 'draw';

export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
/** Images at or below this size are embedded as data URLs on surfaces. */
export const IMAGE_DATA_URL_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export const SUPPORTED_TYPES: Record<string, MediaKind> = {
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video', // .mov
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'image',
  'audio/mpeg': 'audio', // .mp3
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/ogg': 'audio',
  'audio/webm': 'audio',
};

const EXTENSION_KIND: Record<string, MediaKind> = {
  mp4: 'video', webm: 'video', mov: 'video',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', svg: 'image',
  mp3: 'audio', wav: 'audio', ogg: 'audio',
};

export const DRAWING_MIME = 'application/json';
export const DRAWING_NAME_SUFFIX = '.drawing.json';

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Classify a file by MIME type, falling back to its extension. */
export function mediaKind(file: File | { type: string; name: string }): MediaKind | null {
  const byMime = SUPPORTED_TYPES[file.type.toLowerCase()];
  if (byMime) return byMime;
  if (file.type === DRAWING_MIME && file.name.endsWith(DRAWING_NAME_SUFFIX)) return 'draw';
  return EXTENSION_KIND[fileExtension(file.name)] ?? null;
}

export type ValidateResult =
  | { ok: true; kind: MediaKind }
  | { ok: false; reason: string; code: 'unsupported-type' | 'too-large' };

export function validateFile(file: File): ValidateResult {
  const kind = mediaKind(file);
  if (!kind) {
    const ext = fileExtension(file.name);
    return {
      ok: false,
      code: 'unsupported-type',
      reason: `“${file.name}” is not a supported file. Supported: video MP4 / WebM / MOV, images JPG / PNG / WebP / GIF / SVG, audio MP3 / WAV / OGG${ext ? ` — “.${ext}” is not one of those` : ''}.`,
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      ok: false,
      code: 'too-large',
      reason: `“${file.name}” is ${formatBytes(file.size)} — files over ${formatBytes(MAX_FILE_SIZE)} are not accepted.`,
    };
  }
  return { ok: true, kind };
}

export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function fileToObjectUrl(file: File | Blob): string {
  return URL.createObjectURL(file);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, '0')}`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Procedural waveform-ish placeholder for audio thumbnails (no real audio data). */
export function audioPlaceholderDataUrl(name: string, width = 320, height = 180): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, width, height);
  let seed = hashString(name) || 1;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  ctx.fillStyle = '#f59e0b';
  const bars = 48;
  const bw = width / bars;
  for (let i = 0; i < bars; i++) {
    const h = 8 + rand() * (height - 32);
    ctx.globalAlpha = 0.45 + rand() * 0.5;
    ctx.fillRect(i * bw + 1, (height - h) / 2, bw - 2, h);
  }
  ctx.globalAlpha = 1;
  return canvas.toDataURL('image/png');
}

function drawImageToThumbnail(img: HTMLImageElement | HTMLVideoElement, width = 320): string {
  const w = 'videoWidth' in img ? img.videoWidth : img.naturalWidth;
  const h = 'videoHeight' in img ? img.videoHeight : img.naturalHeight;
  if (!w || !h) return '';
  const scale = Math.min(1, width / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/**
 * Thumbnail data URL for a file.
 * video: first seekable frame drawn to canvas; image: downscaled to 320px;
 * audio: procedural waveform placeholder (returns a data URL, never null —
 * the `null` case is only for a video whose first frame cannot be decoded).
 * Returns null when no thumbnail could be produced.
 */
export async function generateThumbnail(file: File | Blob, name = 'media'): Promise<string | null> {
  const kind = mediaKind({ type: file.type, name });
  if (kind === 'audio') return audioPlaceholderDataUrl(name);
  if (kind === 'image') {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image could not be decoded for a thumbnail'));
        img.src = url;
      });
      return drawImageToThumbnail(img) || null;
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (kind === 'video') {
    const url = URL.createObjectURL(file);
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Video thumbnail timed out')), 8000);
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve();
        };
        video.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Video could not be decoded for a thumbnail'));
        };
      });
      const target = Number.isFinite(video.duration) && video.duration > 0.2 ? 0.1 : 0;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Video seek timed out')), 8000);
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
        video.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Video seek failed'));
        };
        try {
          video.currentTime = target;
        } catch (err) {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error('Video seek failed'));
        }
      });
      return drawImageToThumbnail(video) || null;
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return null;
}

/** Duration in seconds for a video/audio blob, or null if it cannot be read. */
export async function probeDuration(file: File | Blob): Promise<number | null> {
  const kind = mediaKind({ type: file.type, name: (file as File).name ?? '' });
  if (kind !== 'video' && kind !== 'audio') return null;
  const url = URL.createObjectURL(file);
  try {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';
    el.src = url;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('metadata timeout')), 8000);
      el.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      el.onerror = () => {
        clearTimeout(timer);
        reject(new Error('metadata failed'));
      };
    });
    return Number.isFinite(el.duration) ? el.duration : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function isDrawingRecord(meta: { name: string; type: string }): boolean {
  return meta.type === DRAWING_MIME && meta.name.endsWith(DRAWING_NAME_SUFFIX);
}

export async function getMediaObjectUrl(id: string): Promise<string | null> {
  const rec = await getMediaBlob(id);
  if (!rec) return null;
  return URL.createObjectURL(rec.blob);
}

export type { MediaRecord };
export { saveMediaBlob };
