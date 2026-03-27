import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle,
  Clock,
  AlertTriangle,
  Sparkles,
  FileText,
  Milestone as MilestoneIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDate } from '../lib/utils';

const statusConfig = {
  STARTING_UP: { label: 'Starting Up', color: 'bg-gray-100 text-gray-700', dotColor: 'bg-gray-400' },
  DESIGN_DEV: { label: 'Design & Dev', color: 'bg-blue-100 text-blue-700', dotColor: 'bg-blue-500' },
  ADDING_CONTENT: { label: 'Adding Content', color: 'bg-yellow-100 text-yellow-700', dotColor: 'bg-yellow-500' },
  FINALIZING: { label: 'Finalizing', color: 'bg-orange-100 text-orange-700', dotColor: 'bg-orange-500' },
  LAUNCHED: { label: 'Launched', color: 'bg-green-100 text-green-700', dotColor: 'bg-green-500' },
  ON_HOLD: { label: 'On Hold', color: 'bg-slate-100 text-slate-700', dotColor: 'bg-slate-400' },
  CANCELLED: { label: 'Cancelled', color: 'bg-red-100 text-red-700', dotColor: 'bg-red-500' },
};

const phases = ['STARTING_UP', 'DESIGN_DEV', 'ADDING_CONTENT', 'FINALIZING', 'LAUNCHED'];

const taskStatusIcons = {
  PENDING: <Clock className="w-4 h-4 text-muted-foreground" />,
  IN_PROGRESS: <AlertTriangle className="w-4 h-4 text-blue-500" />,
  BLOCKED: <AlertTriangle className="w-4 h-4 text-red-500" />,
  COMPLETED: <CheckCircle className="w-4 h-4 text-green-500" />,
};

export default function Portal() {
  const { token } = useParams();

  const { data: project, isLoading, error } = useQuery({
    queryKey: ['portal', token],
    queryFn: () => api.getPortal(token),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800"></div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Project Not Found</h1>
          <p className="text-slate-500">This portal link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  const status = statusConfig[project.status] || statusConfig.STARTING_UP;
  const currentPhaseIndex = phases.indexOf(project.status);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm font-medium text-slate-500">Ashbi Design</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mt-3">{project.name}</h1>
          {project.clientName && (
            <p className="text-slate-500 mt-1">{project.clientName}</p>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Status & Phase Progress */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Current Status</h2>
              <span className={cn('inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-full text-sm font-semibold', status.color)}>
                <span className={cn('w-2 h-2 rounded-full', status.dotColor)} />
                {status.label}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Last updated {formatDate(project.updatedAt)}
            </p>
          </div>

          {/* Phase Progress Bar */}
          <div className="flex items-center gap-1">
            {phases.map((phase, i) => {
              const phaseConf = statusConfig[phase];
              const isComplete = i < currentPhaseIndex;
              const isCurrent = i === currentPhaseIndex;
              return (
                <div key={phase} className="flex-1">
                  <div
                    className={cn(
                      'h-2 rounded-full transition-all',
                      isComplete ? 'bg-green-500' : isCurrent ? 'bg-blue-500' : 'bg-slate-200'
                    )}
                  />
                  <p className={cn(
                    'text-xs mt-1.5 text-center',
                    isCurrent ? 'font-semibold text-slate-800' : 'text-slate-400'
                  )}>
                    {phaseConf.label}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Summary */}
        {project.aiSummary && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">Project Summary</h2>
            <p className="text-slate-700 leading-relaxed">{project.aiSummary}</p>
          </div>
        )}

        {/* Description */}
        {project.description && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">About</h2>
            <p className="text-slate-700 leading-relaxed">{project.description}</p>
          </div>
        )}

        {/* Milestones */}
        {project.milestones?.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">Milestones</h2>
            <div className="space-y-3">
              {project.milestones.map((m) => (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50">
                  {m.completedAt ? (
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                  ) : (
                    <Clock className="w-5 h-5 text-slate-400 flex-shrink-0" />
                  )}
                  <span className={cn('flex-1 text-sm', m.completedAt ? 'text-slate-400 line-through' : 'text-slate-700')}>
                    {m.name}
                  </span>
                  {m.dueDate && (
                    <span className="text-xs text-slate-400">{formatDate(m.dueDate)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Tasks */}
        {project.activeTasks?.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Active Tasks ({project.activeTasks.length})
            </h2>
            <div className="space-y-2">
              {project.activeTasks.map((task, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50">
                  {taskStatusIcons[task.status] || taskStatusIcons.PENDING}
                  <span className="flex-1 text-sm text-slate-700">{task.title}</span>
                  <span className="text-xs text-slate-400 capitalize">{task.status.toLowerCase().replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Revision Rounds */}
        {project.revisionRounds?.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">Revision History</h2>
            <div className="space-y-3">
              {project.revisionRounds.map((rev) => (
                <div key={rev.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50">
                  <span className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
                    R{rev.roundNumber}
                  </span>
                  <div className="flex-1">
                    <span className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded-full',
                      rev.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                      rev.status === 'IN_REVIEW' ? 'bg-blue-100 text-blue-700' :
                      'bg-slate-100 text-slate-600'
                    )}>
                      {rev.status}
                    </span>
                    {rev.notes && <p className="text-xs text-slate-500 mt-1">{rev.notes}</p>}
                  </div>
                  <span className="text-xs text-slate-400">{formatDate(rev.requestedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pinned Notes */}
        {project.pinnedNotes?.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">Updates</h2>
            <div className="space-y-4">
              {project.pinnedNotes.map((note) => (
                <div key={note.id} className="p-4 rounded-lg bg-slate-50 border border-slate-100">
                  <h3 className="font-medium text-slate-800 mb-1">{note.title}</h3>
                  <p className="text-sm text-slate-600 line-clamp-3">{note.content}</p>
                  <p className="text-xs text-slate-400 mt-2">{formatDate(note.updatedAt)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-slate-400">
            Powered by Ashbi Design
          </p>
        </div>
      </main>
    </div>
  );
}
