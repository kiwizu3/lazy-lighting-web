// Versioned project format (v1) — Zod schemas + migration from v0.
// Kept deliberately loose (passthrough / optional fields) so later phases can
// extend surfaces, effects and timeline entries without a format bump.
import { z } from 'zod';
import { demoProject } from './projects';
import type { Project as V0Project, Surface as V0Surface } from './types';
import { uid } from './types';

export const CURRENT_FORMAT_VERSION = 1;

export const PtSchema = z.object({ x: z.number(), y: z.number() });

export const ShapeSchema = z.enum([
  'rect', 'square', 'circle', 'ellipse', 'rounded-rect', 'polygon',
  'freeform', 'text', 'silhouette', 'cube', 'box', 'curved', 'freehand',
]);

export const ContentKindSchema = z.enum(['visual', 'image', 'video', 'camera', 'draw', 'depth']);

// Effect entries are open-ended: { type, ...params }. Later phases add
// typed effect kinds; unknown ones round-trip untouched.
export const EffectSchema = z.object({ type: z.string() }).passthrough();

export const MaskSchema = z
  .object({ kind: z.string(), params: z.record(z.string(), z.unknown()).optional() })
  .passthrough();

export const SurfaceContentSchema = z
  .object({
    kind: ContentKindSchema,
    visualId: z.string().optional(),
    mediaId: z.string().optional(),
    text: z.string().optional(),
  })
  .passthrough();

export const SurfaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    shape: ShapeSchema,
    corners: z.array(PtSchema).length(4),
    vertices: z.array(PtSchema).optional(),
    content: SurfaceContentSchema,
    opacity: z.number().min(0).max(1).default(1),
    visible: z.boolean().default(true),
    locked: z.boolean().default(false),
    blendMode: z.string().default('normal'),
    z: z.number().default(1),
    effects: z.array(EffectSchema).default([]),
    mask: MaskSchema.optional(),
  })
  .passthrough();

export const SceneSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    // Either a list of surface ids (live surfaces) or an embedded snapshot.
    surfaceIds: z.array(z.string()).default([]),
    snapshot: z.array(SurfaceSchema).optional(),
    transition: z.enum(['cut', 'fade', 'dissolve', 'crossfade']).default('dissolve'),
    transitionDuration: z.number().default(1),
  })
  .passthrough();

export const TimelineClipSchema = z
  .object({
    id: z.string(),
    trackId: z.string(),
    start: z.number().min(0),
    duration: z.number().min(0.1),
    label: z.string().default(''),
    sceneId: z.string().optional(),
    mediaId: z.string().optional(),
    speed: z.number().min(0.1).max(4).default(1),
  })
  .passthrough();

export const TimelineKeyframeSchema = z
  .object({
    id: z.string(),
    time: z.number().min(0),
    param: z.string(),
    value: z.number(),
    surfaceId: z.string().optional(),
  })
  .passthrough();

export const TimelineTrackSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['video', 'image', 'audio', 'animation', 'effect']),
    name: z.string(),
    clips: z.array(TimelineClipSchema).default([]),
    keyframes: z.array(TimelineKeyframeSchema).default([]),
  })
  .passthrough();

export const TimelineSchema = z
  .object({
    bpm: z.number().default(120),
    currentSceneId: z.string().optional(),
    duration: z.number().min(1).default(60),
    loop: z.boolean().default(true),
    bpmSync: z.boolean().default(false),
    tracks: z.array(TimelineTrackSchema).default([]),
  })
  .passthrough();

export const AudioTrackSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    mediaId: z.string().optional(),
    url: z.string().optional(),
    trimStart: z.number().min(0).default(0),
    trimEnd: z.number().min(0).optional(),
    volume: z.number().min(0).max(1).default(1),
  })
  .passthrough();

export const SettingsSchema = z.object({
  quality: z.enum(['performance', 'balanced', 'high']).default('balanced'),
  grid: z.boolean().default(true),
  snap: z.boolean().default(true),
  aspect: z.enum(['16:9', '4:3', '21:9', 'custom']).default('16:9'),
  customAspectWidth: z.number().min(1).default(16),
  customAspectHeight: z.number().min(1).default(9),
});

export const ProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    version: z.number().default(CURRENT_FORMAT_VERSION),
    createdAt: z.number(),
    updatedAt: z.number(),
    thumbnail: z.string().optional(),
    canvas: z.object({ width: z.number(), height: z.number() }).default({ width: 1920, height: 1080 }),
    surfaces: z.array(SurfaceSchema).default([]),
    scenes: z.array(SceneSchema).default([]),
    timeline: TimelineSchema.default({ bpm: 120 }),
    audioTracks: z.array(AudioTrackSchema).default([]),
    settings: SettingsSchema.default({ quality: 'balanced', grid: true, snap: true }),
  })
  .passthrough();

