// One status vocabulary for every domain the SPA shows a status pill for
// (#315, #316). Each entry maps a stored status to:
//
// - `label`: the text shown to staff. The label always states the status,
//   so colour is never the only signal (WCAG 1.4.1).
// - `clientLabel` (optional): the wording clients see on public/portal pages,
//   for example an invoice that is "Sent" internally is "Awaiting Payment" to
//   the client.
// - `color`: a `Badge` colour (`default`, `primary`, `success`, `warning`,
//   `danger`, `accent`, `info`), which resolves to design tokens.
// - `variant` (optional): a `Badge` variant; `subtle` when omitted.
// - `icon`: a lucide icon rendered next to the label as a second, non-colour
//   cue. It is decorative (`aria-hidden`) because the label carries meaning.
//
// Render a status with `<StatusBadge domain="invoice" status={invoice.status} />`
// from `components/ui`. Use `statusClasses()` only where a plain class string is
// needed (legacy call sites that build their own pill).
import {
  AlertTriangle,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Ban,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Eye,
  FileText,
  Hammer,
  Hourglass,
  Lock,
  Minus,
  MessageSquareWarning,
  PauseCircle,
  PenLine,
  Rocket,
  Send,
  XCircle,
} from 'lucide-react';

export const STATUS_DOMAINS = {
  invoice: {
    DRAFT: { label: 'Draft', color: 'default', icon: FileText },
    SENT: { label: 'Sent', clientLabel: 'Awaiting Payment', color: 'info', icon: Send },
    VIEWED: { label: 'Viewed', color: 'info', icon: Eye },
    PAID: { label: 'Paid', color: 'success', icon: CheckCircle2 },
    OVERDUE: { label: 'Overdue', color: 'danger', icon: AlertTriangle },
    VOID: { label: 'Void', color: 'default', icon: Ban },
    CANCELLED: { label: 'Cancelled', color: 'default', icon: Ban },
  },
  estimate: {
    DRAFT: { label: 'Draft', color: 'default', icon: FileText },
    SENT: { label: 'Sent', clientLabel: 'Pending Review', color: 'info', icon: Send },
    APPROVED: { label: 'Approved', color: 'success', icon: CheckCircle2 },
    DECLINED: { label: 'Declined', color: 'danger', icon: XCircle },
    CONVERTED: { label: 'Converted', color: 'primary', icon: ArrowRightLeft },
    EXPIRED: { label: 'Expired', color: 'warning', icon: Hourglass },
  },
  proposal: {
    DRAFT: { label: 'Draft', color: 'default', icon: FileText },
    SENT: { label: 'Sent', clientLabel: 'Awaiting Response', color: 'info', icon: Send },
    VIEWED: { label: 'Viewed', color: 'warning', icon: Eye },
    APPROVED: { label: 'Approved', color: 'success', icon: CheckCircle2 },
    DECLINED: { label: 'Declined', color: 'danger', icon: XCircle },
  },
  contract: {
    DRAFT: { label: 'Draft', color: 'default', icon: FileText },
    SENT: { label: 'Sent', clientLabel: 'Awaiting Signature', color: 'info', icon: Send },
    SIGNED: { label: 'Signed', color: 'success', icon: PenLine },
    VOID: { label: 'Void', color: 'danger', icon: Ban },
  },
  project: {
    STARTING_UP: { label: 'Starting Up', color: 'default', icon: Circle },
    DESIGN_DEV: { label: 'Design & Dev', color: 'info', icon: Hammer },
    ADDING_CONTENT: { label: 'Adding Content', color: 'accent', icon: PenLine },
    FINALIZING: { label: 'Finalizing', color: 'warning', icon: Hourglass },
    LAUNCHED: { label: 'Launched', color: 'success', icon: Rocket },
    ACTIVE: { label: 'Active', color: 'success', icon: CircleDot },
    ON_HOLD: { label: 'On Hold', color: 'default', icon: PauseCircle },
    CANCELLED: { label: 'Cancelled', color: 'danger', icon: XCircle },
  },
  task: {
    PENDING: { label: 'To Do', color: 'default', icon: Circle },
    UPCOMING: { label: 'To Do', color: 'default', icon: Circle },
    IMMEDIATE: { label: 'To Do', color: 'warning', icon: Clock },
    IN_PROGRESS: { label: 'In Progress', color: 'info', icon: CircleDot },
    COMPLETED: { label: 'Done', color: 'success', icon: CheckCircle2 },
    BLOCKED: { label: 'Blocked', color: 'danger', icon: AlertTriangle },
  },
  approval: {
    PENDING: { label: 'Pending', color: 'warning', icon: Clock },
    APPROVED: { label: 'Approved', color: 'success', icon: CheckCircle2 },
    REJECTED: { label: 'Rejected', color: 'danger', icon: XCircle },
    EXPIRED: { label: 'Expired', color: 'default', icon: Hourglass },
  },
  priority: {
    CRITICAL: { label: 'Critical', color: 'danger', icon: AlertTriangle },
    HIGH: { label: 'High', color: 'warning', icon: ArrowUp },
    NORMAL: { label: 'Normal', color: 'info', icon: Minus },
    LOW: { label: 'Low', color: 'default', icon: ArrowDown },
  },
  health: {
    ON_TRACK: { label: 'On track', color: 'success', icon: CheckCircle2 },
    NEEDS_ATTENTION: { label: 'Needs attention', color: 'warning', icon: AlertTriangle },
    AT_RISK: { label: 'At risk', color: 'danger', icon: AlertTriangle },
  },
  thread: {
    OPEN: { label: 'Open', color: 'info', icon: CircleDot },
    AWAITING_RESPONSE: { label: 'Awaiting response', color: 'warning', icon: Clock },
    RESOLVED: { label: 'Resolved', color: 'success', icon: CheckCircle2 },
    SNOOZED: { label: 'Snoozed', color: 'default', icon: PauseCircle },
  },
  review: {
    open: { label: 'Open', color: 'default', icon: CircleDot },
    approved: { label: 'Approved', color: 'success', variant: 'solid', icon: CheckCircle2 },
    changes_requested: { label: 'Changes requested', color: 'warning', variant: 'solid', icon: MessageSquareWarning },
    closed: { label: 'Closed', color: 'default', icon: Lock },
  },
};

