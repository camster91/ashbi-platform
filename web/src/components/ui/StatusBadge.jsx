import { forwardRef } from 'react';
import Badge from './Badge';
import { getStatus } from '../../lib/status';
import { cn } from '../../lib/utils';

/**
 * A domain status pill (invoice, estimate, proposal, contract, project, task,
 * review) drawn from `lib/status.js`. It always shows the status label and a
 * decorative icon, so status is never conveyed by colour alone.
 */
const StatusBadge = forwardRef(({
  domain,
  status,
  audience = 'staff',
  size = 'sm',
  showIcon = true,
  label,
  className,
  ...props
}, ref) => {
  const entry = getStatus(domain, status, { audience });
  const Icon = entry.icon;
  return (
    <Badge
      ref={ref}
      color={entry.color}
      variant={entry.variant}
      size={size}
      data-status={status}
      className={cn('whitespace-nowrap', className)}
      {...props}
    >
      {showIcon && Icon && <Icon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />}
      {label ?? entry.label}
    </Badge>
  );
});

StatusBadge.displayName = 'StatusBadge';

export default StatusBadge;
