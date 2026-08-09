import { cn } from '../../lib/utils';

const spinnerSizes = {
  sm: 'h-5 w-5',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

export default function LoadingState({
  label = 'Loading…',
  size = 'md',
  compact = false,
  className,
  spinnerClassName,
  as: Component = 'div',
  ...props
}) {
  return (
    <Component
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        'flex items-center justify-center gap-3 text-muted-foreground',
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
    </Component>
  );
}
