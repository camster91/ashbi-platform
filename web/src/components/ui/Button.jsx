import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

const Button = forwardRef(({
  children,
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  isLoading = false,
  isDisabled = false,
  className,
  ...props
}, ref) => {
  const variants = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary-600 focus:ring-primary/20',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 focus:ring-secondary/20',
    outline: 'border-2 border-border bg-transparent text-foreground hover:bg-muted focus:ring-border',
    ghost: 'bg-transparent text-foreground hover:bg-muted focus:ring-muted',
    danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus:ring-destructive/20',
    success: 'bg-success text-success-foreground hover:bg-success/90 focus:ring-success/20',
    warning: 'bg-warning text-warning-foreground hover:bg-warning/90 focus:ring-warning/20',
  };

  const sizes = {
    xs: 'h-7 px-2.5 text-xs',
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
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

  return (
    <button
      ref={ref}
      disabled={isDisabled || isLoading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
        'transition-all duration-200 ease-out',
        'focus:outline-none focus:ring-4 focus:ring-offset-0',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none',
        'hover:-translate-y-0.5 hover:shadow-md',
        'active:translate-y-0 active:shadow-sm',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {isLoading && (
        <Loader2 className={cn('animate-spin', iconSizes[size])} />
      )}
      {!isLoading && leftIcon && (
        <span className={cn(iconSizes[size])}>{leftIcon}</span>
      )}
      {children}
      {!isLoading && rightIcon && (
        <span className={cn(iconSizes[size])}>{rightIcon}</span>
      )}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
