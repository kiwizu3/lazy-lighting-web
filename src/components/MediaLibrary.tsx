// Media library panel (Phase 3, Phase 5: engine-side media resolver) —
// usable on /library and later in the studio sidebar (Phase 5 wires it in).
// Media blobs persist in IndexedDB via db.ts; nothing here is stored on a
// server.
//
// Honest limits surfaced in the UI, not hidden:
// - Images and video are resolved from IndexedDB by mediaId at render time,
//   so assignments survive a reload without embedding (small images are
//   still embedded as data URLs as a fast path; the resolver is the fallback
//   and the source of truth after reload).
// - Video honours the stored loop + playback speed on the surface.
// - 'audio' is NOT a surface content kind in the schema (writing it
//   would fail project validation), so audio is assigned as the project's
//   audio track instead of to a surface.
// - Renaming re-saves the blob under a new id (db.ts has no rename) and
//   rewrites any surface/audio-track references in the open project.
'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Image as ImageIcon, Music, Pencil, Play, Search, Trash2, Upload, Video as VideoIcon } from 'lucide-react';
import { deleteMediaBlob, getMediaBlob, listMedia, saveMediaBlob, type MediaMeta } from '../lib/db';
import {
  formatBytes, formatDuration, generateThumbnail, isDrawingRecord, mediaKind,
  probeDuration, validateFile, IMAGE_DATA_URL_MAX_BYTES, fileToDataUrl, type MediaKind,
} from '../lib/media';
import { loadDrawingAsset, toEngineStrokes } from '../lib/drawing';
import { useStudioStore } from '../lib/store';
import type { Surface } from '../lib/schema';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Slider } from './ui/slider';
import { Dialog } from './ui/dialog';

type TypeFilter = 'all' | MediaKind;

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'draw', label: 'Drawings' },
];

function kindOf(meta: MediaMeta): MediaKind | null {
  if (isDrawingRecord(meta)) return 'draw';
  return mediaKind({ type: meta.type, name: meta.name });
}

function kindBadge(kind: MediaKind | null): string {
  switch (kind) {
    case 'image': return 'IMG';
    case 'video': return 'VID';
    case 'audio': return 'AUD';
    case 'draw': return 'DRAW';
    default: return 'FILE';
  }
}

interface MediaLibraryProps {
  /** Called when the user asks to edit a saved drawing asset. */
  onEditDrawing?: (mediaId: string) => void;
  showAssign?: boolean;
}

