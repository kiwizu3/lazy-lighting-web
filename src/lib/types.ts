// Shared types for Lazy Lighting Web
export type ShapeKind = 'rect' | 'circle' | 'text' | 'cube' | 'silhouette' | 'freehand';
export type ContentKind = 'visual' | 'image' | 'video' | 'camera' | 'draw' | 'depth';

export interface Pt { x: number; y: number } // normalized 0..1

export interface Stroke { points: Pt[]; color: string; size: number }

export interface Effects {
  blur: number; brightness: number; contrast: number; saturate: number;
  hue: number; invert: number; grayscale: number;
  zoom: number; rotate: number; // rotate degrees, zoom 0.5..3
  kaleidoSegments: number; // 0 = off, else 2..12
  tileX: number; tileY: number; slideSpeed: number; colorCycle: number; // 0..1, 0=off
}

export interface SurfaceContent {
  kind: ContentKind;
  visualId: string;
  imageDataUrl?: string;
  videoObjectUrl?: string;
  videoName?: string;
  text?: string;
  colors: [string, string];
  strokes: Stroke[];
  animateWobble: boolean;
  depth: number; // 0..1 depth-mode strength
}

export interface Surface {
  id: string;
  name: string;
  shape: ShapeKind;
  corners: [Pt, Pt, Pt, Pt]; // TL, TR, BR, BL normalized
  points?: Pt[]; // outline polygon for freehand / silhouette
  content: SurfaceContent;
  opacity: number; // 0..1
  visible: boolean;
  z: number;
  curve: number; // -1..1 edge bend
  mask: 'none' | 'circle' | 'rounded' | 'cutout';
  effects: Effects;
}

export interface Scene {
  id: string;
  name: string;
  duration: number; // seconds
  surfaces: Surface[];
}

export type TransitionType = 'fade' | 'dissolve' | 'cut';

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  surfaces: Surface[];
  scenes: Scene[];
  currentSceneId: string;
  bpm: number;
  transition: TransitionType;
  transitionDuration: number; // seconds
  audioTrackName?: string;
  audioTrimStart?: number;
  audioTrimEnd?: number;
}

export const defaultEffects = (): Effects => ({
  blur: 0, brightness: 100, contrast: 100, saturate: 100,
  hue: 0, invert: 0, grayscale: 0,
  zoom: 1, rotate: 0,
  kaleidoSegments: 0, tileX: 1, tileY: 1, slideSpeed: 0, colorCycle: 0,
});

export const defaultContent = (visualId = 'aurora'): SurfaceContent => ({
  kind: 'visual', visualId, colors: ['#f59e0b', '#06b6d4'], strokes: [], animateWobble: false, depth: 0.5,
});

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export function makeSurface(partial: Partial<Surface> & { shape: ShapeKind }): Surface {
  const base: Surface = {
    id: uid('surf'), name: 'Surface', shape: partial.shape,
    corners: [{ x: 0.1, y: 0.15 }, { x: 0.55, y: 0.15 }, { x: 0.55, y: 0.75 }, { x: 0.1, y: 0.75 }],
    content: defaultContent(), opacity: 1, visible: true, z: 1, curve: 0, mask: 'none', effects: defaultEffects(),
  };
  Object.assign(base, partial);
  return base;
}

export function cloneSurface(s: Surface): Surface {
  return JSON.parse(JSON.stringify(s)) as Surface;
}
