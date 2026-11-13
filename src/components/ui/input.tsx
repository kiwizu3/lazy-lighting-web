import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, type = 'text', ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
