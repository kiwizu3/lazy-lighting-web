// Camera bus: a tiny module-level holder for the live camera MediaStream.
// The engine (owned by ProjectionCanvas) reads the stream each frame; the
// PropertiesPanel "Enable camera" button writes it here. This avoids prop
// drilling a stream through the store (streams are not serializable and must
// never land in IndexedDB).
let stream: MediaStream | null = null;
const listeners = new Set<(s: MediaStream | null) => void>();

export function getCameraStream(): MediaStream | null {
  return stream;
}

export function setCameraStream(s: MediaStream | null): void {
  stream = s;
  listeners.forEach((fn) => fn(s));
}

export function onCameraStreamChange(fn: (s: MediaStream | null) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Ask the browser for a camera. Returns null (and logs) if denied/unavailable. */
export async function requestCamera(): Promise<MediaStream | null> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    setCameraStream(s);
    return s;
  } catch (err) {
    console.warn('[camera] getUserMedia failed', err);
    return null;
  }
}

export function stopCamera(): void {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }
  setCameraStream(null);
}
