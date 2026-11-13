// Hand / face tracking — Phase 6.
// MediaPipe tasks-vision is loaded ONLY via dynamic import() when the
// user enables tracking — it is never in the initial bundle. The models
// (hand_landmarker.task, face_landmarker.task) are downloaded from
// Google's MediaPipe model storage at enable time, and the wasm runtime
// from the jsDelivr CDN, so enabling tracking needs network access.
//
// If MediaPipe cannot be loaded (install problem, model download failure,
// runtime error, no GPU/CPU delegate), the engine falls back to honest
// motion tracking: frame differencing on the camera image gives a motion
// centroid, labelled everywhere as "Motion tracking (no hand/face
// model)". Tracking is never claimed when it is not running.
//
// Values flow into the SAME live-modulation path Phase 5 built:
// TrackingPanel writes mapped values with setTrackingLive() on the
// perform store (keys `global:<target>`), and computeLiveMod applies
// them alongside audio / MIDI / LFO / keyframes.
import type {
  FaceLandmarker,
  FilesetResolver as FilesetResolverType,
  HandLandmarker,
} from '@mediapipe/tasks-vision';

export type TrackingMode = 'off' | 'mediapipe' | 'motion';

export interface TrackingLandmark {
  x: number;
  y: number;
}

export interface TrackingFrame {
  mode: TrackingMode;
  handDetected: boolean;
  faceDetected: boolean;
  /** Palm position, normalised 0..1 (mirrored, so moving your hand right moves the value right). */
  handX: number | null;
  handY: number | null;
  /** 0 = fingers apart, 1 = thumb + index tips touching. */
  pinch: number | null;
  /** Nose position, normalised 0..1 (mirrored). */
  headX: number | null;
  headY: number | null;
  /** Face bounding-box width, normalised 0..1 (grows as you move closer). */
  faceScale: number | null;
  /** Motion centroid, normalised 0..1 (motion mode only). */
  motionX: number | null;
  motionY: number | null;
  /** 0..1, how much of the frame is moving (motion mode only). */
  motionAmount: number;
  handLandmarks: TrackingLandmark[][];
  faceLandmarks: TrackingLandmark[][];
}

