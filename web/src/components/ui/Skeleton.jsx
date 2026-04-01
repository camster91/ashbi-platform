import { cn } from '../../lib/utils';

// Base skeleton component
function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted skeleton-shimmer',
        className
      )}
      {...props}
    />
  );
}

// Skeleton text lines
export function SkeletonText({ lines = 1, className, ...props }) {
  return (
    <div className={cn('space-y-2', className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-4',
            i === lines - 1 && lines > 1 && 'w-3/4'
          )}
        />
      ))}
    </div>
  );
}

// Skeleton card
export function SkeletonCard({ className, ...props }) {
  return (
    <div
      className={cn(
        'p-4 rounded-xl border border-border bg-card',
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-4">
        <Skeleton className="w-12 h-12 rounded-lg flex-shrink-0" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <SkeletonText lines={2} />
        </div>
      </div>
    </div>
  );
}

// Skeleton stat card
export function SkeletonStatCard({ className, ...props }) {
  return (
    <div
      className={cn(
        'p-4 rounded-xl border border-border bg-card',
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="w-10 h-10 rounded-lg" />
      </div>
    </div>
  );
}

// Skeleton avatar
export function SkeletonAvatar({ size = 'md', className, ...props }) {
  const sizes = {
    xs: 'w-6 h-6',
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  };

  return (
    <Skeleton
      className={cn('rounded-full', sizes[size], className)}
      {...props}
    />
  );
}

// Skeleton thread row
export function SkeletonThreadRow({ className, ...props }) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 px-4 py-3 border-b border-border',
        className
      )}
      {...props}
    >
      <Skeleton className="w-1 h-12 rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-6 w-20 rounded-full" />
    </div>
  );
}

// Skeleton page header
export function SkeletonPageHeader({ className, ...props }) {
  return (
    <div className={cn('space-y-4', className)} {...props}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-96" />
    </div>
  );
}

export default Skeleton;
