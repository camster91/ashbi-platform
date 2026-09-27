import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Clock, User, Tag, CalendarDays } from 'lucide-react';
import { api } from '../lib/api';
import { EmptyState, KanbanPageSkeleton } from '../components/ui';
import QueryErrorState from '../components/QueryErrorState';
import { getHealthColor, getProjectStatusColor, getProjectStatusLabel, cn } from '../lib/utils';
import CreateProjectModal from '../components/CreateProjectModal';
import { formatDate } from '../lib/format';

// Kanban column definitions. Project status vocabularies still differ between
// the DB model and the API (#405), so every value either maps to a column here
// or lands in the visible "Other" column — no project is dropped.
const KANBAN_COLUMNS = [
  {
    key: 'LEAD',
    label: 'Lead',
    emptyText: 'No leads right now.',
    headerColor: 'border-gray-400 text-gray-700 dark:text-gray-300',
    bgColor: 'bg-muted/40',
    statuses: ['STARTING_UP', 'ON_HOLD', 'DRAFT'],
  },
  {
    key: 'ACTIVE',
    label: 'Active',
    emptyText: 'No active projects.',
    headerColor: 'border-blue-400 text-blue-700 dark:text-blue-300',
    bgColor: 'bg-muted/40',
    statuses: ['ACTIVE', 'DESIGN_DEV', 'ADDING_CONTENT'],
  },
  {
    key: 'REVIEW',
    label: 'Review',
    emptyText: 'Nothing is waiting for review.',
    headerColor: 'border-yellow-400 text-yellow-800 dark:text-yellow-300',
    bgColor: 'bg-muted/40',
    statuses: ['FINALIZING'],
  },
  {
    key: 'DONE',
    label: 'Done',
    emptyText: 'No finished projects yet.',
    headerColor: 'border-green-400 text-green-800 dark:text-green-300',
    bgColor: 'bg-muted/40',
    statuses: ['LAUNCHED', 'COMPLETED', 'CANCELLED'],
  },
];

const OTHER_COLUMN = {
  key: 'OTHER',
  label: 'Other',
  emptyText: '',
  headerColor: 'border-border text-muted-foreground',
  bgColor: 'bg-muted/40',
  statuses: [],
};

export function groupProjectsByColumn(projects) {
  const known = new Set(KANBAN_COLUMNS.flatMap((col) => col.statuses));
  const columns = KANBAN_COLUMNS.map((col) => ({
    ...col,
    projects: projects.filter((p) => col.statuses.includes(p.status)),
  }));
  const other = projects.filter((p) => !known.has(p.status));
  if (other.length > 0) columns.push({ ...OTHER_COLUMN, projects: other });
  return columns;
}

function ProjectCard({ project }) {
  const totalTasks = (project._count?.tasks || 0);
  const completedTasks = project.completedTaskCount || 0;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <Link
      to={`/project/${project.id}`}
      className="block bg-card rounded-lg border border-border p-3 hover:border-primary/30 hover:shadow-sm transition-all group"
    >
      {/* Header: name + health */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors truncate">
          {project.name}
        </h3>
        {project.health && (
          <span className={cn('px-1.5 py-0.5 text-[10px] font-medium rounded flex-shrink-0', getHealthColor(project.health))}>
            {project.health === 'AT_RISK' ? '⚠' : project.health === 'ON_TRACK' ? '✓' : ''}
          </span>
        )}
      </div>

      {/* Client name */}
      {project.client && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
          <User className="w-3 h-3" />
          <span className="truncate">{project.client.name}</span>
          {project.client.email && (
            <span className="text-[10px] opacity-50 truncate">{project.client.email}</span>
          )}
        </div>
      )}

      {/* Summary */}
      {project.aiSummary && (
        <p className="text-xs text-muted-foreground mb-2 line-clamp-2 leading-relaxed">
          {project.aiSummary}
        </p>
      )}

      {/* Tags */}
      {project.tags && project.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {project.tags.map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 text-[10px] bg-muted rounded text-muted-foreground flex items-center gap-0.5">
              <Tag className="w-2.5 h-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Status badge + last activity */}
      <div className="flex items-center justify-between gap-2">
        <span className={cn('px-1.5 py-0.5 text-[10px] font-medium rounded-full', getProjectStatusColor(project.status))}>
          {getProjectStatusLabel(project.status)}
        </span>
        {project.endDate ? (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <CalendarDays className="w-3 h-3" aria-hidden="true" />
            <span>Due {formatDate(project.endDate)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="w-3 h-3" aria-hidden="true" />
            <span>Updated {formatDate(project.updatedAt)}</span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {totalTasks > 0 && (
        <div className="mt-2">
          <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  );
}

function KanbanColumn({ column, projects, count }) {
  return (
    <div className="flex flex-col min-w-[280px] max-w-[320px] flex-shrink-0">
      {/* Column header */}
      <div className={cn('flex items-center gap-2 pb-2 mb-3 border-b-2', column.headerColor)}>
        <h2 className="text-sm font-semibold uppercase tracking-wider">{column.label}</h2>
        <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full tabular-nums">{count}</span>
      </div>

      {/* Cards */}
      <div className={cn('flex-1 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)] p-1', column.bgColor, 'rounded-lg')}>
        {projects.length === 0 ? (
          <EmptyState
            icon="projects"
            title="No projects"
            description={column.emptyText}
            className="py-8"
          />
        ) : (
          projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))
        )}
      </div>
    </div>
  );
}

export default function Projects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const showCreateModal = searchParams.get('create') === 'true';
  const preselectedClientId = searchParams.get('clientId') || '';

  const openCreateModal = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('create', 'true');
    nextParams.delete('clientId');
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  const closeCreateModal = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('create');
    nextParams.delete('clientId');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const { data: projects = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects().then((r) => r?.projects ?? []),
  });

  // Show real API data only. (Previously fell back to hardcoded demo projects
  // when the response looked empty, which hid real projects.)
  const displayProjects = Array.isArray(projects) ? projects : [];

  // Group projects by kanban column (unknown statuses go to "Other")
  const columns = groupProjectsByColumn(displayProjects);

  if (isLoading) {
    return <KanbanPageSkeleton label="Loading projects" />;
  }

  if (isError) {
    return (
      <QueryErrorState
        error={error}
        message="Projects could not be loaded"
        onRetry={refetch}
        isRetrying={isFetching}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {displayProjects.length} total · Kanban view
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="min-h-11 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          New Project
        </button>
      </div>

      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={closeCreateModal}
        preselectedClientId={preselectedClientId}
      />

      {/* Kanban Board */}
      <div
        className="flex gap-4 overflow-x-auto pb-4 min-w-0 [contain:inline-size] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        role="region"
        aria-label="Project status board"
        tabIndex={0}
      >
        {columns.map((col) => (
          <KanbanColumn
            key={col.key}
            column={col}
            projects={col.projects}
            count={col.projects.length}
          />
        ))}
      </div>
    </div>
  );
}
