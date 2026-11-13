// Video export engine — Phase 6.
// Records the REAL render loop: the visible stage canvas is driven at the
// chosen export resolution (the WebGL engine's backing store is resized to
// exactly that size, pixel ratio forced to 1) while the store playhead runs
// from t=0 for the export duration. Scene switches, transitions and
// keyframed params happen during the recording because the same RAF loop
// drives them. Frames are captured with canvas.captureStream(fps) +
// MediaRecorder (WebM). This is a real-time recording: a 60 s export
// takes 60 s of wall clock, and the tab must stay visible (RAF pauses
// when the tab is hidden).
//
// Audio: when the project has an audio track and the toggle is on, the
// export page's <audio data-project-track> element is tapped through a
// fresh AudioContext into a MediaStreamDestination and mixed into the
// recording. If that tap fails, the export continues video-only and the
// caller is told so — never a silent missing-audio file.
import type { Project } from './schema';
import { timelineTotalDuration } from './timeline';
import { useStudioStore } from './store';
import { clearTransition } from './sceneTransition';
import type { WebGLEngine } from './engine/renderer';

export type ExportResolution = '720' | '1080' | '4k';
export type ExportFps = 24 | 30 | 60;
export type ExportFormat = 'webm' | 'mp4';

export const EXPORT_RESOLUTIONS: Record<ExportResolution, { w: number; h: number; label: string }> = {
  '720': { w: 1280, h: 720, label: '720p — 1280 × 720' },
  '1080': { w: 1920, h: 1080, label: '1080p — 1920 × 1080' },
  '4k': { w: 3840, h: 2160, label: '4K — 3840 × 2160' },
};

export interface ExportOptions {
  resolution: ExportResolution;
  fps: ExportFps;
  /** Seconds to record. */
  durationSec: number;
  includeAudio: boolean;
  /** Video bitrate in Mbps. */
  bitrateMbps: 8 | 16 | 32;
  format: ExportFormat;
}

export interface ExportProgress {
  elapsedSec: number;
  totalSec: number;
  percent: number;
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  format: ExportFormat;
  audioIncluded: boolean;
  /** Non-empty when audio was requested but could not be captured. */
  audioNote: string;
  durationSec: number;
  resolution: ExportResolution;
  fps: ExportFps;
}

export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelledError';
  }
}

const WEBM_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const MP4_MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  'video/mp4',
];

/** First MIME type the browser's MediaRecorder supports, or null. */
export function pickMimeType(format: ExportFormat): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = format === 'mp4' ? MP4_MIME_CANDIDATES : WEBM_MIME_CANDIDATES;
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch { /* ignore */ }
  }
  return null;
}

/** True when this browser can record MP4 directly (Safari 17+; Chrome cannot). */
export function canRecordMp4Directly(): boolean {
  return pickMimeType('mp4') !== null;
}

export function defaultExportDuration(project: Project): number {
  return Math.max(1, Math.round(timelineTotalDuration(project.timeline)));
}

export interface ExportHooks {
  onProgress?: (p: ExportProgress) => void;
}

interface ExportTarget {
  canvas: HTMLCanvasElement;
  engine: WebGLEngine;
  /** Hidden <audio data-project-track> element, or null when the project has no audio track. */
  audioEl: HTMLAudioElement | null;
}

export interface ExportHandle {
  promise: Promise<ExportResult>;
  cancel: () => void;
}

/**
 * Start one export. Returns a handle: `promise` resolves with the recorded
 * blob, rejects with ExportCancelledError on cancel, or an Error with a
 * user-readable message. The engine is restored to its previous size on
 * every exit path.
 */
