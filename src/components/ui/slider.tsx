import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, label, value, min = 0, max = 100, step = 1, onChange, format, ...props }, ref) => (
    <label className={cn('block text-xs text-zinc-400', className)}>
      {label && (
        <span className="flex justify-between">
          <span>{label}</span>
          <span className="text-zinc-200">{format ? format(value) : value}</span>
        </span>
      )}
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-400"
        {...props}
      />
    </label>
  ),
);
Slider.displayName = 'Slider';
