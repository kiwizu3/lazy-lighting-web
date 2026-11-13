// Reusable colour picker — Phase 4.
// Swatch grid + native colour input + hex text input + recent colours
// (localStorage, newest first, max 10). Used by VisualLibrary / EffectsPanel.
'use client';
import { useEffect, useState } from 'react';

const RECENT_KEY = 'lazy-lighting-recent-colors-v1';
const MAX_RECENT = 10;

const SWATCHES = [
  '#f59e0b', '#f97316', '#ef4444', '#f43f5e', '#ec4899', '#d946ef',
  '#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#22d3ee', '#10b981',
  '#22c55e', '#a3e635', '#facc15', '#fde047', '#ffffff', '#94a3b8',
  '#1e293b', '#000000',
];

export function loadRecentColors(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecentColor(color: string): string[] {
  const next = [color, ...loadRecentColors().filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  /** Called on commit (input blur / swatch pick) so callers can persist. */
  onCommit?: (color: string) => void;
  label?: string;
}

export function normalizeHex(input: string): string | null {
  let h = input.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return `#${h.toLowerCase()}`;
}

export default function ColorPicker({ value, onChange, onCommit, label }: ColorPickerProps) {
  const [hex, setHex] = useState(value);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setHex(value);
  }, [value]);

  useEffect(() => {
    setRecent(loadRecentColors());
  }, []);

  const commit = (color: string) => {
    const norm = normalizeHex(color);
    if (!norm) return;
    setRecent(pushRecentColor(norm));
    onCommit?.(norm);
  };

  return (
    <div className="space-y-2">
      {label && <p className="text-xs font-medium text-zinc-300">{label}</p>}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={normalizeHex(value) ?? '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          aria-label={label ?? 'Pick a colour'}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-zinc-700 bg-zinc-900"
        />
        <input
          type="text"
          value={hex}
          spellCheck={false}
          onChange={(e) => {
            setHex(e.target.value);
            const norm = normalizeHex(e.target.value);
            if (norm) onChange(norm);
          }}
          onBlur={() => commit(hex)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(hex);
          }}
          aria-label="Hex colour"
          className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100"
        />
        <span
          aria-hidden
          className="h-6 w-6 rounded border border-zinc-700"
          style={{ background: normalizeHex(value) ?? '#000' }}
        />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Colour swatches">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`Colour ${c}`}
            onClick={() => {
              onChange(c);
              commit(c);
            }}
            className="h-5 w-5 rounded-sm border border-zinc-700 hover:scale-110"
            style={{ background: c }}
          />
        ))}
      </div>
      {recent.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] text-zinc-500">Recent</p>
          <div className="flex flex-wrap gap-1">
            {recent.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                aria-label={`Recent colour ${c}`}
                onClick={() => {
                  onChange(c);
                  commit(c);
                }}
                className="h-5 w-5 rounded-sm border border-zinc-600 hover:scale-110"
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