export type TrackingModelStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface TrackingStatus {
  mode: TrackingMode;
  handModel: TrackingModelStatus;
  faceModel: TrackingModelStatus;
  /** Human-readable reason when MediaPipe did not start. */
  error: string | null;
}

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const MOTION_W = 80;
const MOTION_H = 45;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function dist(a: TrackingLandmark, b: TrackingLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The tracking engine. One instance per panel mount. `enable()` tries
 * MediaPipe first and falls back to motion tracking on any failure;
 * `start()` runs the rAF detection loop against a live <video> element.
 */
export class TrackingEngine {
  status: TrackingStatus = { mode: 'off', handModel: 'idle', faceModel: 'idle', error: null };

  private hand: HandLandmarker | null = null;
  private face: FaceLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private raf = 0;
  private running = false;
  private lastVideoTime = -1;
  private onFrame: ((f: TrackingFrame) => void) | null = null;
  private motionCanvas: HTMLCanvasElement | null = null;
  private motionCtx: CanvasRenderingContext2D | null = null;
  private prevMotion: Uint8ClampedArray | null = null;
  private smoothMotion = { x: 0.5, y: 0.5, amount: 0 };

  /** Load MediaPipe (dynamic import) and create the landmarkers. */
  async enable(video: HTMLVideoElement): Promise<TrackingMode> {
    this.video = video;
    this.status = { mode: 'off', handModel: 'loading', faceModel: 'loading', error: null };
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await (vision.FilesetResolver as typeof FilesetResolverType).forVisionTasks(WASM_URL);
      // GPU first, CPU as a fallback — some machines refuse the GPU delegate.
      const makeHand = async (delegate: 'GPU' | 'CPU') =>
        vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numHands: 1,
        });
      const makeFace = async (delegate: 'GPU' | 'CPU') =>
        vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
        });
      let handError: unknown = null;
      let faceError: unknown = null;
      try {
        this.hand = await makeHand('GPU');
      } catch (err) {
        handError = err;
        try {
          this.hand = await makeHand('CPU');
        } catch (err2) {
          handError = err2;
        }
      }
      try {
        this.face = await makeFace('GPU');
      } catch (err) {
        faceError = err;
        try {
          this.face = await makeFace('CPU');
        } catch (err2) {
          faceError = err2;
        }
      }
      this.status.handModel = this.hand ? 'ready' : 'failed';
      this.status.faceModel = this.face ? 'ready' : 'failed';
      if (!this.hand && !this.face) {
        const reason =
          (handError instanceof Error ? handError.message : String(handError ?? '')) ||
          (faceError instanceof Error ? faceError.message : String(faceError ?? '')) ||
          'unknown error';
        this.status.mode = 'motion';
        this.status.error = `Hand/face models could not be loaded (${reason}). Using motion tracking instead.`;
        return 'motion';
      }
      this.status.mode = 'mediapipe';
      this.status.error =
        !this.hand || !this.face
          ? `Only ${this.hand ? 'hand' : 'face'} tracking loaded — the other model failed (${(!this.hand ? handError : faceError) instanceof Error ? ((!this.hand ? handError : faceError) as Error).message : 'load error'}).`
          : null;
      return 'mediapipe';
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.status.mode = 'motion';
      this.status.handModel = 'failed';
      this.status.faceModel = 'failed';
      this.status.error = `MediaPipe could not be loaded (${reason}). Using motion tracking instead.`;
      return 'motion';
    }
  }

  start(onFrame: (f: TrackingFrame) => void): void {
    this.onFrame = onFrame;
    if (this.running) return;
    this.running = true;
    this.lastVideoTime = -1;
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const video = this.video;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      if (this.status.mode === 'mediapipe') this.detectMediaPipe(video);
      else this.detectMotion(video);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private detectMediaPipe(video: HTMLVideoElement): void {
    const now = performance.now();
    // VIDEO mode requires a strictly increasing timestamp; skip frames
    // the video element has not advanced.
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;
    const frame: TrackingFrame = {
      mode: 'mediapipe',
      handDetected: false,
      faceDetected: false,
      handX: null,
      handY: null,
      pinch: null,
      headX: null,
      headY: null,
      faceScale: null,
      motionX: null,
      motionY: null,
      motionAmount: 0,
      handLandmarks: [],
      faceLandmarks: [],
    };
    try {
      if (this.hand) {
        const res = this.hand.detectForVideo(video, now);
        const lm = res.landmarks?.[0];
        if (lm && lm.length >= 21) {
          frame.handDetected = true;
          const palm = lm[9];
          frame.handX = clamp01(1 - palm.x);
          frame.handY = clamp01(palm.y);
          const handSize = Math.max(0.01, dist(lm[0], lm[9]));
          const pinchDist = dist(lm[4], lm[8]);
          frame.pinch = clamp01(1 - pinchDist / (0.45 * handSize));
          frame.handLandmarks = [lm.map((p) => ({ x: p.x, y: p.y }))];
        }
      }
      if (this.face) {
        const res = this.face.detectForVideo(video, now);
        const lm = res.faceLandmarks?.[0];
        if (lm && lm.length > 10) {
          frame.faceDetected = true;
          const nose = lm[1];
          frame.headX = clamp01(1 - nose.x);
          frame.headY = clamp01(nose.y);
          let minX = 1;
          let maxX = 0;
          for (const p of lm) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
          }
          frame.faceScale = clamp01(maxX - minX);
          // Every 12th point keeps the overlay readable (468 points is a blob).
          frame.faceLandmarks = [lm.filter((_, i) => i % 12 === 0).map((p) => ({ x: p.x, y: p.y }))];
        }
      }
    } catch (err) {
      // A single failed detection must not kill the loop; the next frame retries.
      console.warn('[tracking] detectForVideo failed', err);
    }
    this.onFrame?.(frame);
  }

  private detectMotion(video: HTMLVideoElement): void {
    if (!this.motionCanvas) {
      this.motionCanvas = document.createElement('canvas');
      this.motionCanvas.width = MOTION_W;
      this.motionCanvas.height = MOTION_H;
      this.motionCtx = this.motionCanvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this.motionCtx;
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, MOTION_W, MOTION_H);
    const data = ctx.getImageData(0, 0, MOTION_W, MOTION_H).data;
    const gray = new Uint8ClampedArray(MOTION_W * MOTION_H);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) | 0;
    }
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    if (this.prevMotion) {
      for (let y = 0; y < MOTION_H; y++) {
        for (let x = 0; x < MOTION_W; x++) {
          const i = y * MOTION_W + x;
          if (Math.abs(gray[i] - this.prevMotion[i]) > 24) {
            sumX += x;
            sumY += y;
            count++;
          }
        }
      }
    }
    this.prevMotion = gray;
    const s = this.smoothMotion;
    if (count > 8) {
      const cx = sumX / count / MOTION_W;
      const cy = sumY / count / MOTION_H;
      s.x = s.x * 0.7 + (1 - cx) * 0.3;
      s.y = s.y * 0.7 + cy * 0.3;
      s.amount = Math.min(1, s.amount * 0.8 + (count / (MOTION_W * MOTION_H)) * 4);
    } else {
      s.amount *= 0.9;
    }
    this.onFrame?.({
      mode: 'motion',
      handDetected: false,
      faceDetected: false,
      handX: null,
      handY: null,
      pinch: null,
      headX: null,
      headY: null,
      faceScale: null,
      motionX: clamp01(s.x),
      motionY: clamp01(s.y),
      motionAmount: s.amount,
      handLandmarks: [],
      faceLandmarks: [],
    });
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.onFrame = null;
    this.prevMotion = null;
    try {
      this.hand?.close();
    } catch { /* ignore */ }
    try {
      this.face?.close();
    } catch { /* ignore */ }
    this.hand = null;
    this.face = null;
    this.status = { mode: 'off', handModel: 'idle', faceModel: 'idle', error: null };
  }
}

