'use client';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, onCheckedChange, label, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-amber-400',
        checked ? 'bg-amber-500' : 'bg-zinc-700',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
      {label && <span className="sr-only">{label}</span>}
    </button>
  ),
);
Switch.displayName = 'Switch';
