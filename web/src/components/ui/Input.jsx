import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

/**
 * Class list for a field with the Input look. Use it on `<select>` and
 * `<textarea>`, which Input (an `<input>`) cannot render.
 */
export function inputStyles(className) {
  return cn(
    'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm',
    'placeholder:text-muted-foreground',
    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus:ring-destructive',
    className
  );
}

const Input = forwardRef(({
  className,
  type = 'text',
  ...props
}, ref) => {
  return (
    <input
      type={type}
      className={inputStyles(className)}
      ref={ref}
      {...props}
    />
  );
});

Input.displayName = 'Input';

export default Input;