export default function MediaLibrary({ onEditDrawing, showAssign = true }: MediaLibraryProps) {
  const project = useStudioStore((s) => s.project);
  const selectedSurfaceId = useStudioStore((s) => s.selectedSurfaceId);
  const updateSurface = useStudioStore((s) => s.updateSurface);
  const [media, setMedia] = useState<MediaMeta[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDrawPng, setPreviewDrawPng] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<MediaMeta | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MediaMeta | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<MediaMeta | null>(null);
  const [fit, setFit] = useState<'cover' | 'contain' | 'fill'>('cover');
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [position, setPosition] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const thumbsRef = useRef<Record<string, string>>({});
  thumbsRef.current = thumbs;

  const selectedSurface = project?.surfaces.find((s) => s.id === selectedSurfaceId) ?? null;

  const refresh = useCallback(async () => {
    const list = await listMedia();
    setMedia(list);
    const nextThumbs: Record<string, string> = {};
    const nextDurations: Record<string, number> = {};
    for (const m of list) {
      const rec = await getMediaBlob(m.id);
      if (!rec) continue;
      if (isDrawingRecord(m)) {
        try {
          const asset = JSON.parse(await rec.blob.text()) as { pngDataUrl?: string };
          if (asset.pngDataUrl) nextThumbs[m.id] = asset.pngDataUrl;
        } catch { /* no thumbnail */ }
        continue;
      }
      const thumb = await generateThumbnail(rec.blob, m.name);
      if (thumb) nextThumbs[m.id] = thumb;
      const d = await probeDuration(rec.blob);
      if (d != null) nextDurations[m.id] = d;
    }
    Object.values(thumbsRef.current).forEach((u) => {
      if (u.startsWith('blob:')) URL.revokeObjectURL(u);
    });
    setThumbs(nextThumbs);
    setDurations(nextDurations);
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      Object.values(thumbsRef.current).forEach((u) => {
        if (u.startsWith('blob:')) URL.revokeObjectURL(u);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preview: resolve a playable URL (or the drawing PNG) when opened.
  useEffect(() => {
    if (!previewId) {
      setPreviewUrl(null);
      setPreviewDrawPng(null);
      setPosition(0);
      setMediaDuration(0);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      const meta = media.find((m) => m.id === previewId);
      if (!meta) return;
      if (isDrawingRecord(meta)) {
        const asset = await loadDrawingAsset(previewId);
        if (!cancelled) setPreviewDrawPng(asset?.pngDataUrl ?? null);
        return;
      }
      const rec = await getMediaBlob(previewId);
      if (!rec || cancelled) return;
      url = URL.createObjectURL(rec.blob);
      setPreviewUrl(url);
      const d = await probeDuration(rec.blob);
      if (!cancelled && d != null) setMediaDuration(d);
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewId, media]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
    const a = audioRef.current;
    if (a) a.playbackRate = speed;
  }, [speed, previewUrl]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return media.filter((m) => {
      const kind = kindOf(m);
      if (typeFilter !== 'all' && kind !== typeFilter) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || m.type.toLowerCase().includes(q);
    });
  }, [media, query, typeFilter]);

  const referencingSurfaces = useCallback(
    (mediaId: string): Surface[] =>
      (project?.surfaces ?? []).filter(
        (s) => (s.content as { mediaId?: string }).mediaId === mediaId,
      ),
    [project],
  );

  const uploadFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    setErrors([]);
    setNotice(null);
    setUploading(true);
    const errs: string[] = [];
    let saved = 0;
    for (const f of Array.from(files)) {
      const v = validateFile(f);
      if (!v.ok) {
        errs.push(v.reason);
        continue;
      }
      const rec = await saveMediaBlob(f);
      if (rec) saved++;
      else errs.push(`Could not save “${f.name}” to IndexedDB.`);
    }
    setUploading(false);
    if (errs.length) setErrors(errs);
    if (saved) setNotice(`${saved} file${saved === 1 ? '' : 's'} saved to this browser's media library.`);
    await refresh();
  };

  const rewireReferences = (oldId: string, newId: string) => {
    // Surfaces pointing at the old media id.
    for (const s of referencingSurfaces(oldId)) {
      updateSurface(s.id, {
        content: { ...s.content, mediaId: newId } as Surface['content'],
      });
    }
    // Project audio track pointing at the old id.
    if (project?.audioTracks.some((t) => t.mediaId === oldId)) {
      const store = useStudioStore.getState();
      const track = store.project?.audioTracks.find((t) => t.mediaId === oldId);
      if (track) store.setAudioTrack({ ...track, mediaId: newId });
    }
  };

  const doRename = async () => {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) {
      setErrors(['Enter a new name.']);
      return;
    }
    const rec = await getMediaBlob(renameTarget.id);
    if (!rec) {
      setErrors([`Could not read “${renameTarget.name}” to rename it.`]);
      return;
    }
    const fresh = await saveMediaBlob(rec.blob, name);
    if (!fresh) {
      setErrors(['Rename failed — could not save the renamed copy.']);
      return;
    }
    await deleteMediaBlob(renameTarget.id);
    rewireReferences(renameTarget.id, fresh.id);
    setRenameTarget(null);
    setNotice(`Renamed to “${name}”. (Media is re-saved under a new id; surfaces using it were updated.)`);
    await refresh();
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    const refs = referencingSurfaces(deleteTarget.id);
    await deleteMediaBlob(deleteTarget.id);
    // Surfaces left pointing at a deleted id would render a placeholder
    // forever — reset them to the default visual and say so.
    for (const s of refs) {
      updateSurface(s.id, { content: { kind: 'visual', visualId: 'aurora' } as Surface['content'] });
    }
    if (project?.audioTracks.some((t) => t.mediaId === deleteTarget.id)) {
      useStudioStore.getState().setAudioTrack(null);
    }
    setDeleteTarget(null);
    setNotice(
      `Deleted “${deleteTarget.name}”${refs.length ? ` — ${refs.length} surface${refs.length === 1 ? '' : 's'} using it were reset to the Aurora visual.` : '.'}`,
    );
    await refresh();
  };

  const doReplace = async (file: File | undefined) => {
    if (!file || !replaceTarget) return;
    const v = validateFile(file);
    if (!v.ok) {
      setErrors([v.reason]);
      setReplaceTarget(null);
      return;
    }
    const oldKind = kindOf(replaceTarget);
    if (v.kind !== oldKind) {
      setErrors([
        `Replace keeps the same kind: “${replaceTarget.name}” is ${oldKind ?? 'unknown'}, but “${file.name}” is ${v.kind}. Pick a ${oldKind ?? ''} file instead.`,
      ]);
      setReplaceTarget(null);
      return;
    }
    const fresh = await saveMediaBlob(file);
    if (!fresh) {
      setErrors(['Replace failed — could not save the new file.']);
      setReplaceTarget(null);
      return;
    }
    await deleteMediaBlob(replaceTarget.id);
    // Swap the media id on every referencing surface, refreshing the
    // session-only URL the engine reads — geometry is untouched.
    for (const s of referencingSurfaces(replaceTarget.id)) {
      const content = { ...s.content, mediaId: fresh.id } as Record<string, unknown>;
      if (v.kind === 'image') {
        content.imageDataUrl =
          file.size <= IMAGE_DATA_URL_MAX_BYTES ? await fileToDataUrl(file) : URL.createObjectURL(file);
      } else if (v.kind === 'video') {
        content.videoObjectUrl = URL.createObjectURL(file);
      }
      updateSurface(s.id, { content: content as unknown as Surface['content'] });
    }
    setReplaceTarget(null);
    setNotice(`Replaced “${replaceTarget.name}” with “${file.name}”. Surface positions and shapes were not changed.`);
    await refresh();
  };

  const assignToSurface = async (meta: MediaMeta) => {
    const kind = kindOf(meta);
    if (!kind) return;
    if (!project) {
      setErrors(['No project is open — open a project in the studio first, then assign media to one of its surfaces.']);
      return;
    }
    if (!selectedSurface) {
      setErrors(['Select a surface in the studio first (or open the project and click a surface), then assign media to it.']);
      return;
    }
    const rec = await getMediaBlob(meta.id);
    if (!rec) {
      setErrors([`Could not read “${meta.name}” from IndexedDB.`]);
      return;
    }
    if (kind === 'image') {
      const dataUrl =
        rec.blob.size <= IMAGE_DATA_URL_MAX_BYTES
          ? await fileToDataUrl(rec.blob)
          : URL.createObjectURL(rec.blob);
      updateSurface(selectedSurface.id, {
        content: {
          ...selectedSurface.content,
          kind: 'image',
          mediaId: meta.id,
          imageDataUrl: dataUrl,
          fit,
        } as unknown as Surface['content'],
      });
      setNotice(
        rec.blob.size <= IMAGE_DATA_URL_MAX_BYTES
          ? `“${meta.name}” assigned to “${selectedSurface.name}”.`
          : `“${meta.name}” assigned to “${selectedSurface.name}” — resolved from the media library at render time, so it survives a reload.`,
      );
    } else if (kind === 'video') {
      updateSurface(selectedSurface.id, {
        content: {
          ...selectedSurface.content,
          kind: 'video',
          mediaId: meta.id,
          videoObjectUrl: URL.createObjectURL(rec.blob),
          loop,
          playbackRate: speed,
        } as unknown as Surface['content'],
      });
      setNotice(
        `“${meta.name}” assigned to “${selectedSurface.name}”. The stored loop + playback speed are honoured on stage; video plays muted (autoplay policy).`,
      );
    } else if (kind === 'draw') {
      const asset = await loadDrawingAsset(meta.id);
      if (!asset) {
        setErrors([`Could not read the drawing strokes for “${meta.name}”.`]);
        return;
      }
      updateSurface(selectedSurface.id, {
        content: {
          ...selectedSurface.content,
          kind: 'draw',
          mediaId: meta.id,
          strokes: toEngineStrokes(asset.strokes),
        } as unknown as Surface['content'],
      });
      setNotice(`Drawing “${meta.name}” assigned to “${selectedSurface.name}”. Text strokes and per-stroke opacity render on stage.`);
    } else if (kind === 'audio') {
      // 'audio' is not a surface content kind in the schema — assigning it
      // would fail project validation. It becomes the project audio track,
      // via setAudioTrack (which preserves the editor's undo history).
      const store = useStudioStore.getState();
      if (!store.project) return;
      store.setAudioTrack({
        id: `audio_${Date.now().toString(36)}`,
        name: meta.name,
        mediaId: meta.id,
        trimStart: 0,
        volume: 1,
      });
      setNotice(
        `“${meta.name}” set as the project audio track. Audio cannot be a surface's content (the schema has no 'audio' surface kind).`,
      );
    }
  };

  const previewMeta = previewId ? media.find((m) => m.id === previewId) ?? null : null;
  const previewKind = previewMeta ? kindOf(previewMeta) : null;
  const fitStyle: CSSProperties =
    fit === 'contain' ? { objectFit: 'contain' } : fit === 'fill' ? { objectFit: 'fill' } : { objectFit: 'cover' };

  return (
    <div className="space-y-4">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,image/jpeg,image/png,image/webp,image/gif,image/svg+xml,audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg"
        className="hidden"
        onChange={(e) => {
          void uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,image/jpeg,image/png,image/webp,image/gif,image/svg+xml,audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg"
        className="hidden"
        onChange={(e) => {
          void doReplace(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* Upload zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload media — drop files here or activate to browse"
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void uploadFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragOver ? 'border-amber-400 bg-amber-500/10' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
        }`}
      >
        <Upload className="mb-2 h-6 w-6 text-zinc-400" />
        <p className="text-sm text-zinc-200">
          {uploading ? 'Uploading…' : 'Drop files here, or click to browse'}
        </p>
        <p className="mt-1 text-xs text-zinc-500">Video MP4 / WebM / MOV · Images JPG / PNG / WebP / GIF / SVG · Audio MP3 / WAV / OGG · stored in this browser&apos;s IndexedDB</p>
      </div>

      {errors.length > 0 && (
        <div className="space-y-1 rounded-lg border border-red-800 bg-red-950/50 p-3" role="alert">
          {errors.map((e, i) => (
            <p key={i} className="text-sm text-red-200">{e}</p>
          ))}
          <button type="button" className="text-xs text-red-300 underline" onClick={() => setErrors([])}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-200" role="status">
          {notice}
          <button type="button" className="ml-3 text-xs underline" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search media…"
            className="pl-8"
            aria-label="Search media"
          />
        </div>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          options={TYPE_FILTERS}
          className="w-36"
          aria-label="Filter by type"
        />
        <span className="text-xs text-zinc-500">
          {filtered.length} of {media.length} item{media.length === 1 ? '' : 's'}
        </span>
      </div>

      {showAssign && (
        <p className="text-xs text-zinc-500">
          {project
            ? selectedSurface
              ? <>Assigning to surface <span className="text-zinc-200">{selectedSurface.name}</span> in “{project.name}”.</>
              : 'No surface selected — open the studio and click a surface to enable assigning.'
            : 'No project open — open a project in the studio to enable assigning.'}
        </p>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-400">
          {media.length === 0
            ? 'No media yet. Upload images, video or audio above, or save a drawing as an asset.'
            : 'No media matches your search / filter.'}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((m) => {
            const kind = kindOf(m);
            const thumb = thumbs[m.id];
            return (
              <article key={m.id} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                <button
                  type="button"
                  onClick={() => setPreviewId(m.id)}
                  className="relative block h-28 w-full bg-zinc-800 text-left"
                  aria-label={`Preview ${m.name}`}
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt={m.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-zinc-500">
                      {kind === 'video' ? <VideoIcon className="h-8 w-8" /> : kind === 'audio' ? <Music className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />}
                    </span>
                  )}
                  <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                    {kindBadge(kind)}
                  </span>
                  {(kind === 'video' || kind === 'audio') && durations[m.id] != null && (
                    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-zinc-200">
                      {formatDuration(durations[m.id])}
                    </span>
                  )}
                </button>
                <div className="p-3">
                  <p className="truncate text-sm font-medium" title={m.name}>{m.name}</p>
                  <p className="text-xs text-zinc-500">
                    {m.type} · {formatBytes(m.size)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => setPreviewId(m.id)}>
                      <Play className="h-3.5 w-3.5" /> Preview
                    </Button>
                    {showAssign && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!project || !selectedSurface}
                        title={!project ? 'Open a project first' : !selectedSurface ? 'Select a surface first' : `Assign to ${selectedSurface?.name}`}
                        onClick={() => void assignToSurface(m)}
                      >
                        Assign to surface
                      </Button>
                    )}
                    {kind === 'draw' && onEditDrawing && (
                      <Button variant="ghost" size="sm" onClick={() => onEditDrawing(m.id)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRenameTarget(m);
                        setRenameName(m.name);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setReplaceTarget(m);
                        replaceRef.current?.click();
                      }}
                    >
                      Replace
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${m.name}`}
                      onClick={() => setDeleteTarget(m)}
                    >
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Preview modal */}
      <Dialog open={!!previewMeta} onOpenChange={(o) => { if (!o) setPreviewId(null); }} title={previewMeta?.name ?? 'Preview'} className="max-w-2xl">
        {previewMeta && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-500">
              {previewMeta.type} · {formatBytes(previewMeta.size)}
              {durations[previewMeta.id] != null ? ` · ${formatDuration(durations[previewMeta.id])}` : ''}
            </p>
            <div className="flex items-center justify-center rounded bg-black">
              {previewKind === 'video' && previewUrl && (
                <video
                  ref={videoRef}
                  src={previewUrl}
                  controls
                  loop={loop}
                  playsInline
                  className="max-h-80 w-full"
                  style={fitStyle}
                  onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setMediaDuration(e.currentTarget.duration)}
                />
              )}
              {previewKind === 'audio' && previewUrl && (
                <audio
                  ref={audioRef}
                  src={previewUrl}
                  controls
                  loop={loop}
                  className="w-full"
                  onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setMediaDuration(e.currentTarget.duration)}
                />
              )}
              {(previewKind === 'image' || previewKind === 'draw') && (previewUrl || previewDrawPng) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewKind === 'draw' ? (previewDrawPng ?? undefined) : previewUrl ?? undefined}
                  alt={previewMeta.name}
                  className="max-h-80 w-full"
                  style={fitStyle}
                />
              )}
              {!previewUrl && !previewDrawPng && <p className="py-10 text-sm text-zinc-400">Loading preview…</p>}
            </div>
            {(previewKind === 'video' || previewKind === 'audio') && (
              <div className="space-y-3">
                <Slider
                  label="Position"
                  value={Math.round(position * 10) / 10}
                  min={0}
                  max={Math.max(0.1, mediaDuration)}
                  step={0.1}
                  onChange={(v) => {
                    setPosition(v);
                    const el = videoRef.current ?? audioRef.current;
                    if (el) el.currentTime = v;
                  }}
                  format={(v) => `${formatDuration(v)} / ${formatDuration(mediaDuration)}`}
                />
                <Slider
                  label="Playback speed"
                  value={Math.round(speed * 100)}
                  min={25}
                  max={200}
                  step={5}
                  onChange={(v) => setSpeed(v / 100)}
                  format={(v) => `${(v / 100).toFixed(2)}×`}
                />
                <label className="flex items-center gap-2 text-xs text-zinc-300">
                  <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} className="accent-amber-400" />
                  Loop playback (preview + stored on the surface)
                </label>
              </div>
            )}
            {(previewKind === 'image' || previewKind === 'video' || previewKind === 'draw') && (
              <label className="block text-xs text-zinc-300">
                Fit (preview + stored on the surface)
                <select
                  value={fit}
                  onChange={(e) => setFit(e.target.value as typeof fit)}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                >
                  <option value="cover">Crop / fill (cover)</option>
                  <option value="contain">Fit whole image (contain)</option>
                  <option value="fill">Stretch (fill)</option>
                </select>
                <span className="mt-1 block text-[11px] text-zinc-500">
                  The renderer honours the fit mode (cover / contain / stretch).
                </span>
              </label>
            )}
            {showAssign && (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!project || !selectedSurface}
                  onClick={() => {
                    void assignToSurface(previewMeta);
                    setPreviewId(null);
                  }}
                >
                  {previewKind === 'audio' ? 'Set as project audio track' : 'Assign to selected surface'}
                </Button>
                {previewKind === 'draw' && onEditDrawing && (
                  <Button variant="outline" onClick={() => { onEditDrawing(previewMeta.id); setPreviewId(null); }}>
                    Edit drawing
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) setRenameTarget(null); }} title="Rename media">
        {renameTarget && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-500">
              Renaming re-saves the file under a new id and updates any surfaces using it in the open project.
            </p>
            <Input value={renameName} onChange={(e) => setRenameName(e.target.value)} aria-label="New name" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
              <Button onClick={() => void doRename()}>Rename</Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }} title="Delete media?">
        {deleteTarget && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-200">Delete “{deleteTarget.name}” from this browser&apos;s media library?</p>
            {referencingSurfaces(deleteTarget.id).length > 0 && (
              <p className="text-sm text-amber-300">
                Used by {referencingSurfaces(deleteTarget.id).length} surface(s)
                ({referencingSurfaces(deleteTarget.id).map((s) => s.name).join(', ')}) — those surfaces will be reset to the Aurora visual.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => void doDelete()}>Delete</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
