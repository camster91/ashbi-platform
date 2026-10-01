import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDate } from './format';
import { statusClasses, statusLabel } from './status';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Dates render through the shared Intl formatters in ./format so every screen
// uses one shape ("Sep 27, 2026" / "Sep 27, 2026, 3:04 p.m.").
export { formatDate, formatDateTime, formatMoney } from './format';

export function formatRelativeTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(date);
}

export function truncate(str, length = 100) {
  if (!str) return '';
  if (str.length <= length) return str;
  return str.substring(0, length) + '...';
}

// Status and priority pills share one vocabulary with `StatusBadge`; see
// `lib/status.js`. These return token classes for legacy pill markup.
export function getPriorityColor(priority) {
  return statusClasses('priority', priority);
}

export function getHealthColor(health) {
  return statusClasses('health', health);
}

export function getStatusColor(status) {
  return statusClasses('thread', status);
}

export function getProjectStatusColor(status) {
  return statusClasses('project', status);
}

export function getProjectStatusLabel(status) {
  return statusLabel('project', status);
}

export function getSentimentIcon(sentiment) {
  switch (sentiment) {
    case 'happy':
      return '😊';
    case 'frustrated':
      return '😤';
    case 'anxious':
      return '😰';
    case 'confused':
      return '😕';
    default:
      return '😐';
  }
}