// ---------------------------------------------------------------------------
// Mapping: tracking values -> live-modulation targets (perform store).
// ---------------------------------------------------------------------------

export type TrackingSource =
  | 'handX'
  | 'handY'
  | 'pinch'
  | 'headX'
  | 'headY'
  | 'faceScale'
  | 'motionX'
  | 'motionY';

export type TrackingTarget =
  | 'hue'
  | 'scale'
  | 'effectIntensity'
  | 'rotation'
  | 'brightness'
  | 'density';

export interface TrackingMapping {
  id: string;
  source: TrackingSource;
  target: TrackingTarget;
  enabled: boolean;
  /** 0..2 — scales the normalised source before it hits the range. */
  sensitivity: number;
  min: number;
  max: number;
}

export const DEFAULT_TRACKING_MAPPINGS: TrackingMapping[] = [
  { id: 'trk-handx-hue', source: 'handX', target: 'hue', enabled: true, sensitivity: 1, min: -180, max: 180 },
  { id: 'trk-handy-scale', source: 'handY', target: 'scale', enabled: true, sensitivity: 1, min: 0.5, max: 2 },
  { id: 'trk-pinch-intensity', source: 'pinch', target: 'effectIntensity', enabled: true, sensitivity: 1, min: 0, max: 2 },
  { id: 'trk-headx-rotation', source: 'headX', target: 'rotation', enabled: true, sensitivity: 1, min: -30, max: 30 },
  { id: 'trk-heady-brightness', source: 'headY', target: 'brightness', enabled: true, sensitivity: 1, min: 0.5, max: 1.5 },
  { id: 'trk-facescale-density', source: 'faceScale', target: 'density', enabled: true, sensitivity: 1, min: 0.5, max: 2 },
  { id: 'trk-motionx-hue', source: 'motionX', target: 'hue', enabled: true, sensitivity: 1, min: -180, max: 180 },
  { id: 'trk-motiony-scale', source: 'motionY', target: 'scale', enabled: true, sensitivity: 1, min: 0.5, max: 2 },
];

const SOURCE_LABELS: Record<TrackingSource, string> = {
  handX: 'Hand X',
  handY: 'Hand Y',
  pinch: 'Pinch',
  headX: 'Head X',
  headY: 'Head Y',
  faceScale: 'Face size',
  motionX: 'Motion X',
  motionY: 'Motion Y',
};

export function trackingSourceLabel(source: TrackingSource): string {
  return SOURCE_LABELS[source];
}

/** Read a raw 0..1 value for a mapping source out of a frame. */
export function readTrackingSource(frame: TrackingFrame, source: TrackingSource): number | null {
  switch (source) {
    case 'handX': return frame.handX;
    case 'handY': return frame.handY;
    case 'pinch': return frame.pinch;
    case 'headX': return frame.headX;
    case 'headY': return frame.headY;
    case 'faceScale': return frame.faceScale;
    case 'motionX': return frame.motionX;
    case 'motionY': return frame.motionY;
    default: return null;
  }
}

/**
 * Map a 0..1 source value onto the mapping's [min, max] range.
 * Position sources (hand/head/motion X/Y) are centred: 0.5 is neutral,
 * and sensitivity stretches the deviation from centre. Amount sources
 * (pinch, face size) start at 0 and sensitivity scales the amount.
 * Face size is re-normalised from its typical 0.1..0.5 band first.
 */
export function mapTrackingValue(mapping: TrackingMapping, raw: number): number {
  const centred = ['handX', 'handY', 'headX', 'headY', 'motionX', 'motionY'].includes(mapping.source);
  let v = raw;
  if (mapping.source === 'faceScale') v = clamp01((raw - 0.1) / 0.4);
  if (centred) v = clamp01((v - 0.5) * mapping.sensitivity + 0.5);
  else v = clamp01(v * mapping.sensitivity);
  return mapping.min + (mapping.max - mapping.min) * v;
}
