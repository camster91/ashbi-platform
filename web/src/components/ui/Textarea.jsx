import { forwardRef } from 'react';
import { inputStyles } from './Input';

/** A native `<textarea>` with the Input look. */
const Textarea = forwardRef(({ className, rows = 4, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={inputStyles(['min-h-20 resize-y', className])} {...props} />
));

Textarea.displayName = 'Textarea';

export default Textarea;
