// Procedural visuals — all drawn with Canvas 2D, no external assets.
// Each visual: { id, name, category, draw(ctx, w, h, t, opts) }
export type VisualCategory = 'Gradient' | 'Tunnel' | 'Neon' | 'Generative' | 'VJ' | 'Halloween' | 'Christmas' | 'Depth';
export interface VisualOpts { audioLevel: number; hueShift: number; speed: number; colors: [string, string] }
export interface Visual { id: string; name: string; category: VisualCategory; draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, o: VisualOpts) => void }

function grad(ctx: CanvasRenderingContext2D, w: number, h: number, c1: string, c2: string, angle = 0): CanvasGradient {
  const x = Math.cos(angle) * w, y = Math.sin(angle) * h;
  const g = ctx.createLinearGradient(w / 2 - x / 2, h / 2 - y / 2, w / 2 + x / 2, h / 2 + y / 2);
  g.addColorStop(0, c1); g.addColorStop(1, c2); return g;
}
function bg(ctx: CanvasRenderingContext2D, w: number, h: number, c: string) { ctx.fillStyle = c; ctx.fillRect(0, 0, w, h); }
function rnd(seed: number) { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function hsl(h: number, s = 80, l = 55) { return `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`; }

const V = (id: string, name: string, category: VisualCategory, draw: Visual['draw']): Visual => ({ id, name, category, draw });

export const VISUALS: Visual[] = [
  V('aurora', 'Aurora', 'Gradient', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#04121a');
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, h * (0.3 + i * 0.15));
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, h * (0.3 + i * 0.15) + Math.sin(x / 90 + t * o.speed + i * 1.7) * 34 * (1 + o.audioLevel));
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = i % 2 ? 'rgba(6,182,212,0.35)' : 'rgba(34,197,94,0.30)';
      ctx.fill();
    }
  }),
  V('sunset', 'Sunset', 'Gradient', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, '#f97316', '#7c2d12', Math.PI / 2); ctx.fillRect(0, 0, w, h);
    const cy = h * 0.62, r = Math.min(w, h) * (0.22 + o.audioLevel * 0.06);
    ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(w / 2, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 4; i++) ctx.fillRect(0, cy + i * 14, w, 5);
    ctx.fillStyle = '#1c0a00'; ctx.fillRect(0, h * 0.82, w, h * 0.18);
  }),
  V('lava', 'Lava Flow', 'Gradient', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, '#7f1d1d', '#f97316', t * 0.1); ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(253,230,138,${0.25 + rnd(i) * 0.4})`;
      ctx.beginPath(); ctx.ellipse(rnd(i) * w, (rnd(i * 3) * h + t * 12 * o.speed) % h, 30 + rnd(i * 7) * 60, 10 + rnd(i * 5) * 18, rnd(i) * 3, 0, Math.PI * 2); ctx.fill();
    }
  }),
  V('ocean', 'Ocean', 'Gradient', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, '#0c4a6e', '#06b6d4', Math.PI / 2); ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    for (let r = 0; r < 6; r++) { ctx.beginPath(); for (let x = 0; x <= w; x += 12) { const y = h * (0.15 + r * 0.14) + Math.sin(x / 70 + t * o.speed + r) * 12; x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
  }),
  V('plasma', 'Plasma', 'Generative', (ctx, w, h, t, o) => {
    const img = ctx.createImageData(w, h); const d = img.data; const tt = t * o.speed;
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
      const v = Math.sin(x / 60 + tt) + Math.sin(y / 50 - tt * 1.3) + Math.sin((x + y) / 70 + tt * 0.7);
      const hue = (v * 40 + t * 20 + o.hueShift) % 360;
      const [r, g, b] = hslToRgb(hue, 0.8, 0.5 + o.audioLevel * 0.15);
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) { const i = ((y + dy) * w + (x + dx)) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
    }
    ctx.putImageData(img, 0, 0);
  }),
  V('waves', 'Waves', 'Generative', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#020617');
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = hsl(i * 60 + t * 30 + o.hueShift, 90, 60); ctx.lineWidth = 3; ctx.beginPath();
      for (let x = 0; x <= w; x += 8) { const y = h / 2 + Math.sin(x / 80 + t * o.speed * 2 + i) * (30 + i * 14) * (1 + o.audioLevel); x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }),
  V('particles', 'Particles', 'Generative', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#050505');
    for (let i = 0; i < 90; i++) {
      const px = (rnd(i) * w + t * (10 + rnd(i * 2) * 40) * o.speed) % w;
      const py = (rnd(i * 3) * h + Math.sin(t + i) * 12) % h;
      ctx.fillStyle = hsl(rnd(i * 5) * 360 + o.hueShift, 90, 60 + o.audioLevel * 25);
      ctx.beginPath(); ctx.arc(px, py, 1.5 + rnd(i * 7) * 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }),
  V('rings', 'Rings', 'Generative', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000');
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 9; i++) {
      const r = ((t * 60 * o.speed + i * 46) % (Math.max(w, h) * 0.9));
      ctx.strokeStyle = hsl(i * 40 + t * 40 + o.hueShift, 90, 60); ctx.lineWidth = 3;
      ctx.globalAlpha = Math.max(0, 1 - r / (Math.max(w, h) * 0.9));
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }),
  V('tunnel', 'Tunnel', 'Tunnel', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000');
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 14; i++) {
      const p = ((i / 14 + t * 0.25 * o.speed) % 1);
      const r = Math.pow(p, 2.2) * Math.max(w, h) * 0.75;
      ctx.strokeStyle = hsl(p * 300 + o.hueShift, 95, 55 + o.audioLevel * 20); ctx.lineWidth = 2 + p * 5;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
  }),
  V('grid', 'Grid Pulse', 'VJ', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#020617');
    const s = 44; ctx.strokeStyle = 'rgba(34,211,238,0.7)'; ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += s) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += s) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (let i = 0; i < 12; i++) { ctx.fillStyle = hsl(i * 30 + t * 60, 90, 60); const gx = Math.floor(rnd(i + Math.floor(t * 2)) * (w / s)) * s, gy = Math.floor(rnd(i * 3 + Math.floor(t * 2)) * (h / s)) * s; ctx.fillRect(gx, gy, s, s); }
  }),
  V('scanlines', 'Scanlines', 'VJ', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, o.colors[0], o.colors[1], t * 0.2); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
    const yb = (t * 120 * o.speed) % h; ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, yb, w, 10);
  }),
  V('kaleidoscope', 'Kaleidoscope', 'VJ', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000'); const cx = w / 2, cy = h / 2; const segs = 8;
    for (let s = 0; s < segs; s++) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate((s / segs) * Math.PI * 2 + t * 0.2 * o.speed);
      for (let i = 0; i < 5; i++) { ctx.fillStyle = hsl(i * 72 + t * 50 + o.hueShift, 90, 60); ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 40 + i * 34 + o.audioLevel * 30, i * 0.5, i * 0.5 + 0.7); ctx.fill(); }
      ctx.restore();
    }
  }),
  V('neon-rings', 'Neon Rings', 'Neon', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#05010d');
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = hsl(300 + i * 12 + o.hueShift, 100, 60); ctx.lineWidth = 5; ctx.shadowColor = ctx.strokeStyle as string; ctx.shadowBlur = 22;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 30 + i * 26 + Math.sin(t * 2 * o.speed + i) * 8, t * o.speed + i, t * o.speed + i + Math.PI * 1.5); ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }),
  V('starfield', 'Starfield', 'Generative', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000');
    for (let i = 0; i < 160; i++) {
      const z = rnd(i * 3); const px = (rnd(i) - 0.5) * w / (z + 0.1) + w / 2; const py = (rnd(i * 7) - 0.5) * h / (z + 0.1) + h / 2;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + i));
      ctx.fillStyle = `rgba(255,255,255,${tw})`; ctx.fillRect(px, py, 1 + (1 - z) * 2, 1 + (1 - z) * 2);
    }
  }),
  V('fire', 'Fire', 'Generative', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, '#450a0a', '#000', Math.PI / 2); ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const fx = w / 2 + (rnd(i) - 0.5) * w * 0.5; const fy = h - ((t * (40 + rnd(i * 2) * 80) * o.speed + rnd(i * 5) * h) % h);
      const r = 8 + rnd(i * 3) * 22 * (fy / h + 0.3);
      ctx.fillStyle = `rgba(249,${Math.floor(100 + rnd(i) * 80)},20,${0.5 * (fy / h)})`;
      ctx.beginPath(); ctx.arc(fx + Math.sin(t * 3 + i) * 8, fy, r, 0, Math.PI * 2); ctx.fill();
    }
  }),
  V('smoke', 'Smoke', 'Generative', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#0f172a');
    for (let i = 0; i < 18; i++) {
      const x = (rnd(i) * w + Math.sin(t * 0.4 * o.speed + i) * 40) % w; const y = (rnd(i * 4) * h + t * 8 * o.speed) % h;
      ctx.fillStyle = `rgba(148,163,184,${0.10 + rnd(i * 2) * 0.12})`;
      ctx.beginPath(); ctx.arc(x, y, 40 + rnd(i * 6) * 70, 0, Math.PI * 2); ctx.fill();
    }
  }),
  V('equalizer', 'Equalizer Bars', 'VJ', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000');
    const n = 24, bw = w / n;
    for (let i = 0; i < n; i++) {
      const v = 0.25 + 0.75 * Math.abs(Math.sin(t * 4 * o.speed + i * 0.7)) * (0.4 + o.audioLevel);
      const bh = v * h * 0.9;
      ctx.fillStyle = hsl(i * 12 + o.hueShift, 95, 55); ctx.fillRect(i * bw + 2, h - bh, bw - 4, bh);
    }
  }),
  V('spiral', 'Spiral', 'Tunnel', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000'); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 14; a += 0.12) { const r = a * 4 * (1 + o.audioLevel * 0.3); const x = w / 2 + Math.cos(a + t * o.speed) * r; const y = h / 2 + Math.sin(a + t * o.speed) * r; a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.strokeStyle = hsl(t * 60 + o.hueShift, 90, 60); ctx.stroke();
  }),
  V('checker-pulse', 'Checker Pulse', 'VJ', (ctx, w, h, t, o) => {
    const s = 56; const pulse = 0.5 + 0.5 * Math.sin(t * 3 * o.speed);
    for (let y = 0; y < h / s + 1; y++) for (let x = 0; x < w / s + 1; x++) {
      ctx.fillStyle = (x + y) % 2 ? hsl(200 + o.hueShift, 80, 20 + pulse * 30) : hsl(20 + o.hueShift, 90, 45 + pulse * 20);
      ctx.fillRect(x * s, y * s, s, s);
    }
  }),
  V('neon-grid', 'Neon Grid', 'Neon', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#0a0014');
    ctx.strokeStyle = '#e879f9'; ctx.shadowColor = '#e879f9'; ctx.shadowBlur = 14; ctx.lineWidth = 2;
    const horizon = h * 0.45;
    for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * 30, horizon); ctx.lineTo(w / 2 + i * 90, h); ctx.stroke(); }
    for (let i = 0; i < 8; i++) { const y = horizon + Math.pow(i / 8, 1.8) * (h - horizon); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#f0abfc'; ctx.beginPath(); ctx.arc(w / 2, h * 0.28, 34 + o.audioLevel * 10, 0, Math.PI * 2); ctx.fill();
  }),
  V('bubbles', 'Bubbles', 'Generative', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, '#082f49', '#0e7490', Math.PI / 2); ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) {
      const x = (rnd(i) * w + Math.sin(t + i) * 10) % w; const y = h - ((t * (20 + rnd(i * 2) * 50) * o.speed + rnd(i * 3) * h) % h);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 4 + rnd(i * 5) * 16, 0, Math.PI * 2); ctx.stroke();
    }
  }),
  V('mandala', 'Mandala', 'Generative', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#111827'); const cx = w / 2, cy = h / 2;
    for (let s = 0; s < 12; s++) { ctx.save(); ctx.translate(cx, cy); ctx.rotate((s / 12) * Math.PI * 2 + t * 0.15 * o.speed); ctx.strokeStyle = hsl(s * 30 + o.hueShift, 85, 60); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 50 + o.audioLevel * 20, 14, 44, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  }),
  V('rain', 'Rain', 'VJ', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#0c1222');
    ctx.strokeStyle = 'rgba(147,197,253,0.8)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 90; i++) { const x = (rnd(i) * w + t * 30) % w; const y = (rnd(i * 3) * h + t * 300 * o.speed) % h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 16); ctx.stroke(); }
  }),
  V('matrix', 'Matrix Rain', 'VJ', (ctx, w, h, t, o) => {
    bg(ctx, w, h, 'rgba(0,0,0,0.92)');
    ctx.font = '14px monospace';
    for (let i = 0; i < 40; i++) { const x = i * (w / 40); const y = (rnd(i) * h + t * 120 * o.speed) % h; ctx.fillStyle = i % 5 ? '#22c55e' : '#a7f3d0'; ctx.fillText(String.fromCharCode(33 + Math.floor(rnd(i + Math.floor(t * 4)) * 90)), x, y); }
  }),
  V('orbit', 'Orbit', 'Generative', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000');
    for (let i = 0; i < 6; i++) { const a = t * o.speed * (0.6 + i * 0.2) + i; ctx.fillStyle = hsl(i * 60 + o.hueShift, 90, 60); ctx.beginPath(); ctx.arc(w / 2 + Math.cos(a) * (40 + i * 22), h / 2 + Math.sin(a) * (40 + i * 22), 6 + o.audioLevel * 6, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 120, 0, Math.PI * 2); ctx.stroke();
  }),
  V('confetti', 'Confetti', 'VJ', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#111827');
    for (let i = 0; i < 80; i++) { const x = (rnd(i) * w + Math.sin(t + i) * 20) % w; const y = (rnd(i * 3) * h + t * (40 + rnd(i * 2) * 60) * o.speed) % h; ctx.fillStyle = hsl(rnd(i * 5) * 360 + o.hueShift, 90, 60); ctx.save(); ctx.translate(x, y); ctx.rotate(t + i); ctx.fillRect(-4, -2, 8, 4); ctx.restore(); }
  }),
  V('laser', 'Laser Show', 'Neon', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000');
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = hsl(i * 60 + t * 80 + o.hueShift, 100, 60); ctx.lineWidth = 2; ctx.shadowColor = ctx.strokeStyle as string; ctx.shadowBlur = 16;
      const y0 = h * (0.2 + i * 0.12); ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0 + Math.sin(t * 3 * o.speed + i * 2) * 60 * (1 + o.audioLevel)); ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }),
  V('vortex', 'Vortex', 'Tunnel', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000'); const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 60; i++) { const a = i * 0.35 + t * o.speed; const r = i * 3.2; ctx.fillStyle = hsl(i * 6 + t * 40 + o.hueShift, 90, 55); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3 + o.audioLevel * 3, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('glitch', 'Glitch', 'VJ', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, '#312e81', '#be185d', t); ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 10; i++) { const y = rnd(i + Math.floor(t * 8)) * h; const sh = (rnd(i * 3) - 0.5) * 60; ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd(i) * 0.2})`; ctx.fillRect(sh, y, w * 0.7, 8 + rnd(i * 7) * 20); }
  }),
  V('sunburst', 'Sunburst', 'Generative', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#1c1917'); const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 24; i++) { ctx.fillStyle = i % 2 ? '#f59e0b' : '#fbbf24'; ctx.save(); ctx.translate(cx, cy); ctx.rotate((i / 24) * Math.PI * 2 + t * 0.1 * o.speed); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.max(w, h), -20); ctx.lineTo(Math.max(w, h), 20); ctx.fill(); ctx.restore(); }
    ctx.fillStyle = '#fff7ed'; ctx.beginPath(); ctx.arc(cx, cy, 40 + o.audioLevel * 20, 0, Math.PI * 2); ctx.fill();
  }),
  // ---- Halloween ----
  V('pumpkin', 'Pumpkin Glow', 'Halloween', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#1a0b00');
    ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.58, w * 0.3, h * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ea580c'; for (const dx of [-0.14, 0, 0.14]) { ctx.beginPath(); ctx.ellipse(w / 2 + dx * w, h * 0.58, w * 0.09, h * 0.32, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#166534'; ctx.fillRect(w / 2 - 6, h * 0.2, 12, h * 0.12);
    ctx.fillStyle = `rgba(253,224,71,${0.7 + 0.3 * Math.sin(t * 3)})`;
    // eyes + grin
    ctx.beginPath(); ctx.moveTo(w * 0.38, h * 0.5); ctx.lineTo(w * 0.44, h * 0.44); ctx.lineTo(w * 0.46, h * 0.52); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w * 0.62, h * 0.5); ctx.lineTo(w * 0.56, h * 0.44); ctx.lineTo(w * 0.54, h * 0.52); ctx.fill();
    ctx.beginPath(); ctx.arc(w / 2, h * 0.62, w * 0.12, 0.15 * Math.PI, 0.85 * Math.PI); ctx.lineWidth = 8; ctx.strokeStyle = ctx.fillStyle as string; ctx.stroke();
  }),
  V('ghost', 'Ghost Float', 'Halloween', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#0f172a');
    const gy = h * 0.45 + Math.sin(t * 2 * o.speed) * 16;
    ctx.fillStyle = 'rgba(226,232,240,0.95)';
    ctx.beginPath(); ctx.arc(w / 2, gy, 60, Math.PI, 0); ctx.lineTo(w / 2 + 60, gy + 90);
    for (let i = 0; i < 4; i++) ctx.arc(w / 2 + 60 - (i + 0.5) * 30, gy + 90, 15, 0, Math.PI);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.arc(w / 2 - 20, gy - 5, 8, 0, Math.PI * 2); ctx.arc(w / 2 + 20, gy - 5, 8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w / 2, gy + 22, 10, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#cbd5e1'; for (let i = 0; i < 30; i++) { ctx.beginPath(); ctx.arc(rnd(i) * w, rnd(i * 3) * h, 1.5, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('bats', 'Bats', 'Halloween', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, '#312e81', '#0f172a', Math.PI / 2); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(w * 0.78, h * 0.25, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0f172a';
    for (let i = 0; i < 7; i++) {
      const bx = (rnd(i) * w + t * (20 + i * 6) * o.speed) % w; const by = h * (0.15 + rnd(i * 3) * 0.5) + Math.sin(t * 4 + i) * 10; const flap = Math.sin(t * 10 + i) * 8; const s = 14 + rnd(i * 5) * 10;
      ctx.beginPath(); ctx.moveTo(bx - s, by); ctx.quadraticCurveTo(bx - s / 2, by - s - flap, bx, by); ctx.quadraticCurveTo(bx + s / 2, by - s - flap, bx + s, by); ctx.quadraticCurveTo(bx + s / 2, by + 6, bx, by); ctx.quadraticCurveTo(bx - s / 2, by + 6, bx - s, by); ctx.fill();
    }
  }),
  V('spiderweb', 'Spiderweb', 'Halloween', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#111827');
    ctx.strokeStyle = 'rgba(226,232,240,0.75)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * w, Math.sin(a) * h); ctx.stroke(); }
    for (let r = 1; r <= 6; r++) { ctx.beginPath(); for (let i = 0; i <= 9; i++) { const a = (i / 9) * Math.PI * 2; const rr = r * 26; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
    ctx.fillStyle = '#0f172a'; const sx = w * 0.7, sy = h * 0.55; ctx.beginPath(); ctx.arc(sx, sy, 12 + o.audioLevel * 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a) * 24, sy + Math.sin(a) * 24); ctx.stroke(); }
  }),
  V('haunted-fog', 'Haunted Fog', 'Halloween', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#052e16');
    for (let i = 0; i < 16; i++) { const x = (rnd(i) * w + t * 14 * o.speed) % w; const y = h * 0.7 + Math.sin(t + i) * 12; ctx.fillStyle = `rgba(163,230,53,${0.06 + rnd(i) * 0.08})`; ctx.beginPath(); ctx.arc(x, y, 50 + rnd(i * 2) * 80, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#052e16'; ctx.beginPath(); ctx.moveTo(w * 0.5, h); ctx.lineTo(w * 0.5, h * 0.4); ctx.lineTo(w * 0.62, h * 0.55); ctx.lineTo(w * 0.56, h); ctx.fill();
    ctx.fillStyle = '#a3e635'; ctx.beginPath(); ctx.arc(w * 0.2, h * 0.2, 8, 0, Math.PI * 2); ctx.arc(w * 0.32, h * 0.16, 6, 0, Math.PI * 2); ctx.fill();
  }),
  V('candy-corn', 'Candy Corn', 'Halloween', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#1c1917');
    for (let i = 0; i < 6; i++) {
      const x = w * (0.12 + i * 0.15); const y = h * 0.55 + Math.sin(t * 2 + i) * 8; const s = 1 + o.audioLevel * 0.15;
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(30, 30); ctx.lineTo(-30, 30); ctx.fill();
      ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(18, 2); ctx.lineTo(-18, 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(9, -22); ctx.lineTo(-9, -22); ctx.fill();
      ctx.restore();
    }
  }),
  V('jack-glow', 'Jack-o\'-Lantern Glow', 'Halloween', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000');
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.5 * o.speed);
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.6);
    g.addColorStop(0, `rgba(249,115,22,${0.7 + pulse * 0.3})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f97316'; ctx.font = `bold ${Math.floor(h * 0.5)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🎃', w / 2, h / 2);
  }),
  V('eerie-green', 'Eerie Green', 'Halloween', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#022c22');
    for (let i = 0; i < 5; i++) { ctx.strokeStyle = hsl(140 + o.hueShift, 90, 45 + i * 6); ctx.lineWidth = 3; ctx.beginPath(); for (let x = 0; x <= w; x += 10) { const y = h * (0.2 + i * 0.16) + Math.sin(x / 50 + t * o.speed + i * 2) * 18; x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
    ctx.fillStyle = 'rgba(163,230,53,0.8)'; for (let i = 0; i < 20; i++) { ctx.beginPath(); ctx.arc((rnd(i) * w + t * 10) % w, rnd(i * 3) * h, 2 + rnd(i) * 3, 0, Math.PI * 2); ctx.fill(); }
  }),
  // ---- Christmas ----
  V('snowfall', 'Snowfall', 'Christmas', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, '#0c4a6e', '#1e3a5f', Math.PI / 2); ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) { const x = (rnd(i) * w + Math.sin(t * 0.7 + i) * 16) % w; const y = (rnd(i * 3) * h + t * (30 + rnd(i * 2) * 50) * o.speed) % h; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(x, y, 1 + rnd(i * 5) * 2.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#e0f2fe'; ctx.fillRect(0, h * 0.9, w, h * 0.1);
  }),
  V('christmas-tree', 'Christmas Tree', 'Christmas', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#052e16');
    ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.moveTo(w / 2, h * 0.08); ctx.lineTo(w / 2 + 14, h * 0.16); ctx.lineTo(w / 2 - 14, h * 0.16); ctx.fill();
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i % 2 ? '#15803d' : '#166534'; const tw = w * (0.18 + i * 0.1); ctx.beginPath(); ctx.moveTo(w / 2, h * (0.18 + i * 0.2)); ctx.lineTo(w / 2 - tw, h * (0.38 + i * 0.2)); ctx.lineTo(w / 2 + tw, h * (0.38 + i * 0.2)); ctx.fill(); }
    ctx.fillStyle = '#78350f'; ctx.fillRect(w / 2 - 12, h * 0.86, 24, h * 0.08);
    for (let i = 0; i < 24; i++) { ctx.fillStyle = hsl(rnd(i) * 360, 90, 60 + 20 * Math.sin(t * 4 + i)); ctx.beginPath(); ctx.arc(w / 2 + (rnd(i * 2) - 0.5) * w * (0.3 + rnd(i) * 0.2), h * (0.25 + rnd(i * 3) * 0.55), 3 + o.audioLevel * 2, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('fairy-lights', 'Fairy Lights', 'Christmas', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#020617');
    for (let row = 0; row < 4; row++) {
      const y0 = h * (0.15 + row * 0.22); ctx.strokeStyle = 'rgba(148,163,184,0.6)'; ctx.beginPath(); ctx.moveTo(0, y0); ctx.quadraticCurveTo(w / 2, y0 + 40, w, y0); ctx.stroke();
      for (let i = 0; i < 14; i++) { const x = (i / 13) * w; const y = y0 + 40 * 4 * (x / w) * (1 - x / w); ctx.fillStyle = hsl((i * 40 + t * 100 + row * 80) % 360, 95, 60); ctx.shadowColor = ctx.fillStyle as string; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(x, y + 6, 4 + o.audioLevel * 2, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.shadowBlur = 0;
  }),
  V('candy-cane', 'Candy Cane', 'Christmas', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#7f1d1d');
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.4 + Math.sin(t * o.speed) * 0.05);
    for (let i = -6; i < 6; i++) { ctx.fillStyle = i % 2 ? '#dc2626' : '#fef2f2'; ctx.fillRect(-30, i * 30, 60, 30); }
    ctx.fillStyle = '#fef2f2'; ctx.beginPath(); ctx.arc(0, -190, 30, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; for (let i = 0; i < 40; i++) { ctx.beginPath(); ctx.arc((rnd(i) * w + t * 8) % w, rnd(i * 3) * h, 2, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('fireplace', 'Fireplace', 'Christmas', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#450a0a');
    ctx.fillStyle = '#78350f'; ctx.fillRect(w * 0.1, h * 0.2, w * 0.8, h * 0.7);
    ctx.fillStyle = '#1c0a00'; ctx.fillRect(w * 0.3, h * 0.45, w * 0.4, h * 0.45);
    for (let i = 0; i < 24; i++) { const fx = w * 0.5 + (rnd(i) - 0.5) * w * 0.25; const fy = h * 0.88 - ((t * (30 + rnd(i) * 60) * o.speed + rnd(i * 3) * h * 0.3) % (h * 0.35)); ctx.fillStyle = `rgba(251,146,60,${0.7})`; ctx.beginPath(); ctx.arc(fx, fy, 6 + rnd(i * 5) * 14, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#166534'; ctx.fillRect(w * 0.08, h * 0.14, w * 0.84, 10);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = hsl(i * 50, 90, 60); ctx.beginPath(); ctx.arc(w * (0.2 + i * 0.15), h * 0.12, 5, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('snow-aurora', 'Snow Aurora', 'Christmas', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#082f49');
    for (let i = 0; i < 3; i++) { ctx.fillStyle = `rgba(103,232,249,${0.2})`; ctx.beginPath(); ctx.moveTo(0, h * (0.25 + i * 0.12)); for (let x = 0; x <= w; x += 16) ctx.lineTo(x, h * (0.25 + i * 0.12) + Math.sin(x / 80 + t + i) * 30); ctx.lineTo(w, 0); ctx.lineTo(0, 0); ctx.fill(); }
    for (let i = 0; i < 80; i++) { const x = (rnd(i) * w) % w; const y = (rnd(i * 3) * h + t * 40 * o.speed) % h; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('ornaments', 'Ornaments', 'Christmas', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#111827');
    for (let i = 0; i < 8; i++) { const x = w * (0.1 + i * 0.11); const y = h * (0.3 + rnd(i * 2) * 0.2); ctx.strokeStyle = '#9ca3af'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, y - 26); ctx.stroke(); ctx.fillStyle = hsl(i * 45 + o.hueShift, 85, 55); ctx.beginPath(); ctx.arc(x, y, 24 + Math.sin(t * 2 + i) * 3 + o.audioLevel * 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(x - 8, y - 8, 6, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('reindeer', 'Reindeer Silhouette', 'Christmas', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, '#1e3a5f', '#0f172a', Math.PI / 2); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(w * 0.8, h * 0.22, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#020617';
    // simple reindeer silhouette: body, neck/head, legs, antlers
    ctx.beginPath(); ctx.ellipse(w * 0.45, h * 0.62, w * 0.16, h * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w * 0.62, h * 0.5, w * 0.06, h * 0.12, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.66, h * 0.36, w * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#020617'; ctx.lineWidth = 6;
    for (const [ax, ay] of [[0.63, 0.3], [0.69, 0.3]] as const) { ctx.beginPath(); ctx.moveTo(w * ax, h * ay); ctx.lineTo(w * (ax - 0.03), h * (ay - 0.12)); ctx.moveTo(w * ax, h * ay); ctx.lineTo(w * (ax + 0.04), h * (ay - 0.1)); ctx.stroke(); }
    for (const lx of [0.35, 0.42, 0.52, 0.58]) { ctx.beginPath(); ctx.moveTo(w * lx, h * 0.7); ctx.lineTo(w * lx, h * 0.92); ctx.stroke(); }
    ctx.fillStyle = '#e0f2fe'; ctx.fillRect(0, h * 0.92, w, h * 0.08);
  }),
  V('gift-boxes', 'Gift Boxes', 'Christmas', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#7f1d1d');
    const cols = ['#dc2626', '#059669', '#2563eb', '#d97706'];
    for (let i = 0; i < 5; i++) { const x = w * (0.08 + i * 0.18); const s = 50 + rnd(i) * 30; const y = h * 0.75 - s + Math.sin(t * 2 + i) * 4; ctx.fillStyle = cols[i % 4]; ctx.fillRect(x, y, s, s); ctx.fillStyle = '#fde047'; ctx.fillRect(x + s / 2 - 4, y, 8, s); ctx.fillRect(x, y + s / 2 - 4, s, 8); }
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 30; i++) { ctx.beginPath(); ctx.arc(rnd(i) * w, rnd(i * 3) * h * 0.5, 2, 0, Math.PI * 2); ctx.fill(); }
  }),
  // ---- Depth / extra ----
  V('depth-slices', 'Depth Slices', 'Depth', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#0f172a');
    for (let i = 0; i < 8; i++) { const off = Math.sin(t * o.speed + i) * 14 * (1 + o.audioLevel); ctx.fillStyle = hsl(i * 45 + o.hueShift, 85, 50); ctx.fillRect(20 + i * 12 + off, 30 + i * 14, w - 60 - i * 20, h - 80 - i * 20); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.strokeRect(20 + i * 12 + off, 30 + i * 14, w - 60 - i * 20, h - 80 - i * 20); }
  }),
  V('parallax-dots', 'Parallax Dots', 'Depth', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#020617');
    for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 24; i++) { const x = (rnd(i + layer * 50) * w + Math.sin(t * (0.5 + layer * 0.4)) * (20 + layer * 30)) % w; const y = rnd(i * 3 + layer) * h; ctx.fillStyle = hsl(layer * 120 + o.hueShift, 90, 55 + layer * 10); ctx.beginPath(); ctx.arc(x, y, 3 + layer * 3, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('neon-sign', 'Neon Sign', 'Neon', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#0a0a0a');
    ctx.font = `bold ${Math.floor(h * 0.22)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#22d3ee'; ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 24 + o.audioLevel * 20;
    ctx.fillText('LAZY', w / 2, h * 0.4); ctx.fillStyle = '#f472b6'; ctx.shadowColor = '#f472b6'; ctx.fillText('LIGHT', w / 2, h * 0.68); ctx.shadowBlur = 0;
  }),
  V('city-lights', 'City Lights', 'VJ', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#020617');
    for (let i = 0; i < 18; i++) { const bw = 20 + rnd(i * 2) * 30; const bh = h * (0.2 + rnd(i * 3) * 0.5); const x = i * (w / 18); ctx.fillStyle = '#0f172a'; ctx.fillRect(x, h - bh, bw, bh); ctx.fillStyle = Math.sin(t * 3 + i) > 0 ? '#fde047' : '#334155'; for (let wy = 0; wy < 3; wy++) ctx.fillRect(x + 4, h - bh + 8 + wy * 18, 6, 8); }
  }),
  V('aurora-borealis', 'Aurora Borealis', 'Gradient', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#020617');
    for (let i = 0; i < 3; i++) { ctx.fillStyle = `rgba(${i === 0 ? '34,197,94' : i === 1 ? '168,85,247' : '34,211,238'},0.28)`; ctx.beginPath(); ctx.moveTo(0, h * (0.2 + i * 0.1)); for (let x = 0; x <= w; x += 16) ctx.lineTo(x, h * (0.2 + i * 0.1) + Math.sin(x / 70 + t * o.speed + i * 2) * 40); ctx.lineTo(w, h * 0.5); ctx.lineTo(0, h * 0.5); ctx.fill(); }
    ctx.fillStyle = '#fff'; for (let i = 0; i < 60; i++) { ctx.beginPath(); ctx.arc(rnd(i) * w, rnd(i * 3) * h * 0.4, 1, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('electric', 'Electric Storm', 'Neon', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#0f172a');
    for (let i = 0; i < 4; i++) { ctx.strokeStyle = hsl(200 + i * 20 + o.hueShift, 100, 65); ctx.lineWidth = 2; ctx.shadowColor = ctx.strokeStyle as string; ctx.shadowBlur = 12; ctx.beginPath(); let x = rnd(i) * w; let y = 0; ctx.moveTo(x, y); while (y < h) { x += (rnd(Math.floor(y) + i) - 0.5) * 60; y += 20; ctx.lineTo(x, y); } ctx.stroke(); }
    ctx.shadowBlur = 0;
  }),
  V('waves-neon', 'Neon Waves', 'Neon', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000');
    for (let i = 0; i < 4; i++) { ctx.strokeStyle = hsl(i * 90 + t * 50 + o.hueShift, 100, 60); ctx.lineWidth = 4; ctx.shadowBlur = 18; ctx.shadowColor = ctx.strokeStyle as string; ctx.beginPath(); for (let x = 0; x <= w; x += 8) { const y = h / 2 + Math.sin(x / 60 + t * 2 * o.speed + i * 1.5) * 40; x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
    ctx.shadowBlur = 0;
  }),
  V('hyperspace', 'Hyperspace', 'Tunnel', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000'); const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 120; i++) { const a = rnd(i) * Math.PI * 2; const r0 = rnd(i * 3) * 60; const r = r0 + ((t * 200 * o.speed + i * 7) % 300); if (r > 320) continue; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, r / 200)})`; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r - 18), cy + Math.sin(a) * (r - 18)); ctx.lineTo(x, y); ctx.stroke(); }
  }),
  V('blob', 'Blob', 'Generative', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#111827');
    ctx.fillStyle = hsl(t * 30 + o.hueShift, 85, 55);
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.2) { const r = 70 + Math.sin(a * 3 + t * 2 * o.speed) * 24 * (1 + o.audioLevel) + Math.cos(a * 5 - t) * 12; const x = w / 2 + Math.cos(a) * r; const y = h / 2 + Math.sin(a) * r; a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.fill();
  }),
  V('prism', 'Prism', 'Generative', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#000');
    for (let i = 0; i < 6; i++) { ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate((i / 6) * Math.PI * 2 + t * 0.2 * o.speed); ctx.fillStyle = hsl(i * 60 + o.hueShift, 90, 55); ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(160, -40); ctx.lineTo(160, 40); ctx.fill(); ctx.restore(); }
    ctx.globalAlpha = 1;
  }),
  V('dna', 'DNA Helix', 'Generative', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#020617');
    for (let x = 0; x < w; x += 14) { const y1 = h / 2 + Math.sin(x / 40 + t * 2 * o.speed) * 60; const y2 = h / 2 - Math.sin(x / 40 + t * 2 * o.speed) * 60; ctx.strokeStyle = 'rgba(148,163,184,0.5)'; ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke(); ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(x, y1, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#f472b6'; ctx.beginPath(); ctx.arc(x, y2, 4, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('candle', 'Candle Glow', 'Christmas', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#1c1917');
    const g = ctx.createRadialGradient(w / 2, h * 0.4, 4, w / 2, h * 0.4, 120);
    g.addColorStop(0, 'rgba(253,224,71,0.9)'); g.addColorStop(1, 'rgba(253,224,71,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.38, 12 + Math.sin(t * 8) * 2, 26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fef3c7'; ctx.fillRect(w / 2 - 22, h * 0.55, 44, h * 0.3);
  }),
  V('sleigh', 'Sleigh Ride', 'Christmas', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, '#1e3a5f', '#0f172a', Math.PI / 2); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(w * 0.85, h * 0.2, 28, 0, Math.PI * 2); ctx.fill();
    const sx = (t * 40 * o.speed) % (w + 200) - 100;
    ctx.fillStyle = '#7f1d1d'; ctx.beginPath(); ctx.moveTo(sx, h * 0.6); ctx.lineTo(sx + 90, h * 0.6); ctx.lineTo(sx + 70, h * 0.75); ctx.lineTo(sx + 10, h * 0.75); ctx.fill();
    ctx.fillStyle = '#fff'; for (let i = 0; i < 60; i++) { ctx.beginPath(); ctx.arc((rnd(i) * w + t * 20) % w, (rnd(i * 3) * h + t * 30 * o.speed) % h, 1.5, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('witch-hat', 'Witch Hat', 'Halloween', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#1e1b4b');
    ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(w * 0.8, h * 0.2, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.moveTo(w / 2, h * 0.15); ctx.lineTo(w * 0.68, h * 0.7); ctx.lineTo(w * 0.32, h * 0.7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.72, w * 0.32, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7c3aed'; ctx.fillRect(w * 0.38, h * 0.58, w * 0.24, 18);
  }),
  V('cauldron', 'Cauldron Brew', 'Halloween', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#0f172a');
    ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.65, w * 0.28, h * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 10; i++) { const bx = w / 2 + (rnd(i) - 0.5) * w * 0.3; const by = h * 0.5 - ((t * (20 + rnd(i) * 40) * o.speed + rnd(i * 3) * 60) % 90); ctx.fillStyle = `rgba(34,197,94,${0.5})`; ctx.beginPath(); ctx.arc(bx, by, 8 + rnd(i * 5) * 14, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.5, w * 0.2, 16, 0, 0, Math.PI * 2); ctx.fill();
  }),
  V('mistletoe', 'Mistletoe', 'Christmas', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#052e16');
    ctx.strokeStyle = '#166534'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h * 0.4); ctx.stroke();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.fillStyle = '#15803d'; ctx.beginPath(); ctx.ellipse(w / 2 + Math.cos(a) * 70, h * 0.45 + Math.sin(a) * 50, 34, 16, a, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#fca5a5'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(w / 2 - 20 + i * 20, h * 0.55, 9, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('snowman', 'Snowman', 'Christmas', (ctx, w, h, t, o) => {
    ctx.fillStyle = grad(ctx, w, h, '#0c4a6e', '#1e3a5f', Math.PI / 2); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath(); ctx.arc(w / 2, h * 0.72, 62, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w / 2, h * 0.48, 46, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w / 2, h * 0.3, 32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.arc(w / 2 - 11, h * 0.28, 4, 0, Math.PI * 2); ctx.arc(w / 2 + 11, h * 0.28, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.moveTo(w / 2, h * 0.32); ctx.lineTo(w / 2 + 34, h * 0.34); ctx.lineTo(w / 2, h * 0.37); ctx.fill();
    ctx.fillStyle = '#111827'; ctx.fillRect(w / 2 - 26, h * 0.12, 52, 10); ctx.fillRect(w / 2 - 18, h * 0.02, 36, 14);
    ctx.fillStyle = '#fff'; for (let i = 0; i < 50; i++) { ctx.beginPath(); ctx.arc((rnd(i) * w + t * 12) % w, (rnd(i * 3) * h + t * 30 * o.speed) % h, 1.5, 0, Math.PI * 2); ctx.fill(); }
  }),
  V('moon', 'Full Moon', 'Halloween', (ctx, w, h, t, o) => {
    bg(ctx, w, h, '#0f172a');
    ctx.fillStyle = '#fef9c3'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 90 + o.audioLevel * 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(w / 2 + (rnd(i) - 0.5) * 110, h / 2 + (rnd(i * 3) - 0.5) * 110, 10 + rnd(i * 5) * 14, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.moveTo(w * 0.15, h * 0.95); ctx.lineTo(w * 0.3, h * 0.6); ctx.lineTo(w * 0.45, h * 0.95); ctx.fill();
  }),
];

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360; const c = (1 - Math.abs(2 * l - 1)) * s; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export const VISUAL_CATEGORIES: VisualCategory[] = ['Gradient', 'Tunnel', 'Neon', 'Generative', 'VJ', 'Halloween', 'Christmas', 'Depth'];
export function getVisual(id: string): Visual { return VISUALS.find((v) => v.id === id) ?? VISUALS[0]; }
