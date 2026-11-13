// Drawing workspace (Phase 3, engine opacity/text added Phase 5) — HTML
// canvas drawing with pointer events, own undo/redo history, save-as-asset
// to IndexedDB, and apply-to-surface via the store (content kind 'draw' +
// engine-shaped strokes). The engine honours per-stroke opacity and renders
// text strokes at their anchor point.
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudioStore } from '../lib/store';
import type { Surface } from '../lib/schema';
import {
  DRAW_SWATCHES, DRAW_TOOLS, drawStrokeOnCanvas, loadDrawingAsset, newStrokeId,
  saveDrawingAsset, toEngineStrokes, type DrawStroke, type DrawTool,
} from '../lib/drawing';
import type { Pt } from '../lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Slider } from './ui/slider';
import { Dialog } from './ui/dialog';

const CANVAS_W = 960;
const CANVAS_H = 540;

interface DrawingWorkspaceProps {
  /** Media id of a saved drawing asset to edit (loads its strokes). */
  assetId?: string | null;
  /** Strokes to start from (alternative to assetId). */
  initialStrokes?: DrawStroke[];
  initialName?: string;
  onSaved?: (mediaId: string) => void;
  onClose?: () => void;
}

export default function DrawingWorkspace({
  assetId, initialStrokes, initialName, onSaved, onClose,
}: DrawingWorkspaceProps) {
  const project = useStudioStore((s) => s.project);
  const selectedSurfaceId = useStudioStore((s) => s.selectedSurfaceId);
  const updateSurface = useStudioStore((s) => s.updateSurface);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<DrawStroke[]>(initialStrokes ?? []);
  const [past, setPast] = useState<DrawStroke[][]>([]);
  const [future, setFuture] = useState<DrawStroke[][]>([]);
  const [tool, setTool] = useState<DrawTool>('brush');
  const [color, setColor] = useState('#f59e0b');
  const [size, setSize] = useState(6);
  const [opacity, setOpacity] = useState(1);
  const [name, setName] = useState(initialName ?? 'Untitled drawing');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [textAnchor, setTextAnchor] = useState<Pt | null>(null);
  const [textValue, setTextValue] = useState('');
  const [loadedAssetId, setLoadedAssetId] = useState<string | null>(assetId ?? null);
  const draftRef = useRef<DrawStroke | null>(null);
  const drawingRef = useRef(false);
  const polygonRef = useRef<Pt[]>([]);

  const selectedSurface = project?.surfaces.find((s) => s.id === selectedSurfaceId) ?? null;

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    void loadDrawingAsset(assetId).then((asset) => {
      if (cancelled || !asset) return;
      setStrokes(asset.strokes);
      setName(asset.name.replace(/\.drawing\.json$/i, ''));
      setLoadedAssetId(assetId);
      setPast([]);
      setFuture([]);
    });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const redraw = useCallback((all: DrawStroke[], draft: DrawStroke | null = null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (const s of all) drawStrokeOnCanvas(ctx, s, CANVAS_W, CANVAS_H);
    if (draft) drawStrokeOnCanvas(ctx, draft, CANVAS_W, CANVAS_H);
  }, []);

  useEffect(() => {
    redraw(strokes, draftRef.current);
  }, [strokes, redraw]);

  const commit = useCallback((next: DrawStroke[]) => {
    setPast((p) => [...p.slice(-49), strokes]);
    setFuture([]);
    setStrokes(next);
  }, [strokes]);

  const undo = () => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setFuture((f) => [strokes, ...f]);
    setPast(past.slice(0, -1));
    setStrokes(prev);
  };

  const redo = () => {
    if (future.length === 0) return;
    const [next, ...rest] = future;
    setPast((p) => [...p, strokes]);
    setFuture(rest);
    setStrokes(next);
  };

  const toNormalized = (e: React.PointerEvent): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const eraseAt = (p: Pt) => {
    const radius = (size * 2) / CANVAS_W + 0.01;
    const hit = (s: DrawStroke) =>
      s.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < radius);
    if (strokes.some(hit)) commit(strokes.filter((s) => !hit(s)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toNormalized(e);
    if (tool === 'text') {
      setTextAnchor(p);
      setTextValue('');
      return;
    }
    if (tool === 'polygon') {
      polygonRef.current = [...polygonRef.current, p];
      draftRef.current = {
        id: 'draft', tool: 'polygon', points: polygonRef.current,
        color, size, opacity,
      };
      redraw(strokes, draftRef.current);
      return;
    }
    if (tool === 'eraser') {
      drawingRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      eraseAt(p);
      return;
    }
    drawingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draftRef.current = {
      id: newStrokeId(), tool, points: [p], color, size, opacity,
    };
    redraw(strokes, draftRef.current);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toNormalized(e);
    if (tool === 'eraser' && drawingRef.current) {
      eraseAt(p);
      return;
    }
    if (!drawingRef.current || !draftRef.current) return;
    const draft = draftRef.current;
    if (tool === 'brush' || tool === 'pencil') {
      const last = draft.points[draft.points.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) > 0.002) {
        draft.points = [...draft.points, p];
      }
    } else {
      draft.points = [draft.points[0], p];
    }
    redraw(strokes, draft);
  };

  const finishDraft = () => {
    const draft = draftRef.current;
    draftRef.current = null;
    drawingRef.current = false;
    if (!draft) return;
    if (draft.tool === 'brush' || draft.tool === 'pencil') {
      if (draft.points.length >= 2) commit([...strokes, draft]);
      else redraw(strokes);
    } else if (draft.points.length >= 2) {
      commit([...strokes, draft]);
    } else {
      redraw(strokes);
    }
  };

  const finishPolygon = () => {
    const pts = polygonRef.current;
    polygonRef.current = [];
    draftRef.current = null;
    if (pts.length >= 3) {
      commit([...strokes, { id: newStrokeId(), tool: 'polygon', points: pts, color, size, opacity }]);
    } else {
      redraw(strokes);
    }
  };

  const commitText = () => {
    if (!textAnchor) return;
    const text = textValue.trim();
    if (text) {
      commit([...strokes, {
        id: newStrokeId(), tool: 'text', points: [textAnchor],
        color, size: Math.max(6, size), opacity, text,
      }]);
    }
    setTextAnchor(null);
    setTextValue('');
  };

  const saveAsAsset = async () => {
    setError(null);
    const id = await saveDrawingAsset(name.trim() || 'Untitled drawing', strokes);
    if (!id) {
      setError('Could not save the drawing to IndexedDB.');
      return;
    }
    setLoadedAssetId(id);
    setNotice(`Saved as a drawing asset in the media library${strokes.length === 0 ? ' (empty — no strokes yet)' : ''}.`);
    onSaved?.(id);
  };

  const applyToSurface = () => {
    if (!project || !selectedSurface) {
      setError('Select a surface in the studio first, then apply this drawing to it.');
      return;
    }
    updateSurface(selectedSurface.id, {
      content: {
        ...selectedSurface.content,
        kind: 'draw',
        mediaId: loadedAssetId ?? undefined,
        strokes: toEngineStrokes(strokes),
      } as unknown as Surface['content'],
    });
    setNotice(`Applied to “${selectedSurface.name}”. Text strokes render at their anchor and per-stroke opacity is honoured on stage.`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Drawing tools">
          {DRAW_TOOLS.map((t) => (
            <Button
              key={t.id}
              variant={tool === t.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setTool(t.id);
                if (t.id !== 'polygon') {
                  polygonRef.current = [];
                  draftRef.current = null;
                  redraw(strokes);
                }
              }}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-zinc-300">
            Colour
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-zinc-700 bg-zinc-900"
              aria-label="Brush colour"
            />
          </label>
          <span className="flex gap-1" aria-label="Colour swatches">
            {DRAW_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Colour ${c}`}
                className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-amber-400' : 'border-zinc-600'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Slider label="Brush size" value={size} min={1} max={40} onChange={setSize} format={(v) => `${v}px`} />
        <Slider label="Opacity" value={Math.round(opacity * 100)} min={5} max={100} onChange={(v) => setOpacity(v / 100)} format={(v) => `${v}%`} />
        <div className="flex items-end gap-2">
          <Button variant="outline" size="sm" onClick={undo} disabled={past.length === 0}>Undo</Button>
          <Button variant="outline" size="sm" onClick={redo} disabled={future.length === 0}>Redo</Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} disabled={strokes.length === 0}>
            Clear canvas
          </Button>
        </div>
      </div>

      {tool === 'polygon' && (
        <p className="text-xs text-amber-300">
          Click to place polygon points — press Enter or double-click to finish, Esc to cancel.
        </p>
      )}
      <p className="text-xs text-zinc-500">
        Eraser deletes the strokes it touches. Text strokes render at their anchor point; opacity is honoured per stroke on stage.
      </p>

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="w-full cursor-crosshair rounded-lg border border-zinc-700 bg-[#0f172a]"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDraft}
          onPointerLeave={() => { if (drawingRef.current) finishDraft(); }}
          onDoubleClick={() => { if (tool === 'polygon') finishPolygon(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tool === 'polygon') finishPolygon();
            if (e.key === 'Escape' && tool === 'polygon') {
              polygonRef.current = [];
              draftRef.current = null;
              redraw(strokes);
            }
          }}
          tabIndex={0}
          role="application"
          aria-label="Drawing canvas"
        />
        {textAnchor && (
          <div
            className="absolute flex gap-1 rounded border border-zinc-600 bg-zinc-900 p-1"
            style={{ left: `${textAnchor.x * 100}%`, top: `${textAnchor.y * 100}%` }}
          >
            <Input
              value={textValue}
              autoFocus
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText();
                if (e.key === 'Escape') {
                  setTextAnchor(null);
                  setTextValue('');
                }
              }}
              placeholder="Type text, Enter to place"
              className="w-48"
              aria-label="Text to draw"
            />
            <Button size="sm" onClick={commitText}>Place</Button>
          </div>
        )}
      </div>

      <p className="text-xs text-zinc-500">
        {strokes.length} stroke{strokes.length === 1 ? '' : 's'} — all render on stage (text at its anchor, opacity per stroke).
      </p>

      {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
      {notice && (
        <p className="text-sm text-emerald-300" role="status">
          {notice}
          <button type="button" className="ml-3 text-xs underline" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs text-zinc-300">
          Drawing name
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-56" aria-label="Drawing name" />
        </label>
        <Button onClick={() => void saveAsAsset()}>Save as asset</Button>
        <Button
          variant="secondary"
          onClick={applyToSurface}
          disabled={!project || !selectedSurface}
          title={!project ? 'Open a project first' : !selectedSurface ? 'Select a surface first' : `Apply to ${selectedSurface?.name}`}
        >
          Apply to selected surface
        </Button>
        {onClose && <Button variant="ghost" onClick={onClose}>Close</Button>}
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear} title="Clear canvas?">
        <p className="text-sm text-zinc-200">
          Remove all {strokes.length} stroke{strokes.length === 1 ? '' : 's'} from this drawing? This cannot be undone unless the drawing was already saved as an asset.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => {
              commit([]);
              setConfirmClear(false);
            }}
          >
            Clear all strokes
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