export type Project = z.infer<typeof ProjectSchema>;
export type Surface = z.infer<typeof SurfaceSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Timeline = z.infer<typeof TimelineSchema>;
export type TimelineClip = z.infer<typeof TimelineClipSchema>;
export type TimelineKeyframe = z.infer<typeof TimelineKeyframeSchema>;
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>;
export type TimelineTrackKind = TimelineTrack['kind'];
export type AudioTrack = z.infer<typeof AudioTrackSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Effect = z.infer<typeof EffectSchema>;

export function freshProject(name = 'Untitled Project'): Project {
  const now = Date.now();
  return {
    id: uid('proj'),
    name,
    version: CURRENT_FORMAT_VERSION,
    createdAt: now,
    updatedAt: now,
    canvas: { width: 1920, height: 1080 },
    surfaces: [],
    scenes: [],
    timeline: { bpm: 120, duration: 60, loop: true, bpmSync: false, tracks: [] },
    audioTracks: [],
    settings: { quality: 'balanced', grid: true, snap: true, aspect: '16:9', customAspectWidth: 16, customAspectHeight: 9 },
  };
}

function migrateV0Surface(s: V0Surface): Surface {
  const effects: Effect[] = s.effects
    ? [{ type: 'legacy', ...(s.effects as unknown as Record<string, unknown>) }]
    : [];
  return {
    id: s.id,
    name: s.name,
    shape: (['rect', 'circle', 'text', 'cube', 'silhouette', 'freehand'].includes(s.shape)
      ? s.shape
      : 'rect') as Surface['shape'],
    corners: (s.corners ?? [
      { x: 0.1, y: 0.15 }, { x: 0.55, y: 0.15 }, { x: 0.55, y: 0.75 }, { x: 0.1, y: 0.75 },
    ]) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
    vertices: s.points,
    content: { ...(s.content as unknown as Record<string, unknown>), kind: s.content?.kind ?? 'visual' } as Surface['content'],
    opacity: s.opacity ?? 1,
    visible: s.visible ?? true,
    locked: false,
    blendMode: 'normal',
    z: s.z ?? 1,
    effects,
    ...(s.mask && s.mask !== 'none' ? { mask: { kind: s.mask } } : {}),
    // Preserve v0-only fields for the v1 Studio via passthrough.
    curve: (s as unknown as Record<string, unknown>).curve ?? 0,
  } as Surface;
}

function migrateV0Project(p: V0Project): Project {
  const surfaces = (p.surfaces ?? []).map(migrateV0Surface);
  const scenes: Scene[] = (p.scenes ?? []).map((sc) => ({
    id: sc.id,
    name: sc.name,
    surfaceIds: (sc.surfaces ?? []).map((s) => s.id),
    snapshot: (sc.surfaces ?? []).map(migrateV0Surface),
    transition: (p.transition === 'fade' || p.transition === 'dissolve' ? p.transition : 'dissolve') as Scene['transition'],
    transitionDuration: p.transitionDuration ?? 1,
    duration: sc.duration,
  }));
  const now = Date.now();
  return {
    id: p.id ?? uid('proj'),
    name: p.name ?? 'Untitled Project',
    version: CURRENT_FORMAT_VERSION,
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? now,
    canvas: { width: 1920, height: 1080 },
    surfaces,
    scenes,
    timeline: { bpm: p.bpm ?? 120, currentSceneId: p.currentSceneId, duration: 60, loop: true, bpmSync: false, tracks: [] },
    audioTracks: p.audioTrackName ? [{ id: uid('audio'), name: p.audioTrackName, trimStart: 0, volume: 1 }] : [],
    settings: { quality: 'balanced', grid: true, snap: true, aspect: '16:9', customAspectWidth: 16, customAspectHeight: 9 },
  };
}

/**
 * Upgrade any input to a v1 Project. Never throws: on unrecognised / bad
 * input it returns a fresh demo project ("Demo — Halloween Night").
 */
export function migrateProject(data: unknown): Project {
  try {
    if (!data || typeof data !== 'object') throw new Error('not an object');
    const raw = data as Record<string, unknown>;

    // Already v1 (or newer): validate, fill defaults.
    if (typeof raw.version === 'number' && raw.version >= 1) {
      const parsed = ProjectSchema.safeParse(raw);
      if (parsed.success) return { ...parsed.data, version: CURRENT_FORMAT_VERSION };
    }

    // v0 localStorage shape: has surfaces/scenes arrays, no version field.
    if (Array.isArray(raw.surfaces) || Array.isArray(raw.scenes)) {
      return migrateV0Project(raw as unknown as V0Project);
    }

    throw new Error('unrecognised project shape');
  } catch {
    try {
      return migrateV0Project(demoProject());
    } catch {
      return freshProject('Demo — Halloween Night');
    }
  }
}

export function demoV1Project(): Project {
  return migrateV0Project(demoProject());
}
