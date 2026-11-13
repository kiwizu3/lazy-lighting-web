// Mapping templates — each returns a ready-to-open v1 Project.
import type { Project, Surface } from './schema';
import { freshProject } from './schema';
import { uid } from './types';
import { defaultContent } from './types';

function surface(partial: Partial<Surface> & { name: string; shape: Surface['shape']; corners: Surface['corners']; visualId: string; z?: number }): Surface {
  return {
    id: uid('surf'),
    name: partial.name,
    shape: partial.shape,
    corners: partial.corners,
    content: { ...defaultContent(partial.visualId), kind: 'visual', visualId: partial.visualId },
    opacity: 1,
    visible: true,
    locked: false,
    blendMode: 'normal',
    z: partial.z ?? 1,
    effects: [],
    curve: 0,
    mask: { kind: 'none' },
  } as Surface;
}

function withSurfaces(name: string, surfaces: Surface[]): Project {
  const p = freshProject(name);
  p.surfaces = surfaces;
  p.scenes = [{
    id: uid('scene'),
    name: 'Main',
    surfaceIds: surfaces.map((s) => s.id),
    snapshot: surfaces,
    transition: 'dissolve',
    transitionDuration: 1,
  }];
  p.timeline.currentSceneId = p.scenes[0].id;
  return p;
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  build: () => Project;
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'single-wall',
    name: 'Single Wall',
    description: 'One full-wall surface — the fastest way to start projecting on a flat wall.',
    build: () => withSurfaces('Single Wall', [
      surface({
        name: 'Main Wall', shape: 'rect', visualId: 'aurora', z: 1,
        corners: [{ x: 0.05, y: 0.08 }, { x: 0.95, y: 0.08 }, { x: 0.95, y: 0.92 }, { x: 0.05, y: 0.92 }],
      }),
    ]),
  },
  {
    id: 'two-walls-corner',
    name: 'Two Walls / Corner',
    description: 'Two angled walls meeting at a corner — great for rooms and house facades.',
    build: () => withSurfaces('Two Walls / Corner', [
      surface({
        name: 'Left Wall', shape: 'rect', visualId: 'tunnel', z: 1,
        corners: [{ x: 0.04, y: 0.1 }, { x: 0.48, y: 0.06 }, { x: 0.48, y: 0.9 }, { x: 0.04, y: 0.9 }],
      }),
      surface({
        name: 'Right Wall', shape: 'rect', visualId: 'neon-rings', z: 2,
        corners: [{ x: 0.52, y: 0.06 }, { x: 0.96, y: 0.1 }, { x: 0.96, y: 0.9 }, { x: 0.52, y: 0.9 }],
      }),
    ]),
  },
  {
    id: 'window-display',
    name: 'Window Display',
    description: 'A shop-window frame with a circular feature and a text sign.',
    build: () => withSurfaces('Window Display', [
      surface({
        name: 'Window', shape: 'rect', visualId: 'aurora', z: 1,
        corners: [{ x: 0.08, y: 0.1 }, { x: 0.92, y: 0.1 }, { x: 0.92, y: 0.88 }, { x: 0.08, y: 0.88 }],
      }),
      surface({
        name: 'Feature Circle', shape: 'circle', visualId: 'neon-rings', z: 2,
        corners: [{ x: 0.36, y: 0.22 }, { x: 0.64, y: 0.22 }, { x: 0.64, y: 0.62 }, { x: 0.36, y: 0.62 }],
      }),
      surface({
        name: 'Sign', shape: 'text', visualId: 'pumpkin', z: 3,
        corners: [{ x: 0.3, y: 0.68 }, { x: 0.7, y: 0.68 }, { x: 0.7, y: 0.84 }, { x: 0.3, y: 0.84 }],
      }),
    ]),
  },
  {
    id: 'stage-cube',
    name: 'Stage Cube',
    description: 'A cube with three visible faces for stage and installation mapping.',
    build: () => withSurfaces('Stage Cube', [
      surface({
        name: 'Cube — Front', shape: 'cube', visualId: 'tunnel', z: 1,
        corners: [{ x: 0.3, y: 0.3 }, { x: 0.62, y: 0.3 }, { x: 0.62, y: 0.78 }, { x: 0.3, y: 0.78 }],
      }),
      surface({
        name: 'Cube — Top', shape: 'cube', visualId: 'aurora', z: 2,
        corners: [{ x: 0.38, y: 0.14 }, { x: 0.7, y: 0.14 }, { x: 0.62, y: 0.3 }, { x: 0.3, y: 0.3 }],
      }),
      surface({
        name: 'Cube — Side', shape: 'cube', visualId: 'neon-rings', z: 3,
        corners: [{ x: 0.62, y: 0.3 }, { x: 0.7, y: 0.14 }, { x: 0.7, y: 0.62 }, { x: 0.62, y: 0.78 }],
      }),
    ]),
  },
];

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
