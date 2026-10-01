import { Children, cloneElement, isValidElement, useId } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

const joinIds = (...ids) => ids.filter(Boolean).join(' ') || undefined;

/**
 * A labelled form field. It renders the `<label>`, an optional hint and an
 * optional error, and wires them to its single control child (Input, Select,
 * Textarea or any element that accepts these props):
 *
 * - `id` (the Field's `id`, else the child's own `id`, else generated),
 * - `aria-describedby` = hint id + error id (merged with the child's own),
 * - `aria-invalid` when `error` is set,
 * - `required` when `required` is set.
 *
 * Pass a function as the child to spread the props yourself:
 * `<Field label="Name">{(control) => <Input {...control} />}</Field>`.
 */
export default function Field({
  label,
  hint,
  error,
  required = false,
  id: idProp,
  className,
  labelClassName,
  children,
}) {
  const autoId = useId();
  // Keep an id the control already has, so existing label/test hooks survive.
  const childId = typeof children !== 'function' && isValidElement(children) ? children.props.id : undefined;
  const id = idProp || childId || `field${autoId.replace(/:/g, '')}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const controlProps = (own = {}) => ({
    id,
    'aria-describedby': joinIds(own['aria-describedby'], hintId, errorId),
    'aria-invalid': error ? true : own['aria-invalid'],
    required: required || own.required || undefined,
  });

  let control;
  if (typeof children === 'function') {
    control = children(controlProps());
  } else {
    const child = Children.only(children);
    control = isValidElement(child) ? cloneElement(child, controlProps(child.props)) : child;
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className={cn('block text-sm font-medium text-foreground', labelClassName)}>
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1 text-xs font-medium text-destructive">
          <AlertCircle className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
