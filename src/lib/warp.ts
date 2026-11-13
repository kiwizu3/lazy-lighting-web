// Warp math: point-in-quad hit test + horizontal-slice perspective warp.
import type { Pt } from './types';

export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export function lerpPt(a: Pt, b: Pt, t: number): Pt { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }; }

/** Point-in-quad via two triangles (TL,TR,BR) and (TL,BR,BL). */
export function pointInQuad(p: Pt, quad: [Pt, Pt, Pt, Pt]): boolean {
  const sign = (a: Pt, b: Pt, c: Pt) => (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
  const inTri = (a: Pt, b: Pt, c: Pt) => {
    const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  return inTri(quad[0], quad[1], quad[2]) || inTri(quad[0], quad[2], quad[3]);
}

/**
 * Draw src canvas onto ctx warped to quad (normalized coords -> pixels via W/H),
 * using N horizontal strips and a curve (edge bend -1..1) that bows the
 * left/right edges outward/inward.
 */
export function drawWarped(
  ctx: CanvasRenderingContext2D, src: HTMLCanvasElement,
  quad: [Pt, Pt, Pt, Pt], W: number, H: number, curve = 0, strips = 32,
) {
  const px = (p: Pt): Pt => ({ x: p.x * W, y: p.y * H });
  const [tl, tr, br, bl] = quad.map(px);
  const sw = src.width / strips;
  for (let i = 0; i < strips; i++) {
    const t0 = i / strips, t1 = (i + 1) / strips;
    // curve offset: bow applied perpendicular-ish (vertical shift) peaking mid-strip
    const bend = (tt: number) => Math.sin(tt * Math.PI) * curve * 24;
    const top0 = lerpPt(tl, tr, t0), top1 = lerpPt(tl, tr, t1);
    const bot0 = lerpPt(bl, br, t0), bot1 = lerpPt(bl, br, t1);
    top0.y += bend(t0); top1.y += bend(t1); bot0.y += bend(t0); bot1.y += bend(t1);
    const dx = top1.x - top0.x, dy = top1.y - top0.y;
    const dw = Math.hypot(dx, dy);
    const dh = Math.hypot(bot0.x - top0.x, bot0.y - top0.y);
    if (dw < 1 || dh < 1) continue;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(top0.x, top0.y); ctx.lineTo(top1.x, top1.y); ctx.lineTo(bot1.x, bot1.y); ctx.lineTo(bot0.x, bot0.y); ctx.closePath();
    ctx.clip();
    const angle = Math.atan2(dy, dx);
    ctx.translate(top0.x, top0.y); ctx.rotate(angle);
    // source strip -> dest rect (dw wide, dh tall), slight overlap to avoid seams
    ctx.drawImage(src, i * sw, 0, sw + 1, src.height, 0, 0, dw + 1, dh);
    ctx.restore();
  }
}

/** Clip path for a shape inside an offscreen canvas of size w x h. */
export function clipShapePath(ctx: CanvasRenderingContext2D, shape: string, w: number, h: number, points?: Pt[], mask: string = 'none') {
  ctx.beginPath();
  if (shape === 'circle' || mask === 'circle') {
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (mask === 'rounded') {
    const r = Math.min(w, h) * 0.18;
    ctx.roundRect(0, 0, w, h, r);
  } else if (shape === 'freehand' || shape === 'silhouette') {
    const pts = points && points.length >= 3 ? points : defaultBlobPoints();
    pts.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x * w, p.y * h) : ctx.lineTo(p.x * w, p.y * h); });
    ctx.closePath();
  } else if (mask === 'cutout') {
    ctx.rect(0, 0, w, h);
    ctx.moveTo(w * 0.3, h * 0.3); ctx.lineTo(w * 0.7, h * 0.3); ctx.lineTo(w * 0.7, h * 0.7); ctx.lineTo(w * 0.3, h * 0.7); ctx.closePath();
  } else {
    ctx.rect(0, 0, w, h);
  }
  ctx.clip();
}

export function defaultBlobPoints(): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2; const r = 0.32 + (i % 2 ? 0.14 : 0.06);
    pts.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r * 0.8 });
  }
  return pts;
}

export function defaultSilhouettePoints(): Pt[] {
  // A simple house / arch silhouette
  return [
    { x: 0.5, y: 0.05 }, { x: 0.85, y: 0.3 }, { x: 0.85, y: 0.95 },
    { x: 0.6, y: 0.95 }, { x: 0.6, y: 0.65 }, { x: 0.4, y: 0.65 },
    { x: 0.4, y: 0.95 }, { x: 0.15, y: 0.95 }, { x: 0.15, y: 0.3 },
  ];
}
