import { Link } from 'react-router-dom';
import { PORTFOLIO_OPTIONS } from '@shared/portfolio.js';
import { formatRelativeTime, getProjectStatusColor, getProjectStatusLabel, cn } from '../../lib/utils';
import { dueState, initials, shortDate, taskProgress } from './projectBoard';

// One project on the Projects board (design: Projects mockup). What the card
// shows depends on its column: planning shows the start, work in progress the
// task bar and due date, client review how long it has been there, launched
// the go-live date. The portfolio picker and task views link stay on every card.

const HEALTH = {
  AT_RISK: { label: 'At risk', className: 'bg-destructive/10 text-destructive' },
  NEEDS_ATTENTION: { label: 'Needs attention', className: 'bg-warning/10 text-warning' },
};

export function OwnerAvatar({ owner }) {
  if (!owner) return null;
  return (
    <span
      role="img"
      aria-label={`Owner ${owner.name}`}
      title={owner.name}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[0.6875rem] font-bold text-secondary-foreground"
    >
      {initials(owner.name)}
    </span>
  );
}

function StatusPill({ status }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', getProjectStatusColor(status))}>
      {getProjectStatusLabel(status)}
    </span>
  );
}

function DueLine({ project }) {
  const due = dueState(project);
  if (!project.endDate) {
    return <span className="text-muted-foreground">Updated {shortDate(project.updatedAt)}</span>;
  }
  return (
    <span className={cn(due === 'overdue' ? 'font-semibold text-destructive' : due === 'soon' ? 'font-semibold text-warning' : 'text-muted-foreground')}>
      <span>Due {shortDate(project.endDate)}</span>
      {due === 'overdue' && <span> · overdue</span>}
    </span>
  );
}

function ProgressBar({ project, label }) {
  const { total, done, percent } = taskProgress(project);
  if (total === 0) return null;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total} tasks done`}
      className="h-1.5 rounded-full bg-muted"
    >
      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}

function ColumnDetail({ column, project }) {
  const { total, done } = taskProgress(project);
  if (column === 'PLANNING') {
    return (
      <div className="text-xs text-muted-foreground">
        {project.startDate ? <span>Starts {shortDate(project.startDate)}</span> : <DueLine project={project} />}
      </div>
    );
  }
  if (column === 'IN_PROGRESS') {
    return (
      <>
        <ProgressBar project={project} label={`${project.name} tasks`} />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          <DueLine project={project} />
          {total > 0 && <span className="figure text-muted-foreground">{done} / {total} tasks</span>}
        </div>
      </>
    );
  }
  if (column === 'REVIEW') {
    const flagged = HEALTH[project.health];
    return (
      <div className={cn('rounded-md px-2 py-1.5 text-xs', flagged ? flagged.className : 'bg-secondary text-secondary-foreground')}>
        In client review · updated {formatRelativeTime(project.updatedAt)}
        {project.endDate && <> · due {shortDate(project.endDate)}</>}
      </div>
    );
  }
  if (column === 'LAUNCHED') {
    if (project.status === 'CANCELLED') return <div className="text-xs"><StatusPill status={project.status} /></div>;
    return (
      <div className="text-xs">
        {project.completedAt ? (
          <span className="rounded-full bg-success/10 px-2 py-0.5 font-semibold text-success">Live {shortDate(project.completedAt)}</span>
        ) : (
          <span className="text-muted-foreground">Updated {shortDate(project.updatedAt)}</span>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <StatusPill status={project.status} />
      <span className="text-muted-foreground">Updated {shortDate(project.updatedAt)}</span>
    </div>
  );
}

export function PortfolioPicker({ project, saving, onChange, className }) {
  return (
    <select
      aria-label={`Portfolio for ${project.name}`}
      value={project.portfolio || ''}
      disabled={saving}
      onChange={(event) => onChange(project.id, event.target.value || null)}
      className={cn('min-h-11 min-w-0 rounded-md border border-border/60 bg-card px-2 text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60', className)}
    >
      <option value="">Unclassified</option>
      {PORTFOLIO_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
    </select>
  );
}

export default function ProjectBoardCard({ project, column, owner, isAdmin, saving, onPortfolioChange }) {
  const flagged = HEALTH[project.health];
  const showStatus = column === 'PLANNING';
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-3.5">
      <Link
        to={`/project/${project.id}`}
        className="group -m-1 flex flex-col gap-2 rounded-md p-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">{project.client?.name || 'No client'}</span>
          {flagged && column !== 'REVIEW' && (
            <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold', flagged.className)}>{flagged.label}</span>
          )}
        </div>
        <h3 className="font-semibold text-foreground break-words group-hover:text-primary">{project.name}</h3>
        <ColumnDetail column={column} project={project} />
        {project.aiSummary && <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{project.aiSummary}</p>}
        {(showStatus || owner) && (
          <div className="flex items-center justify-between gap-2">
            {showStatus ? <StatusPill status={project.status} /> : <span />}
            <OwnerAvatar owner={owner} />
          </div>
        )}
      </Link>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/40 pt-2">
        <PortfolioPicker project={project} saving={saving} onChange={onPortfolioChange} className="flex-[1_1_8rem]" />
        <Link
          to={`/project/${project.id}/views`}
          className="inline-flex min-h-11 items-center rounded-md px-1 text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          Task views
        </Link>
        {isAdmin && column === 'LAUNCHED' && project.status !== 'CANCELLED' && project.client?.id && (
          <Link
            to={`/invoices?create=true&clientId=${encodeURIComponent(project.client.id)}`}
            className="inline-flex min-h-11 items-center rounded-md px-1 text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Final invoice for ${project.name}`}
          >
            Final invoice
          </Link>
        )}
      </div>
    </article>
  );
}
