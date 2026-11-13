'use client';
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  ),
);
Select.displayName = 'Select';
