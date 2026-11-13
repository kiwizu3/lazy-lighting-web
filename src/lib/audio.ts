// Web Audio engine — Phase 4.
// Created only on user action (startMic / startFile / startTrack); nothing
// in this module runs at bundle load or page load. One AudioContext per
// engine; the analyser is the single tap point for every source.
// Levels are smoothed exponentially; beat detection is bass-energy flux
// against a short running average.

export type AudioSourceKind = 'mic' | 'file' | 'track' | null;

export type AudioBand = 'bass' | 'mid' | 'high' | 'amplitude' | 'beat';

export interface AudioLevels {
  /** Overall RMS amplitude, 0..1 (smoothed). */
  amplitude: number;
  /** ~20–150 Hz energy, 0..1. */
  bass: number;
  /** ~150–2000 Hz energy, 0..1. */
  mid: number;
  /** ~2–16 kHz energy, 0..1. */
  high: number;
  /** True on the frame a beat is detected. */
  beat: boolean;
  /** 0..1, decays after a beat. */
  beatStrength: number;
  /** Time-domain samples (length = analyser.fftSize). */
  waveform: Uint8Array;
  /** Frequency bins (length = analyser.frequencyBinCount). */
  frequency: Uint8Array;
}

export type AudioErrorCode =
  | 'not-supported'
  | 'permission-denied'
  | 'no-source'
  | 'device-unavailable'
  | 'context-failed';

export class AudioEngineError extends Error {
  code: AudioErrorCode;
  constructor(code: AudioErrorCode, message: string) {
    super(message);
    this.name = 'AudioEngineError';
    this.code = code;
  }
}

export interface AudioEngineOptions {
  sensitivity?: number;
  smoothing?: number;
  fftSize?: number;
}

