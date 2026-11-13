// Homography math — pure, hardware-free.
import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  computeHomography,
  IDENTITY_H,
  invertHomography,
  pointInQuad,
  quadBounds,
  UNIT_QUAD,
  type Pt,
} from '../homography';

const EPS = 1e-9;
const approx = (a: Pt, b: Pt, eps = EPS) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

const SKEWED: [Pt, Pt, Pt, Pt] = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.2 },
  { x: 0.8, y: 0.9 },
  { x: 0.2, y: 0.8 },
];

describe('computeHomography', () => {
  it('maps all 4 corners of a skewed quad exactly', () => {
    const h = computeHomography(UNIT_QUAD, SKEWED);
    expect(h).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(approx(applyHomography(h!, UNIT_QUAD[i].x, UNIT_QUAD[i].y), SKEWED[i], 1e-9)).toBe(true);
    }
  });

  it('maps the centre of a parallelogram to the average of its corners', () => {
    const para: [Pt, Pt, Pt, Pt] = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.8, y: 0.9 },
      { x: 0.0, y: 0.9 },
    ];
    const h = computeHomography(UNIT_QUAD, para);
    expect(h).not.toBeNull();
    const centre = applyHomography(h!, 0.5, 0.5);
    // Parallelogram centre = mean of corners = (0.45, 0.5).
    expect(approx(centre, { x: 0.45, y: 0.5 }, 1e-9)).toBe(true);
  });

  it('maps the centre of a skewed quad inside that quad', () => {
    const h = computeHomography(UNIT_QUAD, SKEWED);
    expect(h).not.toBeNull();
    const centre = applyHomography(h!, 0.5, 0.5);
    expect(Number.isFinite(centre.x) && Number.isFinite(centre.y)).toBe(true);
    expect(pointInQuad(centre, SKEWED)).toBe(true);
  });

  it('is the identity for unit quad -> unit quad', () => {
    const h = computeHomography(UNIT_QUAD, UNIT_QUAD);
    expect(h).not.toBeNull();
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(h![r][c] - IDENTITY_H[r][c])).toBeLessThan(1e-12);
      }
    }
    expect(approx(applyHomography(IDENTITY_H, 0.3, 0.7), { x: 0.3, y: 0.7 })).toBe(true);
  });

  it('returns null for a degenerate destination quad (three collinear points)', () => {
    const degenerate: [Pt, Pt, Pt, Pt] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(computeHomography(UNIT_QUAD, degenerate)).toBeNull();
  });

  it('returns null for a degenerate source quad', () => {
    const degenerate: [Pt, Pt, Pt, Pt] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(computeHomography(degenerate, UNIT_QUAD)).toBeNull();
  });

  it('returns null when all four points coincide', () => {
    const point: [Pt, Pt, Pt, Pt] = [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ];
    expect(computeHomography(UNIT_QUAD, point)).toBeNull();
  });
});

describe('invertHomography', () => {
  it('round-trips points through H and H^-1', () => {
    const h = computeHomography(UNIT_QUAD, SKEWED)!;
    const inv = invertHomography(h);
    expect(inv).not.toBeNull();
    for (const [x, y] of [[0, 0], [1, 0], [0.5, 0.5], [0.2, 0.8], [1, 1]] as const) {
      const fwd = applyHomography(h, x, y);
      const back = applyHomography(inv!, fwd.x, fwd.y);
      expect(approx(back, { x, y }, 1e-8)).toBe(true);
    }
  });

  it('inverts the identity to the identity', () => {
    const inv = invertHomography(IDENTITY_H);
    expect(inv).not.toBeNull();
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(inv![r][c] - IDENTITY_H[r][c])).toBeLessThan(1e-12);
      }
    }
  });

  it('returns null for a singular matrix', () => {
    expect(
      invertHomography([
        [1, 2, 3],
        [2, 4, 6],
        [0, 0, 1],
      ]),
    ).toBeNull();
  });
});

describe('pointInQuad / quadBounds', () => {
  it('classifies inside, outside and corner points', () => {
    expect(pointInQuad({ x: 0.5, y: 0.5 }, SKEWED)).toBe(true);
    expect(pointInQuad({ x: 0.05, y: 0.05 }, SKEWED)).toBe(false);
    expect(pointInQuad({ x: 0.1, y: 0.1 }, SKEWED)).toBe(true);
  });

  it('computes the axis-aligned bounds of a quad', () => {
    expect(quadBounds(SKEWED)).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  });
});
