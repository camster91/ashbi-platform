import { formatDate } from '../../lib/format';

// Shared data helpers for the Projects page (pages/Projects.jsx) and its
// board, list and calendar views in this folder.

// Board columns (design: Projects mockup). Project status vocabularies still
// differ between the DB model and the API (#405), so every value either maps
// to a column here or lands in the visible "Other" column: no project is
// dropped.
export const BOARD_COLUMNS = [
  {
    key: 'PLANNING',
    label: 'Planning',
    emptyText: 'Nothing in planning.',
    statuses: ['STARTING_UP', 'ON_HOLD', 'DRAFT'],
  },
  {
    key: 'IN_PROGRESS',
    label: 'In progress',
    emptyText: 'No projects in progress.',
    statuses: ['ACTIVE', 'DESIGN_DEV', 'ADDING_CONTENT'],
  },
  {
    key: 'REVIEW',
    label: 'Client review',
    emptyText: 'Nothing is waiting for review.',
    statuses: ['FINALIZING'],
  },
  {
    key: 'LAUNCHED',
    label: 'Launched',
    emptyText: 'Nothing launched yet.',
    statuses: ['LAUNCHED', 'COMPLETED', 'CANCELLED'],
  },
];

export const OTHER_COLUMN = { key: 'OTHER', label: 'Other', emptyText: '', statuses: [] };

// The Launched column shows this many of its most recent projects first.
export const LAUNCHED_VISIBLE = 5;

const CLOSED_STATUSES = new Set(['LAUNCHED', 'COMPLETED', 'CANCELLED']);
const REVIEW_STATUSES = new Set(['FINALIZING']);
const DAY_MS = 86400000;

export function isClosedProject(project) {
  return CLOSED_STATUSES.has(project?.status);
}

export function columnKeyFor(status) {
  return BOARD_COLUMNS.find((column) => column.statuses.includes(status))?.key ?? OTHER_COLUMN.key;
}

export function groupProjectsByColumn(projects) {
  const known = new Set(BOARD_COLUMNS.flatMap((col) => col.statuses));
  const columns = BOARD_COLUMNS.map((col) => ({
    ...col,
    projects: projects.filter((p) => col.statuses.includes(p.status)),
  }));
  const other = projects.filter((p) => !known.has(p.status));
  if (other.length > 0) columns.push({ ...OTHER_COLUMN, projects: other });
  return columns;
}

function time(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

// Most recently finished first, so "Show older" reveals the rest.
export function sortByFinished(projects) {
  return [...projects].sort((a, b) => (time(b.completedAt) ?? time(b.updatedAt) ?? 0) - (time(a.completedAt) ?? time(a.updatedAt) ?? 0));
}

// Start of the UTC calendar day; project due dates are calendar dates.
function utcDay(ms) {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// 'overdue' | 'soon' (within 7 days) | 'later' | null (no due date or closed).
export function dueState(project, now = Date.now()) {
  const due = time(project?.endDate);
  if (due === null || isClosedProject(project)) return null;
  const days = (utcDay(due) - utcDay(now)) / DAY_MS;
  if (days < 0) return 'overdue';
  if (days <= 7) return 'soon';
  return 'later';
}

export function projectSummary(projects, now = Date.now()) {
  let active = 0;
  let dueThisWeek = 0;
  let overdue = 0;
  let inReview = 0;
  for (const project of projects) {
    if (!isClosedProject(project)) active += 1;
    if (REVIEW_STATUSES.has(project.status)) inReview += 1;
    const due = dueState(project, now);
    if (due === 'soon') dueThisWeek += 1;
    if (due === 'overdue') overdue += 1;
  }
  return { total: projects.length, active, dueThisWeek, overdue, inReview };
}

export function taskProgress(project) {
  const total = project?._count?.tasks || 0;
  const done = Math.min(project?.completedTaskCount || 0, total);
  return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Owner filter values kept in ?owner=: 'me', 'none' or a team member id.
export function matchesOwner(project, owner, userId) {
  if (!owner) return true;
  if (owner === 'none') return !project.defaultOwnerId;
  if (owner === 'me') return Boolean(userId) && project.defaultOwnerId === userId;
  return project.defaultOwnerId === owner;
}

// Team members who can own a project, from GET /api/team.
export function teamOwners(team) {
  const list = Array.isArray(team) ? team : Array.isArray(team?.team) ? team.team : [];
  return list.filter((member) => member?.id && member.isActive !== false && ['ADMIN', 'TEAM'].includes(member.role));
}

// "Oct 24" this year, "Oct 24, 2027" otherwise. Calendar dates (UTC).
export function shortDate(value, now = new Date()) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return formatDate(date, { dateOnly: true, year: sameYear ? undefined : 'numeric' });
}
