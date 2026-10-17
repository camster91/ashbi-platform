import { ChevronDown, SlidersHorizontal } from 'lucide-react';

export function FilterPanel({ children, activeCount = 0 }) {
  return (
    <details open={activeCount > 0 || undefined} className="group rounded-xl border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        <span>Filters</span>
        {activeCount > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{activeCount} active</span>}
        <ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-4 border-t border-border p-4">
        {children}
      </div>
    </details>
  );
}
