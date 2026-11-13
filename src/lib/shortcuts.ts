// Keyboard shortcuts for the studio editor.
// Ignores keystrokes while focus is in an input / textarea / select / contentEditable.
import { useEffect } from 'react';
import { useStudioStore } from './store';

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const store = useStudioStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (isTypingTarget(e)) {
        // Still allow Escape to blur out of a field.
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }

      if (mod && key === 's') {
        e.preventDefault();
        void store.saveNow();
        return;
      }
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
        return;
      }
      if ((mod && key === 'z' && e.shiftKey) || (mod && key === 'y')) {
        e.preventDefault();
        store.redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        if (store.selectedSurfaceId) store.duplicateSurface(store.selectedSurfaceId);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selectedSurfaceId) {
          e.preventDefault();
          store.removeSurface(store.selectedSurfaceId);
        }
        return;
      }
      if (e.key === ' ' && !mod) {
        e.preventDefault();
        store.setPlaying(!store.playback.playing);
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => undefined);
        return;
      }
      if (key === 'g' && !mod) {
        store.setGrid(!store.grid);
        return;
      }
      if (e.key === 'Escape') {
        if (store.performanceMode) store.setPerformanceMode(false);
        else if (store.selectedSurfaceId) store.selectSurface(null);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export const SHORTCUT_LIST: { keys: string; action: string }[] = [
  { keys: 'Ctrl/⌘ + S', action: 'Save project' },
  { keys: 'Ctrl/⌘ + Z', action: 'Undo' },
  { keys: 'Ctrl/⌘ + Shift + Z / Ctrl/⌘ + Y', action: 'Redo' },
  { keys: 'Ctrl/⌘ + D', action: 'Duplicate selected surface' },
  { keys: 'Delete', action: 'Delete selected surface' },
  { keys: 'Space', action: 'Play / pause' },
  { keys: 'F', action: 'Toggle fullscreen' },
  { keys: 'G', action: 'Toggle grid' },
  { keys: 'Esc', action: 'Exit performance mode / deselect' },
];
