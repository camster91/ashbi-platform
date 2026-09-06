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
    container: 'border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10',
    icon: 'text-amber-600 dark:text-amber-400',
    Icon: AlertTriangle,
  },
  success: {
    container: 'border-green-600/30 bg-green-500/5 dark:bg-green-500/10',
    icon: 'text-green-700 dark:text-green-400',
    Icon: CheckCircle2,
  },
  info: {
    container: 'border-blue-500/30 bg-blue-500/5 dark:bg-blue-500/10',
    icon: 'text-blue-700 dark:text-blue-400',
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
  ...props
}, ref) => {
  const config = VARIANTS[variant] || VARIANTS.info;
  const Icon = config.Icon;
  const isAssertive = variant === 'error' || variant === 'warning';

  return (
    <div
      ref={ref}
      role={role || (isAssertive ? 'alert' : 'status')}
      aria-live={isAssertive ? 'assertive' : 'polite'}
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
          aria-label="Dismiss"
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