const DEFAULT_FFT_SIZE = 2048;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: AudioNode | null = null;
  private mediaStream: MediaStream | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private elementSource: MediaElementAudioSourceNode | null = null;
  private bassHistory: number[] = [];
  private prevBass = 0;
  private beatStrength = 0;
  private lastBeatAt = 0;
  private smoothed: { amplitude: number; bass: number; mid: number; high: number } = {
    amplitude: 0,
    bass: 0,
    mid: 0,
    high: 0,
  };
  sensitivity: number;
  smoothing: number;
  sourceKind: AudioSourceKind = null;

  constructor(options: AudioEngineOptions = {}) {
    this.sensitivity = options.sensitivity ?? 1;
    this.smoothing = options.smoothing ?? 0.7;
  }

  get isRunning(): boolean {
    return this.ctx !== null && this.ctx.state === 'running' && this.analyser !== null;
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      throw new AudioEngineError('not-supported', 'Web Audio is not supported in this browser.');
    }
    try {
      this.ctx = new AC();
    } catch {
      throw new AudioEngineError('context-failed', 'Could not create an AudioContext.');
    }
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = DEFAULT_FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyser.connect(this.ctx.destination);
    return this.ctx;
  }

  /** Must be called from a user gesture; resumes a suspended context. */
  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        throw new AudioEngineError('context-failed', 'AudioContext could not be resumed — interact with the page first.');
      }
    }
  }

  private attachSource(node: AudioNode): void {
    if (!this.analyser) throw new AudioEngineError('context-failed', 'Analyser is not ready.');
    this.detachSource();
    this.sourceNode = node;
    node.connect(this.analyser);
  }

  private detachSource(): void {
    try {
      this.sourceNode?.disconnect();
    } catch { /* already disconnected */ }
    this.sourceNode = null;
  }

  /** Microphone input via getUserMedia. Throws AudioEngineError on denial. */
  async startMic(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new AudioEngineError('not-supported', 'Microphone access is not supported in this browser.');
    }
    const ctx = this.ensureContext();
    await this.resume();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new AudioEngineError(
          'permission-denied',
          'Microphone permission was denied. Allow microphone access in the browser site settings and try again.',
        );
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new AudioEngineError('device-unavailable', 'No microphone was found on this device.');
      }
      throw new AudioEngineError('device-unavailable', `Microphone could not be started (${name || 'unknown error'}).`);
    }
    this.stopStreamOnly();
    this.mediaStream = stream;
    const node = ctx.createMediaStreamSource(stream);
    this.attachSource(node);
    this.sourceKind = 'mic';
  }

  /** Uploaded audio file: plays through an <audio> element tapped by the analyser. */
  async startFile(file: File): Promise<HTMLAudioElement> {
    if (!file) throw new AudioEngineError('no-source', 'No audio file was provided.');
    const ctx = this.ensureContext();
    await this.resume();
    this.stopStreamOnly();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    const el = new Audio(this.objectUrl);
    el.loop = true;
    el.crossOrigin = 'anonymous';
    this.audioElement = el;
    const node = ctx.createMediaElementSource(el);
    this.elementSource = node;
    this.attachSource(node);
    this.sourceKind = 'file';
    try {
      await el.play();
    } catch {
      throw new AudioEngineError(
        'device-unavailable',
        'The audio file could not be played — autoplay was blocked. Press play on the audio element.',
      );
    }
    return el;
  }

  /**
   * Project audio track: taps an existing <audio> element (e.g. the one the
   * project already plays). The element must not already be tapped by
   * another MediaElementSource — a second tap throws in the browser, so we
   * keep one source per element via a WeakMap-free guard on the element.
   */
  async startTrack(el: HTMLAudioElement): Promise<void> {
    if (!el) throw new AudioEngineError('no-source', 'No project audio track element was provided.');
    const ctx = this.ensureContext();
    await this.resume();
    this.stopStreamOnly();
    const flagged = el as HTMLAudioElement & { __lazyLightingTapped?: boolean };
    if (flagged.__lazyLightingTapped && this.elementSource && this.audioElement === el) {
      this.attachSource(this.elementSource);
    } else {
      try {
        const node = ctx.createMediaElementSource(el);
        this.elementSource = node;
        flagged.__lazyLightingTapped = true;
        this.attachSource(node);
      } catch {
        throw new AudioEngineError(
          'device-unavailable',
          'This audio element is already connected to another audio graph and cannot be tapped again. Use a different track element.',
        );
      }
    }
    this.audioElement = el;
    this.sourceKind = 'track';
    if (el.paused) {
      try {
        await el.play();
      } catch {
        // Element exists but autoplay is blocked; levels stay at 0 until it plays.
      }
    }
  }

  private stopStreamOnly(): void {
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) track.stop();
      this.mediaStream = null;
    }
    this.detachSource();
    if (this.audioElement && this.sourceKind === 'file') {
      this.audioElement.pause();
    }
  }

  stop(): void {
    this.stopStreamOnly();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.audioElement = null;
    this.elementSource = null;
    this.sourceKind = null;
    this.beatStrength = 0;
    this.bassHistory = [];
    this.smoothed = { amplitude: 0, bass: 0, mid: 0, high: 0 };
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.analyser = null;
  }

  setSensitivity(v: number): void {
    this.sensitivity = Math.min(3, Math.max(0.1, v));
  }

  setSmoothing(v: number): void {
    this.smoothing = Math.min(0.95, Math.max(0, v));
  }

  getLevels(): AudioLevels {
    const analyser = this.analyser;
    const empty = (size: number): AudioLevels => ({
      amplitude: 0,
      bass: 0,
      mid: 0,
      high: 0,
      beat: false,
      beatStrength: 0,
      waveform: new Uint8Array(size),
      frequency: new Uint8Array(size / 2),
    });
    if (!analyser || !this.ctx || this.ctx.state !== 'running') return empty(DEFAULT_FFT_SIZE);
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const wave = new Uint8Array(analyser.fftSize);
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);

    // Time-domain RMS amplitude.
    let sumSq = 0;
    for (let i = 0; i < wave.length; i++) {
      const v = (wave[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / wave.length);
    const amplitude = Math.min(1, rms * 2.2 * this.sensitivity);

    // Frequency bands (bin width = sampleRate / fftSize).
    const binHz = this.ctx.sampleRate / analyser.fftSize;
    const bandAvg = (loHz: number, hiHz: number): number => {
      const lo = Math.max(0, Math.floor(loHz / binHz));
      const hi = Math.min(freq.length - 1, Math.ceil(hiHz / binHz));
      if (hi <= lo) return 0;
      let sum = 0;
      for (let i = lo; i <= hi; i++) sum += freq[i];
      return sum / (hi - lo + 1) / 255;
    };
    const bassRaw = Math.min(1, bandAvg(20, 150) * 1.6 * this.sensitivity);
    const midRaw = Math.min(1, bandAvg(150, 2000) * 1.4 * this.sensitivity);
    const highRaw = Math.min(1, bandAvg(2000, 16000) * 1.6 * this.sensitivity);

    // Exponential smoothing.
    const s = this.smoothing;
    this.smoothed.amplitude = s * this.smoothed.amplitude + (1 - s) * amplitude;
    this.smoothed.bass = s * this.smoothed.bass + (1 - s) * bassRaw;
    this.smoothed.mid = s * this.smoothed.mid + (1 - s) * midRaw;
    this.smoothed.high = s * this.smoothed.high + (1 - s) * highRaw;

    // Beat detection: bass energy flux vs a short running average.
    const bass = this.smoothed.bass;
    this.bassHistory.push(bass);
    if (this.bassHistory.length > 43) this.bassHistory.shift(); // ~1s at 43 fps
    const avg = this.bassHistory.reduce((a, b) => a + b, 0) / this.bassHistory.length;
    const now = performance.now();
    let beat = false;
    if (bass > avg * 1.35 + 0.08 && bass > this.prevBass * 1.08 && now - this.lastBeatAt > 180) {
      beat = true;
      this.lastBeatAt = now;
      this.beatStrength = 1;
    }
    this.prevBass = bass;
    this.beatStrength = Math.max(0, this.beatStrength - 0.06);

    return {
      amplitude: this.smoothed.amplitude,
      bass,
      mid: this.smoothed.mid,
      high: this.smoothed.high,
      beat,
      beatStrength: this.beatStrength,
      waveform: wave,
      frequency: freq,
    };
  }
}

