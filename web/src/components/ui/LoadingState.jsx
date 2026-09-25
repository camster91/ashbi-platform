import { cn } from '../../lib/utils';
import useSlowState, { SLOW_THRESHOLD_MS } from '../../hooks/useSlowState';
import { SlowMessage } from './SlowNotice';

const spinnerSizes = {
  sm: 'h-5 w-5',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

/**
 * Named loading status. After `slowAfterMs` (default 8s) it also explains
 * that the request is still running ("Slow" state). The slow copy is added
 * inside this polite live region, so it is announced once without nesting a
 * second live region. Pass `slowAfterMs={false}` to opt out.
 */
export default function LoadingState({
  label = 'Loading…',
  size = 'md',
  compact = false,
  className,
  spinnerClassName,
  slowAfterMs = SLOW_THRESHOLD_MS,
  slowKind = 'read',
  slowGuidance,
  as: Component = 'div',
  ...props
}) {
  const isSlow = useSlowState(true, slowAfterMs);
  return (
    <Component
      role="status"
      aria-live="polite"
      aria-label={label}
      data-slow={isSlow || undefined}
      className={cn(
        'flex items-center justify-center gap-3 text-muted-foreground',
        isSlow && 'flex-wrap text-center',
        !compact && 'min-h-[12rem]',
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none',
          spinnerSizes[size] ?? spinnerSizes.md,
          spinnerClassName
        )}
      />
      <span>{label}</span>
      {isSlow && <SlowMessage kind={slowKind} guidance={slowGuidance} className="basis-full max-w-md" />}
    </Component>
  );
}
