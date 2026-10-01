import { useState, useEffect, useRef } from 'react';
import { preferredScrollBehavior } from '../../lib/motion';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Alert, Button, Card, LoadingState } from '../../components/ui';
import SlowNotice, { SLOW_WRITE_INLINE as slowWrite } from '../../components/ui/SlowNotice';
import { cn } from '../../lib/utils';
import { portalFetch, downloadPortalDocument, deletePortalDocument, fmtRelative, projectStatusLabel, projectStatusColor, priorityLabel, priorityColor, Icons, useProjectChat, PortalChatComposer, PortalMessageAttachments, canSendPortalMessage, PortalProgress, PortalDocumentList, PortalUploadZone, StatusBadge, portalFieldStyles, pageTitleClass, sectionTitleClass, labelClass } from './shared';
import { formatDate } from '../../lib/format';

// The task board's columns, in order. The server maps every task status to
// one of these keys (GET /api/client-portal/projects/:id/tasks); tasks waiting
// on the client get their own column.
const TASK_COLUMNS = Object.freeze([
  { key: 'WAITING_CLIENT', label: 'Waiting on you', dot: 'bg-warning' },
  { key: 'TODO', label: 'To Do', dot: 'bg-muted-foreground' },
  { key: 'IN_PROGRESS', label: 'In Progress', dot: 'bg-accent' },
  { key: 'REVIEW', label: 'In Review', dot: 'bg-info' },
  { key: 'BLOCKED', label: 'Blocked', dot: 'bg-destructive' },
  { key: 'DONE', label: 'Done', dot: 'bg-success' },
]);
const EMPTY_TASK_COLUMNS = Object.freeze(Object.fromEntries(TASK_COLUMNS.map(({ key }) => [key, []])));

