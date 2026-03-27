import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { FolderOpen, MessageSquare, ChevronRight, Plus, Share2, CheckSquare } from 'lucide-react';
import { api } from '../lib/api';
import { getHealthColor, getProjectStatusColor, getProjectStatusLabel, cn } from '../lib/utils';
import CreateProjectModal from '../components/CreateProjectModal';

export default function Projects() {
  const [searchParams] = useSearchParams();
  const [showCreateModal, setShowCreateModal] = useState(searchParams.get('create') === 'true');
  const [filterStatus, setFilterStatus] = useState('');

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
  });

  const filteredProjects = projects?.filter(p => {
    if (!filterStatus) return true;
    if (filterStatus === 'ACTIVE') return !['LAUNCHED', 'CANCELLED', 'ON_HOLD'].includes(p.status);
    return p.status === filterStatus;
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
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {projects?.length || 0} total, {projects?.filter(p => !['LAUNCHED', 'CANCELLED'].includes(p.status)).length || 0} active
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

      {/* Status Filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'ACTIVE', 'STARTING_UP', 'DESIGN_DEV', 'ADDING_CONTENT', 'FINALIZING', 'LAUNCHED', 'ON_HOLD'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg transition-colors',
              filterStatus === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {s === '' ? 'All' : s === 'ACTIVE' ? 'Active' : getProjectStatusLabel(s)}
          </button>
        ))}
      </div>

      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredProjects?.map((project) => {
          const totalTasks = (project._count?.tasks || 0);
          const completedTasks = project.completedTaskCount || 0;
          const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

          return (
            <Link
              key={project.id}
              to={`/project/${project.id}`}
              className="bg-card rounded-xl border border-border hover:border-primary/30 transition-all p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground truncate">{project.name}</h3>
                  <p className="text-sm text-muted-foreground">{project.client?.name}</p>
                </div>
                <span
                  className={cn(
                    'px-2 py-1 text-xs font-medium rounded ml-2 flex-shrink-0',
                    getHealthColor(project.health)
                  )}
                >
                  {project.health?.replace(/_/g, ' ')}
                </span>
              </div>

              {project.aiSummary && (
                <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                  {project.aiSummary}
                </p>
              )}

              <div className="mt-3 flex items-center gap-2">
                <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full', getProjectStatusColor(project.status))}>
                  {getProjectStatusLabel(project.status)}
                </span>
              </div>

              {/* Progress bar */}
              {totalTasks > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span className="flex items-center gap-1">
                      <CheckSquare className="w-3 h-3" />
                      {completedTasks}/{totalTasks} tasks
                    </span>
                    <span>{progressPct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                <span className="flex items-center">
                  <MessageSquare className="w-4 h-4 mr-1" />
                  {project._count?.threads || 0} threads
                </span>
                <span className="flex items-center">
                  <FolderOpen className="w-4 h-4 mr-1" />
                  {project._count?.tasks || 0} tasks
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {filteredProjects?.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No projects found with this filter.
        </div>
      )}
    </div>
  );
}