export function runExport(
  project: Project,
  target: ExportTarget,
  options: ExportOptions,
  hooks: ExportHooks = {},
): ExportHandle {
  const { canvas, engine, audioEl } = target;
  if (typeof canvas.captureStream !== 'function') {
    throw new Error('This browser does not support canvas.captureStream — video export is unavailable.');
  }
  const mimeType = pickMimeType(options.format);
  if (!mimeType) {
    throw new Error(
      options.format === 'mp4'
        ? 'This browser cannot record MP4 directly — use WebM, or convert afterwards.'
        : 'This browser cannot record WebM — video export is unavailable.',
    );
  }
  const res = EXPORT_RESOLUTIONS[options.resolution];
  const totalSec = Math.max(1, options.durationSec);

  const store = useStudioStore.getState();
  const prevW = canvas.clientWidth || 960;
  const prevH = canvas.clientHeight || 540;

  let recorder: MediaRecorder | null = null;
  let audioCtx: AudioContext | null = null;
  let audioIncluded = false;
  let audioNote = '';
  let cancelled = false;
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let startedAt = 0;

  const cleanup = () => {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    try {
      store.setPlaying(false);
    } catch { /* ignore */ }
    try {
      store.setTime(0);
    } catch { /* ignore */ }
    try {
      engine.setSize(prevW, prevH);
    } catch { /* ignore */ }
    if (audioCtx) {
      void audioCtx.close().catch(() => undefined);
      audioCtx = null;
    }
  };

  let cancelFn: () => void = () => undefined;
  const promise = new Promise<ExportResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    // ---- build the capture stream (video + optional audio) ----
    let stream: MediaStream;
    try {
      stream = canvas.captureStream(options.fps);
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error('Could not capture the stage canvas.')));
      return;
    }

    if (options.includeAudio && audioEl && project.audioTracks?.[0]) {
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) throw new Error('Web Audio is not supported in this browser.');
        audioCtx = new AC();
        const dest = audioCtx.createMediaStreamDestination();
        const src = audioCtx.createMediaElementSource(audioEl);
        src.connect(dest);
        // Also send it to the speakers so the export is audible while recording.
        src.connect(audioCtx.destination);
        const audioTracks = dest.stream.getAudioTracks();
        if (audioTracks.length > 0) {
          stream = new MediaStream([...stream.getVideoTracks(), ...audioTracks]);
          audioIncluded = true;
        } else {
          throw new Error('No audio track was produced for the recording.');
        }
        void audioCtx.resume().catch(() => undefined);
      } catch (err) {
        audioIncluded = false;
        audioNote =
          'Audio could not be mixed into the recording, so this export is video-only. ' +
          `(${(err as Error)?.message ?? 'audio tap failed'})`;
        if (audioCtx) {
          void audioCtx.close().catch(() => undefined);
          audioCtx = null;
        }
      }
    } else if (options.includeAudio) {
      audioNote = 'No project audio track is set, so this export is video-only.';
    }

    // ---- recorder ----
    const chunks: Blob[] = [];
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: options.bitrateMbps * 1_000_000,
        ...(audioIncluded ? { audioBitsPerSecond: 128_000 } : {}),
      });
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error('MediaRecorder could not start.')));
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      finish(() => reject(new Error('The recorder reported an error — the export is incomplete.')));
    };
    recorder.onstop = () => {
      if (cancelled) {
        finish(() => reject(new ExportCancelledError()));
        return;
      }
      const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
      finish(() =>
        resolve({
          blob,
          mimeType,
          format: options.format,
          audioIncluded,
          audioNote,
          durationSec: totalSec,
          resolution: options.resolution,
          fps: options.fps,
        }),
      );
    };

    // ---- drive the real render loop from t=0 ----
    try {
      clearTransition();
      store.setTime(0);
      store.setPlaying(false);
      // Exact export backing store (pixel ratio 1) — the CSS size is
      // unchanged, so the stage just downscales on screen.
      engine.setFixedSize(res.w, res.h);
      // Give the engine one frame at the new size before recording starts.
      requestAnimationFrame(() => {
        if (cancelled || settled) return;
        try {
          recorder!.start(250);
        } catch (err) {
          finish(() => reject(err instanceof Error ? err : new Error('MediaRecorder could not start.')));
          return;
        }
        startedAt = performance.now();
        store.setPlaying(true);
        progressTimer = setInterval(() => {
          const elapsed = (performance.now() - startedAt) / 1000;
          hooks.onProgress?.({
            elapsedSec: Math.min(totalSec, elapsed),
            totalSec,
            percent: Math.min(100, (elapsed / totalSec) * 100),
          });
          if (elapsed >= totalSec) {
            try {
              if (recorder && recorder.state !== 'inactive') recorder.stop();
            } catch { /* already stopped */ }
          }
        }, 100);
      });
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error('Export could not start.')));
      return;
    }

    // Expose cancellation through the handle.
    cancelFn = () => {
      cancelled = true;
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        else finish(() => reject(new ExportCancelledError()));
      } catch {
        finish(() => reject(new ExportCancelledError()));
      }
    };
  });

  return { promise, cancel: () => cancelFn() };
}
