'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function DropdownMenu({ trigger, children, align = 'right' }: { trigger: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); window.removeEventListener('keydown', onKey); };
  }, [open ]);

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 mt-1 min-w-44 rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownMenuItem({ children, onClick, className, destructive }: { children: ReactNode; onClick?: () => void; className?: string; destructive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-amber-400',
        destructive && 'text-red-400 hover:bg-red-950',
        className,
      )}
    >
      {children}
    </button>
  );
}
