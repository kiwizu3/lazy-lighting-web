// WebGL renderer wrapper (plain three.js, NOT React Three Fiber — precise
// control over the render loop, camera and texture lifecycle).
// Orthographic camera over normalized stage space: x 0..1 left->right,
// y 0..1 top->bottom (world y = 1 - ny, see surfaces.ts).
import * as THREE from 'three';
import type { Project, Surface } from '../schema';
import { SourceManager } from './sources';
import type { SurfaceRenderCtx } from './liveMod';
import { buildSurfaceMesh, disposeSurfaceMesh, updateSurfaceMesh, type SurfaceMesh } from './surfaces';

export type QualitySetting = 'performance' | 'balanced' | 'high';

export interface EngineCallbacks {
  /** Called with true on context loss, false on restore. */
  onContextLost?: (lost: boolean) => void;
}

export interface EngineOptions {
  quality?: QualitySetting;
  onContextLost?: (lost: boolean) => void;
}

function dprCap(quality: QualitySetting): number {
  if (quality === 'high') return 2;
  if (quality === 'balanced') return 1.5;
  return 1;
}

export class WebGLEngine {
  readonly sources = new SourceManager();
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;
  private meshes = new Map<string, SurfaceMesh>();
  private quality: QualitySetting;
  private callbacks: EngineCallbacks;
  private contextLost = false;
  private disposed = false;
  private width = 0;
  private height = 0;

  private onLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    this.callbacks.onContextLost?.(true);
  };

  private onRestored = () => {
    this.contextLost = false;
    // All GPU textures are gone: drop the cache and rebuild meshes so the
    // next frame re-uploads everything.
    this.sources.invalidateAll();
    this.clearMeshes();
    this.callbacks.onContextLost?.(false);
  };

  constructor(canvas: HTMLCanvasElement, opts: EngineOptions = {}) {
    this.canvas = canvas;
    this.quality = opts.quality ?? 'balanced';
    this.callbacks = { onContextLost: opts.onContextLost };
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    // Ortho over normalized stage space, y up in world (stage y is down).
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    this.camera.position.set(0, 0, 5);
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  get lost(): boolean {
    return this.contextLost;
  }

  setQuality(q: QualitySetting): void {
    this.quality = q;
    if (this.width > 0 && this.height > 0) this.setSize(this.width, this.height);
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    if (!this.renderer) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap(this.quality)));
    this.renderer.setSize(w, h, false);
  }

  /**
   * Render at an exact backing-store size (video export): pixel ratio is
   * forced to 1 so captureStream sees exactly w x h. The canvas CSS size
   * is untouched, so the stage just downscales on screen. Restore with
   * setSize() afterwards.
   */
  setFixedSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    if (!this.renderer) return;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
  }

  private clearMeshes(): void {
    for (const rec of this.meshes.values()) {
      this.scene?.remove(rec.group);
      disposeSurfaceMesh(rec);
    }
    this.meshes.clear();
  }

  /**
   * Render one frame. `overrides` are transient per-surface patches (used
   * while dragging so the store — and its undo history — is only touched on
   * commit). `renderCtx` carries per-surface live-modulation values
   * (audio level, scale, brightness, hue, density, speed, effect
   * intensity, shader param overrides) to the source stage.
   */
  renderFrame(
    project: Project,
    time: number,
    overrides?: Map<string, Partial<Surface>>,
    renderCtx?: Map<string, SurfaceRenderCtx>,
  ): void {
    if (!this.renderer || !this.scene || !this.camera || this.disposed) return;
    if (this.contextLost) return;
    const surfaces = [...(project.surfaces ?? [])]
      .filter((s) => s.visible)
      .sort((a, b) => (a.z ?? 1) - (b.z ?? 1));
    const activeIds = new Set(surfaces.map((s) => s.id));
    // Remove meshes for surfaces that are gone / hidden.
    for (const [id, rec] of [...this.meshes.entries()]) {
      if (!activeIds.has(id)) {
        this.scene.remove(rec.group);
        disposeSurfaceMesh(rec);
        this.meshes.delete(id);
      }
    }
    for (const raw of surfaces) {
      const patch = overrides?.get(raw.id);
      const surface = patch ? { ...raw, ...patch } : raw;
      const texture = this.sources.getTexture(surface, time, renderCtx?.get(raw.id));
      if (!texture) continue;
      const existing = this.meshes.get(surface.id);
      if (existing) {
        updateSurfaceMesh(existing, surface, texture);
      } else {
        const rec = buildSurfaceMesh(surface, texture);
        this.meshes.set(surface.id, rec);
        this.scene.add(rec.group);
      }
    }
    this.sources.prune(activeIds);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.clearMeshes();
    this.sources.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }
}
