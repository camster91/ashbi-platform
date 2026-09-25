import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';
import useSlowState, { SLOW_THRESHOLD_MS } from '../../hooks/useSlowState';
import { SlowMessage } from './SlowNotice';

const Button = forwardRef(({
  children,
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  isLoading = false,
  loading,
  isDisabled = false,
  disabled,
  className,
  slowAfterMs = SLOW_THRESHOLD_MS,
  slowKind = 'write',
  slowGuidance,
  ...props
}, ref) => {
  // Accept both `loading` and `isLoading` props; also accept `disabled` alongside `isDisabled`
  const showLoading = isLoading || loading || false;
  const showDisabled = isDisabled || disabled || false;
  // "Slow" workflow state: a pending action that outlasts the threshold gets a
  // polite, visible explanation next to the button. The live region mounts
  // (visually hidden and empty) as soon as loading starts so the later text is
  // announced reliably. Primary actions are usually writes, so the default copy
  // warns against resubmitting.
  const isSlow = useSlowState(showLoading, slowAfterMs);
  const trackSlow = showLoading && typeof slowAfterMs === 'number' && slowAfterMs > 0;
  const variants = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary/20',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 focus:ring-secondary/20',
    outline: 'border-2 border-border bg-transparent text-foreground hover:bg-muted focus:ring-border',
    ghost: 'bg-transparent text-foreground hover:bg-muted focus:ring-muted',
    danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus:ring-destructive/20',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus:ring-destructive/20',
    success: 'bg-success text-success-foreground hover:bg-success/90 focus:ring-success/20',
    warning: 'bg-warning text-warning-foreground hover:bg-warning/90 focus:ring-warning/20',
  };

  const sizes = {
    xs: 'min-h-11 px-2.5 text-xs',
    sm: 'min-h-11 px-3 text-sm',
    md: 'min-h-11 px-4 text-sm',
    lg: 'h-12 px-6 text-base',
    xl: 'h-14 px-8 text-base',
  };

  const iconSizes = {
    xs: 'w-3.5 h-3.5',
    sm: 'w-4 h-4',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
    xl: 'w-5 h-5',
  };

  // Always return the same fragment shape so the <button> never remounts (and
  // never loses focus) when loading toggles.
  return (
    <>
    <button
      ref={ref}
      disabled={showDisabled || showLoading}
      aria-busy={showLoading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
        'transition-colors duration-200 ease-out motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-0',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant] || variants.primary,
        sizes[size] || sizes.md,
        className
      )}
      {...props}
    >
      {showLoading && (
        <Loader2 aria-hidden="true" className={cn('animate-spin motion-reduce:animate-none', iconSizes[size] || iconSizes.md)} />
      )}
      {!showLoading && leftIcon && (
        <span aria-hidden="true" className={cn(iconSizes[size] || iconSizes.md)}>{leftIcon}</span>
      )}
      {children}
      {!showLoading && rightIcon && (
        <span aria-hidden="true" className={cn(iconSizes[size] || iconSizes.md)}>{rightIcon}</span>
      )}
    </button>
    {trackSlow && (
      <span
        role="status"
        aria-live="polite"
        className={isSlow ? 'basis-full w-full' : 'sr-only'}
      >
        {isSlow ? <SlowMessage kind={slowKind} guidance={slowGuidance} className="mt-1 text-xs" /> : null}
      </span>
    )}
    </>
  );
});

Button.displayName = 'Button';

export default Button;