// Class strings for Badge's `subtle` treatment, keyed by Badge colour. Kept in
// step with `components/ui/Badge.jsx` for call sites that cannot render a
// Badge (for example a `<select>` option tint or a legacy pill).
export const STATUS_TONE_CLASSES = {
  default: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  accent: 'bg-accent/40 text-accent-foreground',
  info: 'bg-info/10 text-info',
};

function humanize(status) {
  if (!status) return 'Unknown';
  return String(status).replace(/_/g, ' ');
}

/**
 * Look up a status. Unknown statuses fall back to a neutral entry whose label
 * is the status with underscores as spaces, so a new backend value still renders as text.
 *
 * @param {keyof typeof STATUS_DOMAINS} domain
 * @param {string} status
 * @param {{ audience?: 'staff' | 'client' }} [options]
 */
export function getStatus(domain, status, { audience = 'staff' } = {}) {
  const map = STATUS_DOMAINS[domain];
  if (!map) throw new Error(`Unknown status domain: ${domain}`);
  const entry = map[status];
  if (!entry) {
    return { status, label: humanize(status), color: 'default', variant: 'subtle', icon: Circle, known: false };
  }
  const label = audience === 'client' && entry.clientLabel ? entry.clientLabel : entry.label;
  return { status, variant: 'subtle', ...entry, label, known: true };
}

export function statusLabel(domain, status, options) {
  return getStatus(domain, status, options).label;
}

export function statusColor(domain, status) {
  return getStatus(domain, status).color;
}

/** Token classes (subtle tint + text) for a status, for non-Badge pills. */
export function statusClasses(domain, status) {
  return STATUS_TONE_CLASSES[statusColor(domain, status)] || STATUS_TONE_CLASSES.default;
}
