// Camera management (Phase 3) — wraps getUserMedia + the engine's
// cameraBus. The live MediaStream is held ONLY in this module and in
// cameraBus (module-level, non-serializable); it is never written to the
// Zustand store or IndexedDB.
import {
  getCameraStream,
  setCameraStream,
  stopCamera as busStopCamera,
  onCameraStreamChange,
} from './engine/cameraBus';

export type CameraErrorCode =
  | 'not-supported'
  | 'permission-denied'
  | 'no-device'
  | 'not-found'
  | 'in-use'
  | 'unknown';

export class CameraError extends Error {
  code: CameraErrorCode;
  constructor(code: CameraErrorCode, message: string) {
    super(message);
    this.name = 'CameraError';
    this.code = code;
  }
}

export interface CameraDevice {
  deviceId: string;
  label: string;
  /** True when the label is empty because permission has not been granted yet. */
  labelHidden: boolean;
}

export interface CameraSettings {
  deviceId?: string;
  label?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: string;
}

let currentDeviceId: string | undefined;
let currentFacingMode: string | undefined;

function toCameraError(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const e = err as { name?: string; message?: string } | null;
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'permission-denied',
        'Camera permission was denied. Allow camera access in the browser address bar, then try again.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError(
        'no-device',
        'No camera was found for the selected device. Check a camera is connected and try another device.',
      );
    case 'NotReadableError':
    case 'TrackStartError':
      return new CameraError(
        'in-use',
        'The camera is already in use by another app or browser tab. Close the other app and try again.',
      );
    case 'AbortError':
      return new CameraError('unknown', 'Starting the camera was interrupted. Try again.');
    default:
      return new CameraError(
        'unknown',
        `Could not start the camera${e?.message ? `: ${e.message}` : '.'}`,
      );
  }
}

/**
 * List video input devices. Labels are empty until the user has granted
 * camera permission once — callers should surface `labelHidden` and offer
 * "Enable camera" first, then re-list. Never throws for a missing API:
 * throws CameraError('not-supported') instead.
 */
export async function listCameras(): Promise<CameraDevice[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    throw new CameraError(
      'not-supported',
      'This browser does not support camera access (mediaDevices is unavailable — use a secure context, https or localhost).',
    );
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
      labelHidden: !d.label,
    }));
}

/**
 * Start the camera and register the stream in cameraBus so the WebGL
 * engine renders it. Prefers `deviceId` when given, else `facingMode`
 * ('user' | 'environment'). Returns the live MediaStream.
 * Throws a typed CameraError the UI can display verbatim.
 */
export async function startCamera(
  deviceId?: string,
  facingMode?: 'user' | 'environment',
): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      'not-supported',
      'This browser does not support camera access (getUserMedia is unavailable — use a secure context, https or localhost).',
    );
  }
  // Stop any previous stream first so the device is released cleanly.
  stopCamera();
  const constraints: MediaStreamConstraints = {
    video: deviceId
      ? { deviceId: { exact: deviceId } }
      : facingMode
        ? { facingMode }
        : true,
    audio: false,
  };
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (!stream.getVideoTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new CameraError('no-device', 'The camera returned no video track.');
    }
    currentDeviceId = deviceId ?? stream.getVideoTracks()[0]?.getSettings().deviceId;
    currentFacingMode = facingMode;
    setCameraStream(stream);
    return stream;
  } catch (err) {
    throw toCameraError(err);
  }
}

/** Stop the camera and clear it from cameraBus. Safe to call when idle. */
export function stopCamera(): void {
  currentDeviceId = undefined;
  currentFacingMode = undefined;
  busStopCamera();
}

/** Freeze the video (tracks stay alive, frames stop) — resumes with resumeCamera(). */
export function pauseCamera(): boolean {
  const stream = getCameraStream();
  if (!stream) return false;
  stream.getVideoTracks().forEach((t) => {
    t.enabled = false;
  });
  return true;
}

/** Un-freeze the video after pauseCamera(). */
export function resumeCamera(): boolean {
  const stream = getCameraStream();
  if (!stream) return false;
  stream.getVideoTracks().forEach((t) => {
    t.enabled = true;
  });
  return true;
}

export function isCameraPaused(): boolean {
  const stream = getCameraStream();
  const track = stream?.getVideoTracks()[0];
  return !!stream && !!track && !track.enabled;
}

export function isCameraActive(): boolean {
  const stream = getCameraStream();
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
}

export function getCurrentCamera(): { deviceId?: string; facingMode?: string } {
  return { deviceId: currentDeviceId, facingMode: currentFacingMode };
}

/** Settings/capabilities of the live video track, or null when no camera is running. */
export function getCameraSettings(): CameraSettings | null {
  const stream = getCameraStream();
  const track = stream?.getVideoTracks()[0];
  if (!track) return null;
  const s = track.getSettings();
  return {
    deviceId: s.deviceId,
    label: track.label || undefined,
    width: s.width,
    height: s.height,
    frameRate: s.frameRate,
    facingMode: typeof s.facingMode === 'string' ? s.facingMode : undefined,
  };
}

export function getCameraCapabilities(): MediaTrackCapabilities | null {
  const stream = getCameraStream();
  const track = stream?.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== 'function') return null;
  try {
    return track.getCapabilities();
  } catch {
    return null;
  }
}

export { getCameraStream, onCameraStreamChange };
