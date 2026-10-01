import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Clock, AlertTriangle, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDate } from '../lib/utils';
import LoadingState from '../components/ui/LoadingState';
import usePortalLightTheme from '../hooks/usePortalLightTheme';
import StatusBadge from '../components/ui/StatusBadge';
import { statusLabel } from '../lib/status';

const phases = ['STARTING_UP', 'DESIGN_DEV', 'ADDING_CONTENT', 'FINALIZING', 'LAUNCHED'];

const taskStatusIcons = {
  PENDING: <Clock className="w-4 h-4 text-muted-foreground" />,
  IN_PROGRESS: <AlertTriangle className="w-4 h-4 text-info" />,
  BLOCKED: <AlertTriangle className="w-4 h-4 text-destructive" />,
  COMPLETED: <CheckCircle className="w-4 h-4 text-success" />,
};

export default function Portal() {
  usePortalLightTheme();
  const { token } = useParams();

  const {
    data: project,
    isLoading,
    isError: portalError,
    error,
    refetch: refetchPortal,
    isFetching: portalFetching,
  } = useQuery({
    queryKey: ['portal', token],
    queryFn: () => api.getPortal(token),
    retry: false,
  });

  if (isLoading) {
    return <LoadingState label="Loading project portal…" className="min-h-screen bg-background text-foreground" spinnerClassName="border-border/60 border-t-primary" />;
  }

  const portalNotFound = error?.status === 404;

  if (portalError && !portalNotFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div role="alert" className="max-w-md rounded-xl border border-destructive/30 bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-foreground mb-2">Portal temporarily unavailable</h1>
          <p className="text-muted-foreground">The project could not be loaded. Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => refetchPortal()}
            disabled={portalFetching}
            className="mt-5 min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {portalFetching ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  if (portalNotFound || !project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Project Not Found</h1>
          <p className="text-muted-foreground">This portal link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  const currentPhaseIndex = phases.indexOf(project.status);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border/40 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Ashbi Design</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground mt-3">{project.name}</h1>
          {project.clientName && (
            <p className="text-muted-foreground mt-1">{project.clientName}</p>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Status & Phase Progress */}
        <div className="bg-card rounded-xl border border-border/40 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Current Status</h2>
              <StatusBadge
                domain="project"
                status={project.status || 'STARTING_UP'}
                audience="client"
                size="md"
                className="mt-2 gap-2 px-3 py-1.5 font-semibold"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Last updated {formatDate(project.updatedAt)}
            </p>
          </div>

          {/* Phase Progress Bar */}
          <div className="flex items-center gap-1">
            {phases.map((phase, i) => {
              const isComplete = i < currentPhaseIndex;
              const isCurrent = i === currentPhaseIndex;
              return (
                <div key={phase} className="flex-1">
                  <div
                    className={cn(
                      'h-2 rounded-full transition-all',
                      isComplete ? 'bg-success' : isCurrent ? 'bg-info' : 'bg-border/30'
                    )}
                  />
                  <p className={cn(
                    'text-xs mt-1.5 text-center',
                    isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground'
                  )}>
                    {statusLabel('project', phase, { audience: 'client' })}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Summary */}
        {project.aiSummary && (
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Project Summary</h2>
            <p className="text-foreground leading-relaxed">{project.aiSummary}</p>
          </div>
        )}

        {/* Description */}
        {project.description && (
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">About</h2>
            <p className="text-foreground leading-relaxed">{project.description}</p>
          </div>
        )}

        {/* Milestones */}
        {project.milestones?.length > 0 && (
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Milestones</h2>
            <div className="space-y-3">
              {project.milestones.map((m) => (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  {m.completedAt ? (
                    <CheckCircle className="w-5 h-5 text-success flex-shrink-0" />
                  ) : (
                    <Clock className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  )}
                  <span className={cn('flex-1 text-sm', m.completedAt ? 'text-muted-foreground line-through' : 'text-foreground')}>
                    {m.name}
                  </span>
                  {m.dueDate && (
                    <span className="text-xs text-muted-foreground">{formatDate(m.dueDate)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Tasks */}
        {project.activeTasks?.length > 0 && (
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Active Tasks ({project.activeTasks.length})
            </h2>
            <div className="space-y-2">
              {project.activeTasks.map((task, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  {taskStatusIcons[task.status] || taskStatusIcons.PENDING}
                  <span className="flex-1 text-sm text-foreground">{task.title}</span>
                  <span className="text-xs text-muted-foreground capitalize">{task.status.toLowerCase().replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Revision Rounds */}
        {project.revisionRounds?.length > 0 && (
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Revision History</h2>
            <div className="space-y-3">
              {project.revisionRounds.map((rev) => (
                <div key={rev.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <span className="w-8 h-8 rounded-full bg-border/30 flex items-center justify-center text-xs font-bold text-muted-foreground">
                    R{rev.roundNumber}
                  </span>
                  <div className="flex-1">
                    <span className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded-full',
                      rev.status === 'APPROVED' ? 'bg-success/10 text-success' :
                      rev.status === 'IN_REVIEW' ? 'bg-info/10 text-info' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {rev.status}
                    </span>
                    {rev.notes && <p className="text-xs text-muted-foreground mt-1">{rev.notes}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDate(rev.requestedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pinned Notes */}
        {project.pinnedNotes?.length > 0 && (
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Updates</h2>
            <div className="space-y-4">
              {project.pinnedNotes.map((note) => (
                <div key={note.id} className="p-4 rounded-lg bg-muted/50 border border-border/25">
                  <h3 className="font-medium text-foreground mb-1">{note.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-3">{note.content}</p>
                  <p className="text-xs text-muted-foreground mt-2">{formatDate(note.updatedAt)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-muted-foreground">
            Powered by Ashbi Design
          </p>
        </div>
      </main>
    </div>
  );
}
