'use client';
import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Tooltip({ content, children, className }: { content: string; children: ReactNode; className?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100 shadow-lg"
        >
          {content}
        </span>
      )}
    </span>
  );
}
