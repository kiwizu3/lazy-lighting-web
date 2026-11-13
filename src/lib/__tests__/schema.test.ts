// Project migration (v0 localStorage shape -> v1) — pure, no IndexedDB.
import { describe, expect, it } from 'vitest';
import {
  CURRENT_FORMAT_VERSION,
  freshProject,
  migrateProject,
  ProjectSchema,
} from '../schema';
import { demoProject } from '../projects';

describe('migrateProject', () => {
  it('upgrades a v0 localStorage-shaped project to v1, preserving surfaces and scenes', () => {
    const v0 = demoProject();
    const v1 = migrateProject(v0);
    expect(v1.version).toBe(CURRENT_FORMAT_VERSION);
    expect(v1.name).toBe('Demo — Halloween Night');
    expect(v1.surfaces).toHaveLength(3);
    expect(v1.scenes).toHaveLength(2);
    expect(v1.scenes[0].name).toBe('Opening');
    expect(v1.scenes[1].name).toBe('Winter Glow');
    // Surface content survives the migration.
    expect(v1.surfaces[0].content.visualId).toBe('tunnel');
    expect(v1.surfaces[1].content.visualId).toBe('neon-rings');
    expect(v1.surfaces[2].content.text).toBe('BOO!');
    // Scene snapshots are preserved so switching restores them.
    expect(v1.scenes[0].snapshot).toHaveLength(3);
    expect(v1.scenes[1].snapshot).toHaveLength(3);
    expect(v1.scenes[1].snapshot![0].content.visualId).toBe('aurora');
    // Result validates against the v1 schema.
    expect(ProjectSchema.safeParse(v1).success).toBe(true);
  });

  it('upgrades a minimal hand-built v0 project', () => {
    const v0 = {
      id: 'proj_custom',
      name: 'Custom v0',
      createdAt: 1000,
      updatedAt: 2000,
      surfaces: [
        {
          id: 'surf_1',
          name: 'Wall',
          shape: 'rect',
          corners: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
          content: { kind: 'visual', visualId: 'aurora' },
          opacity: 0.5,
          visible: true,
          z: 1,
          mask: 'none',
          effects: {},
        },
      ],
      scenes: [],
      currentSceneId: '',
      bpm: 100,
      transition: 'fade',
      transitionDuration: 2,
    };
    const v1 = migrateProject(v0);
    expect(v1.version).toBe(1);
    expect(v1.name).toBe('Custom v0');
    expect(v1.surfaces).toHaveLength(1);
    expect(v1.surfaces[0].opacity).toBe(0.5);
    expect(v1.timeline.bpm).toBe(100);
    expect(v1.scenes).toHaveLength(0);
    expect(ProjectSchema.safeParse(v1).success).toBe(true);
  });

  it('passes an already-v1 project through, filling defaults', () => {
    const p = freshProject('V1 Project');
    const out = migrateProject(p);
    expect(out.id).toBe(p.id);
    expect(out.name).toBe('V1 Project');
    expect(out.version).toBe(CURRENT_FORMAT_VERSION);
    expect(ProjectSchema.safeParse(out).success).toBe(true);
  });

  it.each([undefined, null, 42, 'not a project', true, [], {}, { version: 'x' }])(
    'never throws on garbage input (%s) and returns a valid v1 project',
    (input) => {
      let out;
      expect(() => {
        out = migrateProject(input);
      }).not.toThrow();
      expect(out!.version).toBe(CURRENT_FORMAT_VERSION);
      expect(typeof out!.id).toBe('string');
      expect(Array.isArray(out!.surfaces)).toBe(true);
      expect(Array.isArray(out!.scenes)).toBe(true);
      expect(ProjectSchema.safeParse(out).success).toBe(true);
    },
  );

  it('returns the demo project for unrecognised input', () => {
    const out = migrateProject({ hello: 'world' });
    expect(out.name).toBe('Demo — Halloween Night');
    expect(out.surfaces.length).toBeGreaterThan(0);
  });
});
