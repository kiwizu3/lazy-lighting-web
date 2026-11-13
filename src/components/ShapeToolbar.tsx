// ShapeToolbar — add surfaces to the stage.
// Most shapes are created immediately with centered default corners; the
// polygon / freeform / hand-drawn modes hand control to ProjectionCanvas,
// which collects the outline on the stage and then creates the surface.
'use client';
import { useStudioStore } from '../lib/store';
import { makeNewSurface, centeredCorners, type SurfaceShape } from '../lib/surfaceFactory';
import { defaultBlobPoints, defaultSilhouettePoints } from '../lib/warp';
import type { CreationMode } from './ProjectionCanvas';

interface Props {
  creationMode: CreationMode;
  onCreationModeChange: (m: CreationMode) => void;
}

interface ToolDef {
  label: string;
  shape?: SurfaceShape;
  mode?: CreationMode;
  hint: string;
}

const TOOLS: ToolDef[] = [
  { label: 'Rectangle', shape: 'rect', hint: 'Axis-aligned quad' },
  { label: 'Square', shape: 'square', hint: 'Square quad' },
  { label: 'Circle', shape: 'circle', hint: 'Circle inscribed in its quad' },
  { label: 'Ellipse', shape: 'ellipse', hint: 'Ellipse inscribed in its quad' },
  { label: 'Rounded Rect', shape: 'rounded-rect', hint: 'Quad with rounded corners' },
  { label: 'Custom Polygon', mode: { kind: 'polygon' }, hint: 'Click to place vertices, Enter to finish' },
  { label: 'Freeform', mode: { kind: 'freeform' }, hint: 'Drag to draw an outline' },
  { label: 'Text', shape: 'text', hint: 'Text over a visual' },
  { label: 'Image Silhouette', shape: 'silhouette', hint: 'Content clipped to a silhouette outline' },
  { label: 'Cube', shape: 'cube', hint: 'Front face + shaded top/side faces' },
  { label: 'Box', shape: 'box', hint: 'Cube with deeper extrusion' },
  { label: 'Curved Surface', shape: 'curved', hint: 'Plane with sinusoidal depth curve' },
  { label: 'Hand-drawn Outline', mode: { kind: 'freehand' }, hint: 'Drag to draw a freehand outline' },
];

export default function ShapeToolbar({ creationMode, onCreationModeChange }: Props) {
  const addSurface = useStudioStore((s) => s.addSurface);

  const handleTool = (tool: ToolDef) => {
    if (tool.mode) {
      onCreationModeChange(creationMode?.kind === tool.mode.kind ? null : tool.mode);
      return;
    }
    if (!tool.shape) return;
    if (tool.shape === 'text') {
      const text = window.prompt('Text for this surface', 'Hello');
      if (text === null) return;
      addSurface(
        makeNewSurface('text', {
          content: { kind: 'visual', visualId: 'neon-sign', text },
        }),
      );
      return;
    }
    if (tool.shape === 'silhouette') {
      // No media library yet (Phase 3): use the built-in silhouette outline
      // and clip the visual to it. Image-alpha silhouettes arrive with media.
      addSurface(makeNewSurface('silhouette', { vertices: defaultSilhouettePoints() }));
      return;
    }
    if (tool.shape === 'polygon' || tool.shape === 'freeform' || tool.shape === 'freehand') {
      addSurface(
        makeNewSurface(tool.shape, {
          corners: centeredCorners(0.4, 0.4),
          vertices: defaultBlobPoints(),
        }),
      );
      return;
    }
    if (tool.shape === 'curved') {
      addSurface(makeNewSurface('curved', { curve: 0.4 }));
      return;
    }
    addSurface(makeNewSurface(tool.shape));
  };

  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Add shape</h2>
      <div className="grid grid-cols-2 gap-1.5">
        {TOOLS.map((tool) => {
          const active = !!tool.mode && creationMode?.kind === tool.mode.kind;
          return (
            <button
              key={tool.label}
              type="button"
              title={tool.hint}
              onClick={() => handleTool(tool)}
              className={`rounded border px-2 py-1.5 text-left text-xs leading-tight ${
                active
                  ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800'
              }`}
            >
              {tool.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-zinc-500">
        Polygon, Freeform and Hand-drawn Outline are drawn on the stage: click / drag, then Enter or double-click
        (polygon) or release (freeform) to finish.
      </p>
    </div>
  );
}
