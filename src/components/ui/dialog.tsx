'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
}

export function Dialog({ open, onOpenChange, title, children, className }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-xl', className)}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
          <Button variant="ghost" size="icon" aria-label="Close dialog" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
