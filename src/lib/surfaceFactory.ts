// Shared factory for new surfaces (used by ShapeToolbar and by the
// polygon/freeform creation modes in ProjectionCanvas).
import type { Surface } from './schema';
import { uid } from './types';
import { useStudioStore } from './store';

export type SurfaceShape = Surface['shape'];

const SHAPE_NAMES: Record<string, string> = {
  rect: 'Rectangle',
  square: 'Square',
  circle: 'Circle',
  ellipse: 'Ellipse',
  'rounded-rect': 'Rounded Rect',
  polygon: 'Polygon',
  freeform: 'Freeform',
  text: 'Text',
  silhouette: 'Silhouette',
  cube: 'Cube',
  box: 'Box',
  curved: 'Curved Surface',
  freehand: 'Hand-drawn Outline',
};

export function centeredCorners(w = 0.36, h = 0.36): [ { x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number } ] {
  const x0 = (1 - w) / 2;
  const y0 = (1 - h) / 2;
  return [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y0 + h },
    { x: x0, y: y0 + h },
  ];
}

export interface NewSurfaceOpts {
  name?: string;
  corners?: Surface['corners'];
  vertices?: { x: number; y: number }[];
  content?: Partial<Surface['content']>;
  curve?: number;
  visualId?: string;
}

export function makeNewSurface(shape: SurfaceShape, opts: NewSurfaceOpts = {}): Surface {
  const project = useStudioStore.getState().project;
  const maxZ = (project?.surfaces ?? []).reduce((m, s) => Math.max(m, s.z ?? 0), 0);
  const surface = {
    id: uid('surf'),
    name: opts.name ?? SHAPE_NAMES[shape] ?? 'Surface',
    shape,
    corners: opts.corners ?? centeredCorners(),
    content: {
      kind: 'visual',
      visualId: opts.visualId ?? 'aurora',
      ...(opts.content ?? {}),
    },
    opacity: 1,
    visible: true,
    locked: false,
    blendMode: 'normal',
    z: maxZ + 1,
    effects: [],
    ...(opts.vertices ? { vertices: opts.vertices } : {}),
    ...(opts.curve !== undefined ? { curve: opts.curve } : {}),
  } as Surface;
  return surface;
}