/** Create an engine. Safe to call at module scope — no AudioContext is made until start*. */
export function createAudioEngine(options?: AudioEngineOptions): AudioEngine {
  return new AudioEngine(options);
}

/**
 * Map one audio band (0..1) onto a parameter range.
 * `sensitivity` scales the band before clamping; the result is clamped to [min, max].
 */
export function mapBandToParam(
  band: number,
  min: number,
  max: number,
  sensitivity = 1,
): number {
  const v = Math.min(1, Math.max(0, band * sensitivity));
  return min + (max - min) * v;
}

/** Read one band out of a levels object. */
export function readBand(levels: AudioLevels, band: AudioBand): number {
  if (band === 'beat') return levels.beat ? 1 : levels.beatStrength;
  return levels[band];
}

export interface AudioMapping {
  id: string;
  source: AudioBand;
  target: 'scale' | 'rotation' | 'brightness' | 'particles' | 'opacity' | 'speed';
  enabled: boolean;
  min: number;
  max: number;
}

export interface AudioModulations {
  scale: number;
  rotation: number;
  brightness: number;
  particles: number;
  opacity: number;
  speed: number;
}

/**
 * Turn live levels + enabled mappings into per-frame parameter values.
 * Each target starts at its neutral value (scale 1, rotation 0, brightness 1,
 * particles 1, opacity 1, speed 1) and is overridden by the FIRST enabled
 * mapping for that target. Phase 5 call site: inside the render loop
 * (ProjectionCanvas loop / engine renderFrame), call
 *   const mods = getAudioModulations(engine.getLevels(), mappings);
 * and multiply/add mods into the per-surface visual params before drawing
 * (scale -> visual scale, rotation -> surface rotation, brightness -> a
 * brightness filter / colour multiplier, particles -> shader u_density,
 * opacity -> surface opacity, speed -> animation speed multiplier).
 */
export function getAudioModulations(levels: AudioLevels, mappings: AudioMapping[]): AudioModulations {
  const mods: AudioModulations = {
    scale: 1,
    rotation: 0,
    brightness: 1,
    particles: 1,
    opacity: 1,
    speed: 1,
  };
  const seen = new Set<string>();
  for (const m of mappings) {
    if (!m.enabled || seen.has(m.target)) continue;
    seen.add(m.target);
    const band = readBand(levels, m.source);
    mods[m.target] = mapBandToParam(band, m.min, m.max, 1);
  }
  return mods;
}
