// Optional WebM -> MP4 conversion — Phase 6.
// FFmpeg.wasm is loaded LAZILY, only when the user clicks "Convert to
// MP4" after a WebM export. It is never in the initial bundle and is not
// an npm import at all: the ESM build of @ffmpeg/ffmpeg cannot be
// bundled by this project's Turbopack build (its dynamic
// `new Worker(new URL(classWorkerURL, import.meta.url))` fails static
// resolution), so the UMD build is loaded at conversion time from the
// unpkg CDN as a plain <script>, which exposes window.FFmpegWASM.
// The encoder core (~31 MB) is then fetched from unpkg as well, so this
// needs network access and a browser that can run WebAssembly. The
// single-threaded core is used on purpose: it needs no SharedArrayBuffer
// / cross-origin isolation.
//
// If anything here fails (script load failure, core load failure, codec
// error, no network), the caller shows the honest note "MP4 export is
// not available in this browser build — WebM is provided" and keeps the
// WebM. Nothing here fakes an MP4.
const FFMPEG_UMD_URL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js';
const CORE_VERSION = '0.12.6';
const CORE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm/ffmpeg-core.js`;
const WASM_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm/ffmpeg-core.wasm`;

export interface Mp4ConvertProgress {
  /** 0..1 while transcoding (0 while the encoder is still loading). */
  progress: number;
  stage: 'loading' | 'transcoding' | 'done';
}

interface FfmpegInstance {
  on: (event: 'progress' | 'log', cb: (e: { progress: number }) => void) => void;
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  exec: (args: string[]) => Promise<number>;
  readFile: (path: string) => Promise<Uint8Array>;
  terminate: () => void;
}

interface FfmpegWasmGlobal {
  FFmpeg: new () => FfmpegInstance;
}

declare global {
  interface Window {
    FFmpegWASM?: FfmpegWasmGlobal;
  }
}

let scriptLoadPromise: Promise<FfmpegWasmGlobal> | null = null;

/** Load the FFmpeg.wasm UMD build from the CDN (once per page load). */
function loadFfmpegScript(): Promise<FfmpegWasmGlobal> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Not running in a browser.'));
  if (window.FFmpegWASM) return Promise.resolve(window.FFmpegWASM);
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise<FfmpegWasmGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = FFMPEG_UMD_URL;
    script.async = true;
    script.onload = () => {
      if (window.FFmpegWASM) resolve(window.FFmpegWASM);
      else reject(new Error('The FFmpeg script loaded but exposed no FFmpegWASM global.'));
    };
    script.onerror = () => reject(new Error('The FFmpeg encoder script could not be downloaded (check network access to unpkg.com).'));
    document.head.appendChild(script);
    // Give up after 60 s rather than hanging the UI forever.
    setTimeout(() => reject(new Error('Timed out downloading the FFmpeg encoder script.')), 60_000);
  });
  // Allow a retry after a failure.
  scriptLoadPromise.catch(() => {
    scriptLoadPromise = null;
  });
  return scriptLoadPromise;
}

/**
 * Transcode a WebM blob to MP4 (H.264 + AAC) entirely in the browser.
 * Throws an Error with a user-readable message on any failure.
 */
export async function convertWebmToMp4(
  webm: Blob,
  onProgress?: (p: Mp4ConvertProgress) => void,
): Promise<Blob> {
  onProgress?.({ progress: 0, stage: 'loading' });
  let ffmpeg: FfmpegInstance | null = null;
  try {
    const wasm = await loadFfmpegScript();
    ffmpeg = new wasm.FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
      onProgress?.({ progress: Math.min(1, Math.max(0, progress)), stage: 'transcoding' });
    });
    await ffmpeg.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
    await ffmpeg.writeFile('input.webm', new Uint8Array(await webm.arrayBuffer()));
    await ffmpeg.exec([
      '-i', 'input.webm',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      'output.mp4',
    ]);
    const bytes = await ffmpeg.readFile('output.mp4');
    if (!bytes || bytes.length === 0) {
      throw new Error('The encoder produced an empty MP4 file.');
    }
    onProgress?.({ progress: 1, stage: 'done' });
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'video/mp4' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `MP4 conversion failed in this browser (${msg}). The WebM export is unaffected.`,
    );
  } finally {
    try {
      ffmpeg?.terminate();
    } catch { /* already terminated */ }
  }
}
