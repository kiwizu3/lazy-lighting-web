// IndexedDB persistence (raw indexedDB API, no extra dep).
// DB "lazy-lighting-db": store "projects" (keyPath: id, full Project records)
// and store "media" (keyPath: id, { id, name, type, blob, createdAt }).
import type { Project } from './schema';
import { migrateProject } from './schema';
import { uid } from './types';

const DB_NAME = 'lazy-lighting-db';
const DB_VERSION = 1;
const PROJECTS_STORE = 'projects';
const MEDIA_STORE = 'media';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  thumbnail?: string;
  surfaceCount: number;
  sceneCount: number;
}

export interface MediaRecord {
  id: string;
  name: string;
  type: string; // MIME type, e.g. image/png, video/mp4
  blob: Blob;
  createdAt: number;
}

export interface MediaMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let done = false;
        const finish = (fn: () => void) => { if (!done) { done = true; fn(); } };
        try {
          const t = db.transaction(store, mode);
          const req = run(t.objectStore(store));
          req.onsuccess = () => finish(() => { resolve(req.result); db.close(); });
          req.onerror = () => finish(() => { reject(req.error ?? new Error('IndexedDB request failed')); db.close(); });
          t.onabort = () => finish(() => { reject(t.error ?? new Error('IndexedDB transaction aborted')); db.close(); });
        } catch (err) {
          finish(() => { reject(err instanceof Error ? err : new Error(String(err))); db.close(); });
        }
      }),
  );
}

function toMeta(p: Project): ProjectMeta {
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    thumbnail: p.thumbnail,
    surfaceCount: p.surfaces.length,
    sceneCount: p.scenes.length,
  };
}

export async function saveProject(project: Project): Promise<void> {
  try {
    await tx(PROJECTS_STORE, 'readwrite', (s) =>
      s.put({ ...project, updatedAt: Date.now() }),
    );
  } catch (err) {
    console.warn('[db] saveProject failed', err);
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  try {
    const raw = await tx<unknown>(PROJECTS_STORE, 'readonly', (s) => s.get(id));
    if (!raw) return null;
    return migrateProject(raw);
  } catch (err) {
    console.warn('[db] loadProject failed', err);
    return null;
  }
}

export async function listProjects(): Promise<ProjectMeta[]> {
  try {
    const all = await tx<unknown[]>(PROJECTS_STORE, 'readonly', (s) => s.getAll());
    return (all as Project[])
      .map((p) => { try { return toMeta(migrateProject(p)); } catch { return null; } })
      .filter((m): m is ProjectMeta => m !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.warn('[db] listProjects failed', err);
    return [];
  }
}

export async function deleteProject(id: string): Promise<void> {
  try {
    await tx(PROJECTS_STORE, 'readwrite', (s) => s.delete(id));
  } catch (err) {
    console.warn('[db] deleteProject failed', err);
  }
}

export async function duplicateProject(id: string): Promise<Project | null> {
  try {
    const original = await loadProject(id);
    if (!original) return null;
    const copy: Project = {
      ...JSON.parse(JSON.stringify(original)) as Project,
      id: uid('proj'),
      name: `${original.name} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveProject(copy);
    return copy;
  } catch (err) {
    console.warn('[db] duplicateProject failed', err);
    return null;
  }
}

export async function saveMediaBlob(file: File | Blob, name?: string): Promise<MediaRecord | null> {
  try {
    const record: MediaRecord = {
      id: uid('media'),
      name: name ?? (file instanceof File ? file.name : 'media'),
      type: file.type || 'application/octet-stream',
      blob: file,
      createdAt: Date.now(),
    };
    await tx(MEDIA_STORE, 'readwrite', (s) => s.put(record));
    return record;
  } catch (err) {
    console.warn('[db] saveMediaBlob failed', err);
    return null;
  }
}

export async function getMediaBlob(id: string): Promise<MediaRecord | null> {
  try {
    const rec = await tx<MediaRecord | undefined>(MEDIA_STORE, 'readonly', (s) => s.get(id));
    return rec ?? null;
  } catch (err) {
    console.warn('[db] getMediaBlob failed', err);
    return null;
  }
}

export async function listMedia(): Promise<MediaMeta[]> {
  try {
    const all = await tx<MediaRecord[]>(MEDIA_STORE, 'readonly', (s) => s.getAll());
    return all
      .map((r) => ({ id: r.id, name: r.name, type: r.type, size: r.blob?.size ?? 0, createdAt: r.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.warn('[db] listMedia failed', err);
    return [];
  }
}

export async function deleteMediaBlob(id: string): Promise<void> {
  try {
    await tx(MEDIA_STORE, 'readwrite', (s) => s.delete(id));
  } catch (err) {
    console.warn('[db] deleteMediaBlob failed', err);
  }
}

/** Clear all projects (used by Settings "Clear local data"). Media is kept. */
export async function clearAllProjects(): Promise<void> {
  try {
    await tx(PROJECTS_STORE, 'readwrite', (s) => s.clear());
  } catch (err) {
    console.warn('[db] clearAllProjects failed', err);
  }
}

/** Seed the "Demo — Halloween Night" project if IndexedDB has no projects. */
export async function seedDemoIfEmpty(): Promise<Project | null> {
  try {
    const existing = await listProjects();
    if (existing.length > 0) return null;
    const { demoV1Project } = await import('./schema');
    const demo = demoV1Project();
    await saveProject(demo);
    return demo;
  } catch (err) {
    console.warn('[db] seedDemoIfEmpty failed', err);
    return null;
  }
}
