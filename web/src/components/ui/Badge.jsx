import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Badge = forwardRef(({
  children,
  variant = 'default',
  color = 'default',
  size = 'sm',
  dot = false,
  className,
  ...props
}, ref) => {
  const variants = {
    default: 'bg-muted text-muted-foreground',
    outline: 'border-2 bg-transparent',
    subtle: 'bg-opacity-10',
    solid: 'text-white',
  };

  const colors = {
    default: {
      default: 'bg-muted text-muted-foreground',
      outline: 'border-muted-foreground text-muted-foreground',
      subtle: 'bg-muted text-muted-foreground',
      solid: 'bg-muted-foreground text-white',
    },
    primary: {
      default: 'bg-primary text-primary-foreground',
      outline: 'border-primary text-primary',
      subtle: 'bg-primary/10 text-primary',
      solid: 'bg-primary text-white',
    },
    success: {
      default: 'bg-success text-success-foreground',
      outline: 'border-success text-success',
      subtle: 'bg-success/10 text-success',
      solid: 'bg-success text-white',
    },
    warning: {
      default: 'bg-warning text-warning-foreground',
      outline: 'border-warning text-warning',
      subtle: 'bg-warning/10 text-warning',
      solid: 'bg-warning text-white',
    },
    danger: {
      default: 'bg-destructive text-destructive-foreground',
      outline: 'border-destructive text-destructive',
      subtle: 'bg-destructive/10 text-destructive',
      solid: 'bg-destructive text-white',
    },
    info: {
      default: 'bg-info text-info-foreground',
      outline: 'border-info text-info',
      subtle: 'bg-info/10 text-info',
      solid: 'bg-info text-white',
    },
  };

  const sizes = {
    xs: 'px-1.5 py-0.5 text-xs',
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1 text-sm',
  };

  const dotColors = {
    default: 'bg-muted-foreground',
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-destructive',
    info: 'bg-info',
  };

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1.5 font-medium rounded-full',
        sizes[size],
        colors[color][variant],
        variant === 'outline' && 'border-2',
        className
      )}
      {...props}
    >
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full', dotColors[color])} />
      )}
      {children}
    </span>
  );
});

Badge.displayName = 'Badge';

export default Badge;
