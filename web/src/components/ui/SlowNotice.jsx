import useSlowState, { SLOW_THRESHOLD_MS } from '../../hooks/useSlowState';
import { cn } from '../../lib/utils';

export const SLOW_MESSAGE = 'Still working… this is taking longer than usual.';

export const SLOW_GUIDANCE = {
  // Reads are safe to keep waiting on or to retry later.
  read: 'You can keep waiting. If it does not finish, check your connection and retry.',
  // Writes may already have reached the server: never invite a duplicate submission.
  write: 'Keep this page open and do not submit again. We will confirm when it finishes.',
};

/**
 * Preset for a pending write on surfaces with their own palette (the client
 * portal): small copy that inherits the surrounding text colour.
 */
export const SLOW_WRITE_INLINE = {
  kind: 'write',
  style: { fontSize: '0.8rem', marginTop: '0.5rem' },
  messageClassName: 'text-inherit',
};

/**
 * Presentational slow-state copy with no live-region semantics of its own.
 * Use it inside an element that is already a polite live region
 * (LoadingState, skeleton status containers) to avoid nested live regions.
 */
export function SlowMessage({ kind = 'read', guidance, className, style }) {
  return (
    <span
      data-slow-state=""
      style={style}
      className={cn(
        'block text-sm text-muted-foreground animate-fade-in motion-reduce:animate-none',
        className
      )}
    >
      <span className="font-medium">{SLOW_MESSAGE}</span>{' '}
      {guidance ?? SLOW_GUIDANCE[kind] ?? SLOW_GUIDANCE.read}
    </span>
  );
}

/**
 * Self-timed slow-state notice with its own polite live region.
 *
 * The (empty, visually hidden) live region mounts as soon as `active` becomes
 * true so screen readers reliably announce the text when it appears after
 * `thresholdMs`. Renders nothing while idle.
 */
export default function SlowNotice({
  active,
  thresholdMs = SLOW_THRESHOLD_MS,
  kind = 'read',
  guidance,
  className,
  messageClassName,
  style,
}) {
  const slow = useSlowState(active, thresholdMs);
  if (!active) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={slow ? cn('m-0', className) : 'sr-only'}
      style={slow ? style : undefined}
    >
      {slow ? <SlowMessage kind={kind} guidance={guidance} className={messageClassName} /> : null}
    </p>
  );
}

/**
 * Spinner-free named loading status for surfaces with their own styling
 * (e.g. the client portal). Adds the slow-state copy inside the same polite
 * live region after the shared threshold; the copy inherits the text colour.
 */
export function SlowLoadingStatus({ label, className, style }) {
  const slow = useSlowState(true);
  return (
    <div
      role="status"
      aria-live="polite"
      className={className}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textAlign: 'center', ...style }}
    >
      <span>{label}</span>
      {slow && <SlowMessage style={{ color: 'inherit', maxWidth: 420 }} />}
    </div>
  );
}