// ── Project Detail (Kanban + Chat + Documents) ────────────────────────────────
export default function ProjectDetail({ projectId, token, onBack }) {
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState(EMPTY_TASK_COLUMNS);
  const [activeView, setActiveView] = useState('kanban'); // kanban | chat | documents
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [documentToDelete, setDocumentToDelete] = useState(null);
  const [deletingDocument, setDeletingDocument] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [revisionFeedback, setRevisionFeedback] = useState({});
  const [generalFeedback, setGeneralFeedback] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState('');
  const [workflowError, setWorkflowError] = useState('');
  const [submittingWorkflow, setSubmittingWorkflow] = useState(false);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const { messages, connected, sendMessage, sendError, sending, messagesError, loadingMessages, reloadMessages, attachments } = useProjectChat(projectId, token);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [projRes, tasksRes, docsRes] = await Promise.all([
          portalFetch(`/api/client-portal/projects/${projectId}`, token),
          portalFetch(`/api/client-portal/projects/${projectId}/tasks`, token),
          portalFetch(`/api/client-portal/projects/${projectId}/documents`, token),
        ]);
        if (!projRes.ok) throw new Error('Failed to load project');
        const projData = await projRes.json();
        const tasksData = await tasksRes.json();
        const docsData = await docsRes.json();
        setProject(projData);
        setTasks({ ...EMPTY_TASK_COLUMNS, ...(tasksData.columns || {}) });
        setDocuments(Array.isArray(docsData) ? docsData : []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    if (projectId) load();
  }, [projectId, token]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: preferredScrollBehavior() });
  }, [messages]);

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!canSendPortalMessage(chatInput, attachments)) return;
    try {
      await sendMessage(chatInput);
      setChatInput('');
    } catch {
      // The composer preserves the entered text and the shared hook announces
      // the retry-safe error below.
    }
  }

  async function handleFileUpload(files) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const failed = [];
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await portalFetch(`/api/client-portal/projects/${projectId}/upload`, token, {
          method: 'POST',
          body: formData
        });
        if (!res.ok) {
          failed.push({ name: file.name, status: res.status });
        }
      }
      // Refresh documents list regardless — partial success is still a refresh
      const res = await portalFetch(`/api/client-portal/projects/${projectId}/documents`, token);
      const data = await res.json();
      setDocuments(Array.isArray(data) ? data : []);
      if (failed.length > 0) {
        setUploadError(`${failed.length} file(s) failed to upload — ${failed.map(f => f.name).join(', ')}`);
      }
    } catch (err) {
      setUploadError(err?.message ?? 'Upload failed — please try again');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDoc() {
    if (!documentToDelete || deletingDocument) return;
    setDeletingDocument(true);
    setDeleteError('');
    try {
      await deletePortalDocument(token, documentToDelete.id);
      setDocuments(prev => prev.filter(d => d.id !== documentToDelete.id));
      setDocumentToDelete(null);
    } catch (err) {
      setDeleteError(err?.message ?? 'Delete failed — the file remains available.');
    } finally {
      setDeletingDocument(false);
    }
  }

  async function handleDownloadDoc(doc) {
    try {
      await downloadPortalDocument(token, doc);
    } catch (err) {
      setUploadError(err?.message ?? 'Download failed — please try again');
    }
  }

  async function handleRevisionResponse(revision, action) {
    const feedback = revisionFeedback[revision.id]?.trim() || '';
    if (action === 'REQUEST_CHANGES' && !feedback) {
      setWorkflowError('Describe the changes you need before submitting.');
      return;
    }
    setSubmittingWorkflow(true);
    setWorkflowError('');
    setWorkflowStatus('');
    try {
      const response = await portalFetch(`/api/client-portal/projects/${projectId}/revisions/${revision.id}/respond`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, feedback: feedback || undefined }),
      });
      if (!response.ok) throw new Error(`Response failed (${response.status})`);
      const updated = await response.json();
      setProject(current => ({
        ...current,
        revisionRounds: current.revisionRounds.map(item => item.id === updated.id ? { ...item, ...updated } : item),
      }));
      setWorkflowStatus(action === 'APPROVE' ? `Revision round ${revision.roundNumber} approved.` : `Change request sent for revision round ${revision.roundNumber}.`);
      setRevisionFeedback(current => ({ ...current, [revision.id]: '' }));
    } catch (err) {
      setWorkflowError(err?.message || 'The revision response could not be saved.');
    } finally {
      setSubmittingWorkflow(false);
    }
  }

  async function handleGeneralFeedback(event) {
    event.preventDefault();
    if (!generalFeedback.trim()) return;
    setSubmittingWorkflow(true);
    setWorkflowError('');
    setWorkflowStatus('');
    try {
      const response = await portalFetch(`/api/client-portal/projects/${projectId}/feedback`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: generalFeedback.trim() }),
      });
      if (!response.ok) throw new Error(`Feedback failed (${response.status})`);
      setGeneralFeedback('');
      setWorkflowStatus('Your feedback was sent to the project team.');
    } catch (err) {
      setWorkflowError(err?.message || 'Your feedback could not be saved.');
    } finally {
      setSubmittingWorkflow(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading project..." />;
  }
  if (error || !project) {
    return (
      <div className="mx-auto my-8 max-w-[400px] text-center">
        <p className="text-destructive">{error || 'Project not found'}</p>
        <Button type="button" aria-label="Back to projects" variant="link" onClick={onBack}>Go back</Button>
      </div>
    );
  }

  const kanbanColumns = TASK_COLUMNS.map((column) => ({ ...column, tasks: tasks[column.key] || [] }));

  const detailTabs = [
    { id: 'kanban', label: 'Tasks', icon: Icons.projects },
    { id: 'chat', label: `Chat${connected ? ' \u2022' : ''}`, icon: Icons.chat },
    { id: 'documents', label: 'Documents', icon: Icons.documents },
  ];

  return (
    <div className="space-y-4">
      {/* Back button + header */}
      <div>
        <Button type="button" aria-label="Back to projects" variant="link" leftIcon={Icons.back} onClick={onBack} className="mb-3 gap-1">
          Back to Projects
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={cn(pageTitleClass, 'mb-0')}>{project.name}</h2>
          <StatusBadge color={projectStatusColor(project.status)}>{projectStatusLabel(project.status)}</StatusBadge>
        </div>
      </div>

      {/* Progress */}
      <Card padding="none" className="px-5 py-4">
        <div className="mb-1.5 flex justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-semibold text-foreground">{project.progressPct}%</span>
        </div>
        <PortalProgress value={project.progressPct} tone={project.progressPct >= 80 ? 'bg-success' : 'bg-primary'} className="h-2.5" />
      </Card>

      {project.milestones?.length > 0 && (
        <Card as="section" padding="none" className="px-5 py-4" aria-labelledby="portal-milestones-title">
          <h3 id="portal-milestones-title" className={sectionTitleClass}>Milestones</h3>
          <div className="space-y-2">
            {project.milestones.map(milestone => (
              <div key={milestone.id} className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-foreground">{milestone.name}</p>
                  {milestone.description && <p className="text-sm text-muted-foreground">{milestone.description}</p>}
                </div>
                <div className="text-right">
                  <StatusBadge color={milestone.status === 'COMPLETED' ? 'success' : 'info'}>{milestone.status.replaceAll('_', ' ')}</StatusBadge>
                  <p className="mt-1 text-xs text-muted-foreground">Due {formatDate(milestone.dueDate, { dateOnly: true })}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {project.revisionRounds?.length > 0 && (
        <Card as="section" padding="none" className="px-5 py-4" aria-labelledby="portal-revisions-title">
          <h3 id="portal-revisions-title" className={sectionTitleClass}>Revision approvals</h3>
          <div className="space-y-3">
            {project.revisionRounds.map(revision => (
              <div key={revision.id} className="border-t border-border pt-3">
                <div className="flex flex-wrap justify-between gap-4">
                  <p className="font-semibold text-foreground">Round {revision.roundNumber}</p>
                  <StatusBadge color={revision.status === 'APPROVED' ? 'success' : 'warning'}>{revision.status.replaceAll('_', ' ')}</StatusBadge>
                </div>
                {revision.notes && <p className="mt-2 text-sm text-muted-foreground">{revision.notes}</p>}
                {revision.status !== 'APPROVED' && (
                  <div className="mt-3">
                    <label htmlFor={`revision-feedback-${revision.id}`} className={labelClass}>Feedback for round {revision.roundNumber}</label>
                    <textarea id={`revision-feedback-${revision.id}`} className={portalFieldStyles()} rows={3} value={revisionFeedback[revision.id] || ''} onChange={event => setRevisionFeedback(current => ({ ...current, [revision.id]: event.target.value }))} placeholder="Describe requested changes, or approve when everything looks right." />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button type="button" disabled={submittingWorkflow} aria-busy={submittingWorkflow || undefined} onClick={() => handleRevisionResponse(revision, 'APPROVE')}>Approve round</Button>
                      <Button type="button" variant="outline" disabled={submittingWorkflow} aria-busy={submittingWorkflow || undefined} onClick={() => handleRevisionResponse(revision, 'REQUEST_CHANGES')}>Request changes</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card as="section" padding="none" className="px-5 py-4" aria-labelledby="portal-feedback-title">
        <h3 id="portal-feedback-title" className={sectionTitleClass}>Project feedback</h3>
        <form onSubmit={handleGeneralFeedback}>
          <label htmlFor="portal-project-feedback" className={labelClass}>Message to the project team</label>
          <textarea id="portal-project-feedback" className={portalFieldStyles()} rows={3} value={generalFeedback} onChange={event => setGeneralFeedback(event.target.value)} required />
          <Button type="submit" className="mt-2" disabled={submittingWorkflow || !generalFeedback.trim()} aria-busy={submittingWorkflow || undefined}>Send feedback</Button>
        </form>
      </Card>

      {workflowStatus && <Alert variant="success">{workflowStatus}</Alert>}
      {workflowError && <Alert variant="error">{workflowError}</Alert>}

      {/* Detail tabs */}
      <div role="tablist" aria-label="Project detail sections" className="flex gap-1 border-b-2 border-border">
        {detailTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeView === tab.id}
            className="cp-tab"
            onClick={() => setActiveView(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Kanban view */}
      {activeView === 'kanban' && (
        <div className="cp-kanban">
          {kanbanColumns.map(col => (
            <div key={col.key} className="cp-kanban-col">
              <div className="cp-kanban-col-header">
                <span className={cn('inline-block h-2 w-2 rounded-full', col.dot)} />
                <span className="text-sm font-semibold">{col.label}</span>
                <span className="text-xs text-muted-foreground">{col.tasks.length}</span>
              </div>
              <div className="cp-kanban-col-body">
                {col.tasks.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">No tasks</p>
                ) : (
                  col.tasks.map(task => (
                    <Card key={task.id} padding="sm" className="rounded-xl">
                      <h4 className="font-heading text-sm font-medium text-foreground">{task.title}</h4>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
                        <StatusBadge color={priorityColor(task.priority)}>{priorityLabel(task.priority)}</StatusBadge>
                        {task.assignee && <span className="text-xs text-muted-foreground">{task.assignee.name}</span>}
                        {task.dueDate && (
                          <span className="text-xs text-muted-foreground">
                            {fmtRelative(task.dueDate)}
                          </span>
                        )}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Chat view */}
      {activeView === 'chat' && (
        <div className="cp-chat-container">
          <div className="cp-chat-messages">
            {messagesError && <Alert variant="error" className="mb-2" action={<Button type="button" variant="link" onClick={reloadMessages}>Try again</Button>}>Chat messages could not be loaded. Try again.</Alert>}
            {loadingMessages && messages.length === 0 ? (
              <p role="status" className="text-muted-foreground">Loading messages…</p>
            ) : messages.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-muted-foreground">No messages yet. Start the conversation!</p>
              </div>
            ) : (
              messages.map(msg => (
                <Card key={msg.id} padding="none" className="mb-2 rounded-xl px-4 py-3">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {msg.author?.name || 'Team'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm leading-normal text-foreground">{msg.content}</p>
                  <PortalMessageAttachments attachments={msg.attachments} />
                </Card>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          <PortalChatComposer value={chatInput} onChange={e => setChatInput(e.target.value)} onSubmit={handleSendMessage} connected={connected} sending={sending} sendError={sendError} attachments={attachments} />
        </div>
      )}

      {/* Documents view */}
      {activeView === 'documents' && (
        <div className="space-y-4">
          <PortalUploadZone
            inputRef={fileInputRef}
            inputLabel="Choose project documents to upload"
            helpId="project-upload-help"
            uploading={uploading}
            disabled={uploading}
            onFiles={handleFileUpload}
          />
          <SlowNotice active={uploading} {...slowWrite} />

          {/* Upload error — surfaced so the user sees what failed instead of a ghost-success */}
          {uploadError && (
            <Alert variant="error" onDismiss={() => setUploadError(null)} dismissLabel="Dismiss upload error">
              {uploadError}
            </Alert>
          )}

          <PortalDocumentList
            documents={documents}
            onDownload={handleDownloadDoc}
            onDelete={doc => { setDeleteError(''); setDocumentToDelete(doc); }}
            deleting={deletingDocument}
          />
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(documentToDelete)}
        title="Delete document?"
        description={documentToDelete ? `Permanently delete “${documentToDelete.originalName}”? This removes the file from the client portal and cannot be undone.` : ''}
        confirmLabel="Permanently delete"
        onConfirm={handleDeleteDoc}
        onCancel={() => { setDeleteError(''); setDocumentToDelete(null); }}
        pending={deletingDocument}
        error={deleteError}
      />
    </div>
  );
}
