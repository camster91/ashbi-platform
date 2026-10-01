import { forwardRef } from 'react';
import { inputStyles } from './Input';

/**
 * A native `<select>` with the Input look. Pass `<option>` children, or an
 * `options` array of `{ value, label, disabled }`. `placeholder` adds a first,
 * disabled empty option, selected initially when the select is uncontrolled.
 */
const Select = forwardRef(({ className, options, placeholder, children, ...props }, ref) => {
  // Uncontrolled with a placeholder: start on it, rather than on the first
  // real option (the browser skips a disabled first option by default).
  const startOnPlaceholder = placeholder !== undefined
    && props.value === undefined
    && props.defaultValue === undefined;

  return (
    <select
      ref={ref}
      className={inputStyles(['min-h-11 pr-8', className])}
      {...(startOnPlaceholder ? { defaultValue: '' } : {})}
      {...props}
    >
      {placeholder !== undefined && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options
        ? options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label ?? option.value}
          </option>
        ))
        : children}
    </select>
  );
});

Select.displayName = 'Select';

export default Select;
