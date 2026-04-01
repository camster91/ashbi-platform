import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  RefreshCw,
  MessageSquare,
  CheckCircle,
  Clock,
  AlertTriangle,
  Sparkles,
  FileText,
  ClipboardPaste,
  ChevronDown,
  ChevronRight,
  Send,
  Plus,
  Check,
  X,
  Share2,
  LayoutTemplate,
  Copy,
  Mail,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  formatRelativeTime,
  getHealthColor,
  getProjectStatusColor,
  getProjectStatusLabel,
  getPriorityColor,
  cn,
} from '../lib/utils';
import { useAuth } from '../hooks/useAuth';
import ProjectCommunications from '../components/project/ProjectCommunications';
import ProjectContextCard from '../components/project/ProjectContext';

export default function Project() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [draftNotes, setDraftNotes] = useState('');
  const [includeRevisions, setIncludeRevisions] = useState(false);
  const [draftResult, setDraftResult] = useState(null);
  const [pasteContent, setPasteContent] = useState('');
  const [pasteSource, setPasteSource] = useState('email');
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.getProject(id),
  });

  const { data: revisions } = useQuery({
    queryKey: ['revisions', id],
    queryFn: () => api.getRevisions(id),
  });

  const refreshMutation = useMutation({
    mutationFn: () => api.refreshProjectPlan(id),
    onSuccess: () => queryClient.invalidateQueries(['project', id]),
  });

  const draftUpdateMutation = useMutation({
    mutationFn: (data) => api.draftProjectUpdate(id, data),
    onSuccess: (data) => setDraftResult(data),
  });

  const pasteMutation = useMutation({
    mutationFn: (data) => api.pasteMessage(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['project', id]);
      setShowPasteModal(false);
      setPasteContent('');
    },
  });

  const createRevisionMutation = useMutation({
    mutationFn: (data) => api.createRevision(id, data),
    onSuccess: () => queryClient.invalidateQueries(['revisions', id]),
  });

  const approveRevisionMutation = useMutation({
    mutationFn: (revId) => api.approveRevision(revId),
    onSuccess: () => queryClient.invalidateQueries(['revisions', id]),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['task-templates'],
    queryFn: () => api.getTaskTemplates(),
    enabled: showTemplateModal,
  });

  const applyTemplateMutation = useMutation({
    mutationFn: (templateId) => api.applyTemplate(templateId, id),
    onSuccess: () => {
      queryClient.invalidateQueries(['project', id]);
      setShowTemplateModal(false);
    },
  });

  function copyPortalLink() {
    if (!project?.viewToken) return;
    const url = `${window.location.origin}/portal/${project.viewToken}`;
    navigator.clipboard.writeText(url);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!project) {
    return <div className="text-center py-8">Project not found</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/projects" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full', getProjectStatusColor(project.status))}>
              {getProjectStatusLabel(project.status)}
            </span>
          </div>
          <p className="text-muted-foreground">{project.client?.name}</p>
          {/* Progress bar */}
          {project.tasks?.length > 0 && (() => {
            const total = project.tasks.length;
            const completed = project.tasks.filter(t => t.status === 'COMPLETED').length;
            const pct = Math.round((completed / total) * 100);
            return (
              <div className="flex items-center gap-3 mt-2 max-w-xs">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">{completed}/{total} tasks ({pct}%)</span>
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('px-3 py-1.5 text-sm font-medium rounded-lg', getHealthColor(project.health))}>
            {project.health?.replace(/_/g, ' ')} ({project.healthScore})
          </span>
          <button
            onClick={copyPortalLink}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-secondary flex items-center gap-2 transition-colors"
          >
            {shareCopied ? <Check className="w-4 h-4 text-green-500" /> : <Share2 className="w-4 h-4" />}
            {shareCopied ? 'Copied!' : 'Share with Client'}
          </button>
          <button
            onClick={() => setShowTemplateModal(true)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-secondary flex items-center gap-2 transition-colors"
          >
            <LayoutTemplate className="w-4 h-4" />
            Apply Template
          </button>
          <button
            onClick={() => setShowDraftModal(true)}
            className="px-3 py-1.5 text-sm bg-accent text-accent-foreground rounded-lg hover:opacity-90 flex items-center gap-2 transition-all hover-lift"
          >
            <FileText className="w-4 h-4" />
            Draft Update
          </button>
          <button
            onClick={() => setShowPasteModal(true)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-secondary flex items-center gap-2 transition-colors"
          >
            <ClipboardPaste className="w-4 h-4" />
            Paste Message
          </button>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 flex items-center gap-2 transition-all"
          >
            <RefreshCw className={cn('w-4 h-4', refreshMutation.isPending && 'animate-spin')} />
            Refresh Plan
          </button>
        </div>
      </div>

      {/* AI Summary */}
      {project.aiSummary && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-accent" />
            AI Summary
          </h3>
          <p className="text-gray-700">{project.aiSummary}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task Plan */}
        <div className="lg:col-span-2 space-y-4">
          <TaskCategory title="Immediate" icon={AlertTriangle} tasks={project.tasks?.filter((t) => t.category === 'IMMEDIATE')} color="red" />
          <TaskCategory title="This Week" icon={Clock} tasks={project.tasks?.filter((t) => t.category === 'THIS_WEEK')} color="orange" />
          <TaskCategory title="Upcoming" icon={Clock} tasks={project.tasks?.filter((t) => t.category === 'UPCOMING')} color="blue" />
          <TaskCategory title="Waiting on Client" icon={Clock} tasks={project.tasks?.filter((t) => t.category === 'WAITING_CLIENT')} color="gray" />
          <TaskCategory title="Completed" icon={CheckCircle} tasks={project.tasks?.filter((t) => t.status === 'COMPLETED')} color="green" collapsed />

          {/* Revision Rounds */}
          <RevisionRounds
            revisions={revisions || []}
            isAdmin={user?.role === 'ADMIN'}
            onCreateRound={() => createRevisionMutation.mutate({})}
            onApprove={(revId) => approveRevisionMutation.mutate(revId)}
            isCreating={createRevisionMutation.isPending}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Active Threads */}
          <div className="bg-white rounded-lg shadow-sm border border-border">
            <div className="px-4 py-3 border-b flex justify-between items-center">
              <h3 className="font-semibold">Active Threads</h3>
              <span className="text-sm text-muted-foreground">
                {project.threads?.filter((t) => t.status !== 'RESOLVED').length || 0}
              </span>
            </div>
            <ul className="divide-y">
              {project.threads
                ?.filter((t) => t.status !== 'RESOLVED')
                .slice(0, 5)
                .map((thread) => (
                  <li key={thread.id}>
                    <Link to={`/thread/${thread.id}`} className="block px-4 py-3 hover:bg-secondary/50 transition-colors">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium truncate">{thread.subject}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                        <span className={cn('px-1.5 py-0.5 rounded', getPriorityColor(thread.priority))}>{thread.priority}</span>
                        <span>{formatRelativeTime(thread.lastActivityAt)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
            </ul>
            {(!project.threads || project.threads.length === 0) && (
              <div className="p-4 text-center text-muted-foreground text-sm">No active threads</div>
            )}
          </div>

          {/* Risks */}
          {project.risks?.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-border">
              <div className="px-4 py-3 border-b">
                <h3 className="font-semibold text-red-600">Risks</h3>
              </div>
              <ul className="divide-y">
                {project.risks.map((risk, i) => (
                  <li key={i} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                      <span className="text-sm font-medium">{risk.risk}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{risk.mitigation}</p>
                    <div className="flex gap-2 mt-2">
                      <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">Likelihood: {risk.likelihood}</span>
                      <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">Impact: {risk.impact}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Communications & Context */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow-sm border border-border">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Mail className="w-4 h-4 text-accent" />
              <h3 className="font-semibold">Email Communications</h3>
            </div>
            <div className="p-4">
              <ProjectCommunications projectId={id} />
            </div>
          </div>
        </div>
        <div>
          <ProjectContextCard projectId={id} />
        </div>
      </div>

      {/* Draft Update Modal */}
      {showDraftModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">Draft Client Update</h2>
              <button onClick={() => { setShowDraftModal(false); setDraftResult(null); }} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {!draftResult ? (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Raw notes / talking points</label>
                    <textarea
                      value={draftNotes}
                      onChange={(e) => setDraftNotes(e.target.value)}
                      rows={6}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      placeholder="Enter your raw notes about project progress, updates, etc..."
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includeRevisions}
                      onChange={(e) => setIncludeRevisions(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    Include revision round status
                  </label>
                  <button
                    onClick={() => draftUpdateMutation.mutate({ rawNotes: draftNotes, includeRevisionStatus: includeRevisions })}
                    disabled={draftUpdateMutation.isPending || !draftNotes.trim()}
                    className="w-full px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:opacity-90 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {draftUpdateMutation.isPending ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Generating...</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> Generate Draft</>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Subject</label>
                    <div className="border border-border rounded-lg px-3 py-2 text-sm bg-gray-50">{draftResult.subject}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Body</label>
                    <div className="border border-border rounded-lg px-3 py-2 text-sm bg-gray-50 whitespace-pre-wrap">{draftResult.body}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">Tone: {draftResult.tone}</div>
                  <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                    Cameron must review and approve before sending to the client.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { navigator.clipboard.writeText(`Subject: ${draftResult.subject}\n\n${draftResult.body}`); }}
                      className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 flex items-center justify-center gap-2"
                    >
                      <Send className="w-4 h-4" /> Copy to Clipboard
                    </button>
                    <button
                      onClick={() => setDraftResult(null)}
                      className="px-4 py-2 border border-border rounded-lg hover:bg-secondary"
                    >
                      Regenerate
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Apply Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full animate-scale-in">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">Apply Task Template</h2>
              <button onClick={() => setShowTemplateModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No templates available</p>
              ) : (
                templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => applyTemplateMutation.mutate(tmpl.id)}
                    disabled={applyTemplateMutation.isPending}
                    className="w-full text-left p-4 border border-border rounded-lg hover:bg-secondary/50 transition-colors"
                  >
                    <div className="font-medium text-sm">{tmpl.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {tmpl.tasks?.length || 0} tasks &middot; Phase: {tmpl.phase.replace(/_/g, ' ')}
                    </div>
                  </button>
                ))
              )}
              {applyTemplateMutation.isPending && (
                <div className="flex items-center justify-center py-2 text-sm text-muted-foreground">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Applying...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Paste Message Modal */}
      {showPasteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">Paste Message</h2>
              <button onClick={() => setShowPasteModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Source</label>
                <select
                  value={pasteSource}
                  onChange={(e) => setPasteSource(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="email">Email</option>
                  <option value="slack">Slack</option>
                  <option value="upwork">Upwork</option>
                  <option value="notion">Notion</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Content</label>
                <textarea
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  rows={10}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Paste message content here..."
                />
              </div>
              <button
                onClick={() => pasteMutation.mutate({ content: pasteContent, source: pasteSource, projectId: id })}
                disabled={pasteMutation.isPending || !pasteContent.trim()}
                className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {pasteMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Processing...</>
                ) : (
                  <><ClipboardPaste className="w-4 h-4" /> Process &amp; Extract</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RevisionRounds({ revisions, isAdmin, onCreateRound, onApprove, isCreating }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-border">
      <div
        className="px-4 py-3 border-b flex items-center gap-2 cursor-pointer hover:bg-secondary/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <FileText className="w-4 h-4 text-accent" />
        <h3 className="font-semibold flex-1">Revision Rounds</h3>
        <span className="text-sm text-muted-foreground">({revisions.length})</span>
        <button
          onClick={(e) => { e.stopPropagation(); onCreateRound(); }}
          disabled={isCreating}
          className="p-1 hover:bg-gray-100 rounded"
          title="New revision round"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      {expanded && (
        <ul className="divide-y">
          {revisions.length === 0 ? (
            <li className="p-4 text-center text-muted-foreground text-sm">No revision rounds yet</li>
          ) : (
            revisions.map((rev) => (
              <li key={rev.id} className="px-4 py-3 flex items-center gap-3">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold',
                  rev.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                  rev.status === 'IN_REVIEW' ? 'bg-amber-100 text-amber-700' :
                  'bg-blue-100 text-blue-700'
                )}>
                  {rev.roundNumber}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Round {rev.roundNumber}</span>
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded',
                      rev.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                      rev.status === 'IN_REVIEW' ? 'bg-amber-100 text-amber-700' :
                      'bg-blue-100 text-blue-700'
                    )}>
                      {rev.status}
                    </span>
                  </div>
                  {rev.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{rev.notes}</p>}
                  <p className="text-xs text-muted-foreground">{formatRelativeTime(rev.requestedAt || rev.createdAt)}</p>
                </div>
                {isAdmin && rev.status !== 'APPROVED' && (
                  <button
                    onClick={() => onApprove(rev.id)}
                    className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 flex items-center gap-1"
                  >
                    <Check className="w-3 h-3" /> Approve
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function TaskCategory({ title, icon: Icon, tasks = [], color, collapsed = false }) {
  const [isCollapsed, setIsCollapsed] = useState(collapsed);
  const colors = {
    red: 'text-red-600 bg-red-50',
    orange: 'text-orange-600 bg-orange-50',
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    gray: 'text-gray-600 bg-gray-50',
  };

  if (tasks.length === 0 && collapsed) return null;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-border">
      <div
        className="px-4 py-3 border-b flex items-center gap-2 cursor-pointer hover:bg-secondary/30 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        <Icon className={cn('w-4 h-4', colors[color]?.split(' ')[0])} />
        <h3 className="font-semibold">{title}</h3>
        <span className="text-sm text-muted-foreground">({tasks.length})</span>
      </div>
      {!isCollapsed && (
        tasks.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">No tasks in this category</div>
        ) : (
          <ul className="divide-y">
            {tasks.map((task) => (
              <li key={task.id}>
                <Link
                  to={`/task/${task.id}`}
                  className="px-4 py-3 hover:bg-secondary/50 flex items-center gap-3 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={task.status === 'COMPLETED'}
                    onChange={() => {}}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-gray-300"
                  />
                  <div className="flex-1 min-w-0">
                    <span className={cn('text-sm', task.status === 'COMPLETED' && 'line-through text-muted-foreground')}>
                      {task.title}
                    </span>
                    {task.assignee && (
                      <span className="text-xs text-muted-foreground ml-2">@{task.assignee.name}</span>
                    )}
                  </div>
                  <span className={cn('text-xs px-1.5 py-0.5 rounded', getPriorityColor(task.priority))}>
                    {task.priority}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
