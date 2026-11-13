// Pure homography math — no three.js dependency, unit-testable in Node.
// Stage coordinates are normalized 0..1, y down (top-left origin).
// A "quad" is [TL, TR, BR, BL] in that space.

export interface Pt {
  x: number;
  y: number;
}

export type Quad = [Pt, Pt, Pt, Pt];

/** A 3x3 projective matrix, row-major: m[row][col]. */
export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

export const IDENTITY_H: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export const UNIT_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function solveLinear(a: number[][], b: number[]): number[] | null {
  // Gaussian elimination with partial pivoting. a is n x n, b is n.
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null; // singular
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const div = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) m[r][j] -= factor * m[col][j];
    }
  }
  return m.map((row) => row[n]);
}

/**
 * Compute the homography mapping srcQuad -> dstQuad (both in normalized
 * stage space). Solves the standard 8x8 DLT system with h22 = 1.
 * Returns null when the quads are degenerate (e.g. three collinear points).
 */
export function computeHomography(srcQuad: Pt[], dstQuad: Pt[]): Mat3 | null {
  // Phase 7 fix: the DLT system can be non-singular even when three corners
  // are collinear, and then returns a matrix that sends a corner to
  // infinity (w = 0). Reject any quad with a zero-area corner triple up
  // front, so the documented "null for degenerate quads" contract holds.
  // Callers (engine/surfaces.ts) already treat null as "leave geometry as-is".
  const hasCollinearTriple = (q: Pt[]): boolean => {
    for (let i = 0; i < 4; i++) {
      const a = q[i];
      const b = q[(i + 1) % 4];
      const c = q[(i + 2) % 4];
      const area2 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(area2) < 1e-12) return true;
    }
    return false;
  };
  if (hasCollinearTriple(srcQuad) || hasCollinearTriple(dstQuad)) return null;
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = srcQuad[i];
    const { x: u, y: v } = dstQuad[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(a, b);
  if (!h) return null;
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

/** Apply a homography to a point (with the perspective divide). */
export function applyHomography(m: Mat3, x: number, y: number): Pt {
  const w = m[2][0] * x + m[2][1] * y + m[2][2];
  if (Math.abs(w) < 1e-12) return { x: Number.NaN, y: Number.NaN };
  return {
    x: (m[0][0] * x + m[0][1] * y + m[0][2]) / w,
    y: (m[1][0] * x + m[1][1] * y + m[1][2]) / w,
  };
}

/** Invert a 3x3 matrix (adjugate / determinant). Returns null if singular. */
export function invertHomography(m: Mat3): Mat3 | null {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    [A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

/** Point-in-quad via the two triangles (TL,TR,BR) and (TL,BR,BL). */
export function pointInQuad(p: Pt, quad: Pt[]): boolean {
  const sign = (a: Pt, b: Pt, c: Pt) => (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
  const inTri = (a: Pt, b: Pt, c: Pt) => {
    const d1 = sign(p, a, b);
    const d2 = sign(p, b, c);
    const d3 = sign(p, c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  return inTri(quad[0], quad[1], quad[2]) || inTri(quad[0], quad[2], quad[3]);
}

/** Axis-aligned bounding box of a quad, in normalized stage space. */
export function quadBounds(quad: Pt[]): { x: number; y: number; w: number; h: number } {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/** Point-in-polygon (ray casting), for polygon/freehand hit testing. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
