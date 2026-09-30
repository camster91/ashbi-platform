import { forwardRef } from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '../../lib/utils';

const VARIANTS = {
  error: {
    container: 'border-destructive/30 bg-destructive/5 dark:bg-destructive/10',
    icon: 'text-destructive',
    Icon: AlertCircle,
  },
  warning: {
    container: 'border-warning/30 bg-warning/5 dark:bg-warning/10',
    icon: 'text-warning',
    Icon: AlertTriangle,
  },
  success: {
    container: 'border-success/30 bg-success/5 dark:bg-success/10',
    icon: 'text-success',
    Icon: CheckCircle2,
  },
  info: {
    container: 'border-info/30 bg-info/5 dark:bg-info/10',
    icon: 'text-info',
    Icon: Info,
  },
};

const Alert = forwardRef(({
  variant = 'info',
  title,
  children,
  onDismiss,
  action,
  className,
  role,
  live = true,
  dismissLabel = 'Dismiss',
  ...props
}, ref) => {
  const config = VARIANTS[variant] || VARIANTS.info;
  const Icon = config.Icon;
  const isAssertive = variant === 'error' || variant === 'warning';
  // `live={false}` renders a static banner (no role, no live region) for
  // content that is present on page load and must not be announced, such as
  // the client portal's overdue-invoice notice.
  const liveRole = live ? (role || (isAssertive ? 'alert' : 'status')) : role;
  const ariaLive = live ? (isAssertive ? 'assertive' : 'polite') : undefined;

  return (
    <div
      ref={ref}
      role={liveRole}
      aria-live={ariaLive}
      className={cn(
        'flex gap-3 rounded-xl border px-4 py-3 animate-fade-in motion-reduce:animate-none text-foreground',
        config.container,
        className
      )}
      {...props}
    >
      <Icon className={cn('w-5 h-5 mt-0.5 flex-shrink-0', config.icon)} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold text-sm">{title}</p>}
        {children && (
          <div className={cn('text-sm text-muted-foreground', title && 'mt-0.5')}>
            {children}
          </div>
        )}
        {action && <div className="mt-3">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="min-h-11 min-w-11 -m-2 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
});

Alert.displayName = 'Alert';

export default Alert;
