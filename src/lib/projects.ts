// Project persistence (localStorage) + demo project seed.
import type { Project, Scene, Surface } from './types';
import { makeSurface, uid } from './types';

const KEY = 'lazy-lighting-projects-v1';
const ACTIVE_KEY = 'lazy-lighting-active-v1';

export function listProjects(): Project[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Project[]; } catch { return []; }
}
export function saveProject(p: Project) {
  if (typeof window === 'undefined') return;
  const all = listProjects().filter((x) => x.id !== p.id);
  all.unshift({ ...p, updatedAt: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(all));
  localStorage.setItem(ACTIVE_KEY, p.id);
}
export function deleteProject(id: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(listProjects().filter((x) => x.id !== id)));
}
export function getActiveProjectId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function demoProject(): Project {
  const s1: Surface = makeSurface({
    name: 'Main Wall — Tunnel', shape: 'rect',
    corners: [{ x: 0.06, y: 0.1 }, { x: 0.62, y: 0.1 }, { x: 0.62, y: 0.85 }, { x: 0.06, y: 0.85 }],
    content: { kind: 'visual', visualId: 'tunnel', colors: ['#f59e0b', '#06b6d4'], strokes: [], animateWobble: false, depth: 0.5 },
    z: 1,
  });
  const s2: Surface = makeSurface({
    name: 'Neon Circle', shape: 'circle',
    corners: [{ x: 0.68, y: 0.12 }, { x: 0.94, y: 0.12 }, { x: 0.94, y: 0.52 }, { x: 0.68, y: 0.52 }],
    content: { kind: 'visual', visualId: 'neon-rings', colors: ['#e879f9', '#22d3ee'], strokes: [], animateWobble: false, depth: 0.5 },
    z: 2,
  });
  const s3: Surface = makeSurface({
    name: 'Pumpkin Sign', shape: 'text',
    corners: [{ x: 0.68, y: 0.58 }, { x: 0.94, y: 0.58 }, { x: 0.94, y: 0.88 }, { x: 0.68, y: 0.88 }],
    content: { kind: 'visual', visualId: 'pumpkin', text: 'BOO!', colors: ['#f97316', '#fbbf24'], strokes: [], animateWobble: false, depth: 0.5 },
    z: 3,
  });
  const scene1: Scene = { id: uid('scene'), name: 'Opening', duration: 12, surfaces: [s1, s2, s3] };
  const s1b = { ...JSON.parse(JSON.stringify(s1)) as Surface, content: { ...s1.content, visualId: 'aurora' } };
  const s2b = { ...JSON.parse(JSON.stringify(s2)) as Surface, content: { ...s2.content, visualId: 'snowfall' } };
  const scene2: Scene = { id: uid('scene'), name: 'Winter Glow', duration: 12, surfaces: [s1b, s2b, s3] };
  return {
    id: uid('proj'), name: 'Demo — Halloween Night', createdAt: Date.now(), updatedAt: Date.now(),
    surfaces: [s1, s2, s3], scenes: [scene1, scene2], currentSceneId: scene1.id,
    bpm: 120, transition: 'dissolve', transitionDuration: 1,
  };
}

export function seedIfEmpty(): Project {
  const all = listProjects();
  if (all.length > 0) {
    const active = all.find((p) => p.id === getActiveProjectId()) ?? all[0];
    return active;
  }
  const demo = demoProject();
  saveProject(demo);
  return demo;
}
