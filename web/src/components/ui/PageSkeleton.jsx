import { cn } from '../../lib/utils';
import Skeleton, {
  SkeletonPageHeader,
  SkeletonStatCard,
  SkeletonCard,
  SkeletonThreadRow,
} from './Skeleton';

/**
 * Full-page skeleton for list/table collection screens.
 */
export function TablePageSkeleton({
  rows = 6,
  showStats = false,
  label = 'Loading content',
  className,
}) {
  return (
    <div
      className={cn('space-y-6 animate-fade-in motion-reduce:animate-none', className)}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <div className="flex items-start justify-between gap-4">
        <SkeletonPageHeader />
        <Skeleton className="h-11 w-32 rounded-lg shrink-0" />
      </div>

      {showStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonStatCard key={i} />
          ))}
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <Skeleton className="h-5 w-40" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonThreadRow key={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * Kanban board skeleton used by Projects.
 */
export function KanbanPageSkeleton({
  columns = 4,
  cardsPerColumn = 3,
  label = 'Loading projects',
  className,
}) {
  return (
    <div
      className={cn('space-y-6 animate-fade-in motion-reduce:animate-none', className)}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <div className="flex items-start justify-between gap-4">
        <SkeletonPageHeader />
        <Skeleton className="h-11 w-36 rounded-lg shrink-0" />
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {Array.from({ length: columns }).map((_, col) => (
          <div
            key={col}
            className="flex flex-col min-w-[280px] max-w-[320px] flex-shrink-0 space-y-3"
          >
            <Skeleton className="h-6 w-24" />
            <div className="space-y-2">
              {Array.from({ length: cardsPerColumn }).map((_, row) => (
                <SkeletonCard key={row} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Compact card-list skeleton for notifications / docs / team.
 */
export function ListPageSkeleton({
  rows = 5,
  label = 'Loading list',
  className,
}) {
  return (
    <div
      className={cn('space-y-6 animate-fade-in motion-reduce:animate-none', className)}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <SkeletonPageHeader />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * Staggered entrance wrapper for loaded lists. Respects reduced-motion.
 */
export function AnimatedList({ children, className }) {
  return (
    <div className={cn('stagger-children', className)}>
      {children}
    </div>
  );
}
