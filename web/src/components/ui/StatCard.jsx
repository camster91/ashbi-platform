import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const StatCard = forwardRef(({
  label,
  value,
  icon: Icon,
  trend,
  trendValue,
  variant = 'default',
  className,
  ...props
}, ref) => {
  const variants = {
    default: 'bg-card border-border',
    primary: 'bg-primary/5 border-primary/20',
    success: 'bg-success/5 border-success/20',
    warning: 'bg-warning/5 border-warning/20',
    danger: 'bg-destructive/5 border-destructive/20',
  };

  const iconBgColors = {
    default: 'bg-muted text-muted-foreground',
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-destructive/10 text-destructive',
  };

  const valueColors = {
    default: 'text-foreground',
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
  };

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-success' : trend === 'down' ? 'text-destructive' : 'text-muted-foreground';

  return (
    <div
      ref={ref}
      className={cn(
        'relative overflow-hidden rounded-xl border p-5',
        'transition-all duration-200 hover:-translate-y-1 hover:shadow-lg',
        variants[variant],
        className
      )}
      {...props}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">
            {label}
          </p>
          <p className={cn('text-3xl font-heading font-bold tracking-tight', valueColors[variant])}>
            {value}
          </p>
          
          {(trend || trendValue) && (
            <div className="flex items-center gap-1 text-sm">
              <TrendIcon className={cn('w-4 h-4', trendColor)} />
              <span className={trendColor}>{trendValue}</span>
              <span className="text-muted-foreground">vs last period</span>
            </div>
          )}
        </div>
        
        {Icon && (
          <div className={cn('p-3 rounded-xl', iconBgColors[variant])}>
            <Icon className="w-6 h-6" />
          </div>
        )}
      </div>
      
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
    </div>
  );
});

StatCard.displayName = 'StatCard';

export default StatCard;
