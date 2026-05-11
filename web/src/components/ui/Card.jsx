import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Card = forwardRef(({
  children,
  variant = 'default',
  padding = 'md',
  isInteractive = false,
  className,
  ...props
}, ref) => {
  const variants = {
    default: 'bg-card text-card-foreground border border-border/60',
    elevated: 'bg-card text-card-foreground shadow-md border-0',
    outlined: 'bg-transparent border-2 border-border text-foreground',
    ghost: 'bg-transparent border-0 text-foreground',
    glass: 'glass-card',
  };

  const paddings = {
    none: '',
    xs: 'p-2',
    sm: 'p-3',
    md: 'p-5',
    lg: 'p-6',
    xl: 'p-10',
  };

  return (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl transition-all duration-300',
        variants[variant],
        paddings[padding],
        isInteractive && 'cursor-pointer hover-lift',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});

Card.displayName = 'Card';

// Card Header
const CardHeader = forwardRef(({ children, className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-2 mb-4', className)}
    {...props}
  >
    {children}
  </div>
));
CardHeader.displayName = 'CardHeader';

// Card Title
const CardTitle = forwardRef(({ children, className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('font-display font-bold text-xl leading-tight text-foreground', className)}
    {...props}
  >
    {children}
  </h3>
));
CardTitle.displayName = 'CardTitle';

// Card Description
const CardDescription = forwardRef(({ children, className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  >
    {children}
  </p>
));
CardDescription.displayName = 'CardDescription';

// Card Content
const CardContent = forwardRef(({ children, className, ...props }, ref) => (
  <div ref={ref} className={className} {...props}>
    {children}
  </div>
));
CardContent.displayName = 'CardContent';

// Card Footer
const CardFooter = forwardRef(({ children, className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center justify-between mt-4 pt-4 border-t border-border', className)}
    {...props}
  >
    {children}
  </div>
));
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
export default Card;
