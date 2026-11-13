import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'default' | 'icon' | 'lg';

const variants: Record<ButtonVariant, string> = {
  default: 'bg-amber-500 text-zinc-950 hover:bg-amber-400 font-medium',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700',
  outline: 'border border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800',
  ghost: 'bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
  destructive: 'bg-red-600 text-white hover:bg-red-500',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  default: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-5 text-base',
  icon: 'h-9 w-9',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
