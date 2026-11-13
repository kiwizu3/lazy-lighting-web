'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface TabsContextValue { value: string; onValueChange: (v: string) => void }
const TabsContext = createContext<TabsContextValue | null>(null);

export function Tabs({ value, onValueChange, children, className }: { value: string; onValueChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 rounded-md bg-zinc-800 p-1', className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('TabsTrigger must be used inside Tabs');
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => ctx.onValueChange(value)}
      className={cn(
        'flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-amber-400',
        active ? 'bg-zinc-900 text-zinc-100 shadow' : 'text-zinc-400 hover:text-zinc-200',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('TabsContent must be used inside Tabs');
  if (ctx.value !== value) return null;
  return <div role="tabpanel" className={className}>{children}</div>;
}
