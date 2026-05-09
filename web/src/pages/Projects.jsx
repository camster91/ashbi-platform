import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { FolderOpen, ChevronRight, Plus, Clock, User, Tag } from 'lucide-react';
import { api } from '../lib/api';
import { getHealthColor, getProjectStatusColor, getProjectStatusLabel, cn } from '../lib/utils';
import CreateProjectModal from '../components/CreateProjectModal';

// Kanban column definitions
const KANBAN_COLUMNS = [
  {
    key: 'LEAD',
    label: 'Lead',
    headerColor: 'border-gray-400 text-gray-600',
    bgColor: 'bg-gray-50/50',
    statuses: ['STARTING_UP', 'ON_HOLD'],
  },
  {
    key: 'ACTIVE',
    label: 'Active',
    headerColor: 'border-blue-400 text-blue-600',
    bgColor: 'bg-blue-50/30',
    statuses: ['ACTIVE', 'DESIGN_DEV', 'ADDING_CONTENT'],
  },
  {
    key: 'REVIEW',
    label: 'Review',
    headerColor: 'border-yellow-400 text-yellow-600',
    bgColor: 'bg-yellow-50/30',
    statuses: ['FINALIZING'],
  },
  {
    key: 'DONE',
    label: 'Done',
    headerColor: 'border-green-400 text-green-600',
    bgColor: 'bg-green-50/30',
    statuses: ['LAUNCHED', 'CANCELLED'],
  },
];

// Hardcoded Ashbi Design projects for Phase 1 (fallback when API returns empty)
const ASHBI_DESIGN_PROJECTS = [
  {
    id: 'ashbi-1', name: 'Motomotus',
    client: { name: 'Morgan Campbell', email: 'morgan@motomotus.com' },
    status: 'LAUNCHED', health: 'ON_TRACK',
    createdAt: '2025-11-01', updatedAt: '2025-12-15',
    tags: ['Web', 'Branding'],
    aiSummary: 'Full website redesign and rebranding. Launched December 2025.',
    _count: { tasks: 24, threads: 12 },
  },
  {
    id: 'ashbi-2', name: 'TotalETO',
    client: { name: 'TotalETO', email: 'info@totaleto.com' },
    status: 'LAUNCHED', health: 'ON_TRACK',
    createdAt: '2025-09-01', updatedAt: '2025-11-20',
    tags: ['Web'],
    aiSummary: 'E-commerce platform. totaleto.com launched.',
    _count: { tasks: 18, threads: 8 },
  },
  {
    id: 'ashbi-3', name: 'Evergreen',
    client: { name: 'Walmart' },
    status: 'ACTIVE', health: 'AT_RISK',
    createdAt: '2026-02-01', updatedAt: '2026-04-15',
    tags: ['Landing Page'],
    aiSummary: 'Walmart landing page — past due since April 15.',
    _count: { tasks: 16, threads: 9 },
  },
  {
    id: 'ashbi-4', name: 'Numan',
    client: { name: 'Bionic' },
    status: 'ACTIVE', health: 'ON_TRACK',
    createdAt: '2026-01-15', updatedAt: '2026-05-01',
    tags: ['Web', 'Sub-Project'],
    aiSummary: 'Bionic sub-project — Launch Updates.',
    _count: { tasks: 12, threads: 6 },
  },
  {
    id: 'ashbi-5', name: 'Wellington',
    client: { name: 'Altus' },
    status: 'ACTIVE', health: 'ON_TRACK',
    createdAt: '2026-03-01', updatedAt: '2026-04-20',
    tags: ['Portal'],
    aiSummary: 'Altus portal — credentials in Notion.',
    _count: { tasks: 10, threads: 5 },
  },
  {
    id: 'ashbi-6', name: 'SSCA',
    client: { name: 'SSCA' },
    status: 'ACTIVE', health: 'ON_TRACK',
    createdAt: '2026-03-15', updatedAt: '2026-05-05',
    tags: ['Web'],
    aiSummary: 'foursonline.wpenginepowered.com.',
    _count: { tasks: 8, threads: 4 },
  },
  {
    id: 'ashbi-7', name: 'Gallery',
    client: { name: 'Ashbi Design' },
    status: 'FINALIZING', health: 'AT_RISK',
    createdAt: '2026-02-15', updatedAt: '2026-04-01',
    tags: ['Web', 'Images'],
    aiSummary: 'Images don\'t match descriptions — needs fixing.',
    _count: { tasks: 14, threads: 7 },
  },
  {
    id: 'ashbi-8', name: 'Commercial Decorating',
    client: { name: 'Commercial Decorating' },
    status: 'FINALIZING', health: 'AT_RISK',
    createdAt: '2026-03-01', updatedAt: '2026-04-10',
    tags: ['Web'],
    aiSummary: 'Hero section + contact page updates needed.',
    _count: { tasks: 10, threads: 5 },
  },
];

function getColumnForStatus(status) {
  for (const col of KANBAN_COLUMNS) {
    if (col.statuses.includes(status)) return col.key;
  }
  return 'LEAD'; // default
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
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
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="w-2.5 h-2.5" />
          {formatDate(project.updatedAt)}
        </div>
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
          <div className="text-center py-8 text-xs text-muted-foreground">
            No projects
          </div>
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
  const [searchParams] = useSearchParams();
  const [showCreateModal, setShowCreateModal] = useState(searchParams.get('create') === 'true');

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
  });

  // Use API data if available, otherwise fall back to hardcoded Ashbi Design projects
  const displayProjects = (projects && projects.length > 0) ? projects : ASHBI_DESIGN_PROJECTS;

  // Group projects by kanban column
  const columns = KANBAN_COLUMNS.map((col) => {
    const colProjects = displayProjects.filter((p) => col.statuses.includes(p.status));
    return { ...col, projects: colProjects };
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {displayProjects.length} total · Kanban view
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
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
