import { useState, useEffect, useRef } from 'react';
import { preferredScrollBehavior } from '../../lib/motion';
import ConfirmDialog from '../../components/ConfirmDialog';
import SlowNotice, { SlowLoadingStatus, SLOW_WRITE_INLINE as slowWrite } from '../../components/ui/SlowNotice';
import { portalFetch, downloadPortalDocument, deletePortalDocument, BRAND, fmtDate, fmtRelative, projectStatusLabel, projectStatusColor, priorityLabel, priorityColor, Icons, useProjectChat, PortalChatComposer } from './shared';

// ── Project Detail (Kanban + Chat + Documents) ────────────────────────────────
export default function ProjectDetail({ projectId, token, onBack }) {
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState({ TODO: [], IN_PROGRESS: [], DONE: [], BLOCKED: [] });
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
  const { messages, connected, sendMessage, sendError, sending, messagesError, loadingMessages, reloadMessages } = useProjectChat(projectId, token);

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
        setTasks(tasksData.columns || { TODO: [], IN_PROGRESS: [], DONE: [], BLOCKED: [] });
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
    if (!chatInput.trim()) return;
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
    return <SlowLoadingStatus label="Loading project..." className="cp-loading" />;
  }
  if (error || !project) {
    return (
      <div className="cp-error-box">
        <p className="cp-error">{error || 'Project not found'}</p>
        <button type="button" aria-label="Back to projects" onClick={onBack} className="cp-link">Go back</button>
      </div>
    );
  }

  const kanbanColumns = [
    { key: 'TODO', label: 'To Do', tasks: tasks.TODO, color: '#b45309' },
    { key: 'IN_PROGRESS', label: 'In Progress', tasks: tasks.IN_PROGRESS, color: '#4d7c0f' },
    { key: 'DONE', label: 'Done', tasks: tasks.DONE, color: '#15803d' },
    { key: 'BLOCKED', label: 'Blocked', tasks: tasks.BLOCKED || [], color: '#b91c1c' },
  ];

  const detailTabs = [
    { id: 'kanban', label: 'Tasks', icon: Icons.projects },
    { id: 'chat', label: `Chat${connected ? ' \u2022' : ''}`, icon: Icons.chat },
    { id: 'documents', label: 'Documents', icon: Icons.documents },
  ];

  return (
    <div className="cp-space-y-4">
      {/* Back button + header */}
      <div>
        <button type="button" aria-label="Back to projects" onClick={onBack} className="cp-link" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {Icons.back} Back to Projects
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 className="cp-page-title" style={{ marginBottom: 0 }}>{project.name}</h2>
          <span className={`cp-badge ${projectStatusColor(project.status)}`}>{projectStatusLabel(project.status)}</span>
        </div>
        {project.aiSummary && <p className="cp-text-muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>{project.aiSummary}</p>}
      </div>

      {/* Progress */}
      <div className="cp-card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.375rem' }}>
          <span className="cp-text-muted">Progress</span>
          <span className="cp-text" style={{ fontWeight: 600 }}>{project.progressPct}%</span>
        </div>
        <div style={{ width: '100%', height: 10, background: BRAND.border, borderRadius: 5, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 5, transition: 'width 0.3s',
            width: `${project.progressPct}%`,
            background: project.progressPct >= 80 ? '#15803d' : BRAND.primary
          }} />
        </div>
      </div>

      {project.milestones?.length > 0 && (
        <section className="cp-card" style={{ padding: '1rem 1.25rem' }} aria-labelledby="portal-milestones-title">
          <h3 id="portal-milestones-title" className="cp-section-title">Milestones</h3>
          <div className="cp-space-y-2">
            {project.milestones.map(milestone => (
              <div key={milestone.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <p className="cp-text" style={{ fontWeight: 600 }}>{milestone.name}</p>
                  {milestone.description && <p className="cp-text-muted" style={{ fontSize: '0.8rem' }}>{milestone.description}</p>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`cp-badge ${milestone.status === 'COMPLETED' ? 'cp-badge--green' : 'cp-badge--blue'}`}>{milestone.status.replaceAll('_', ' ')}</span>
                  <p className="cp-text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Due {fmtDate(milestone.dueDate)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {project.revisionRounds?.length > 0 && (
        <section className="cp-card" style={{ padding: '1rem 1.25rem' }} aria-labelledby="portal-revisions-title">
          <h3 id="portal-revisions-title" className="cp-section-title">Revision approvals</h3>
          <div className="cp-space-y-3">
            {project.revisionRounds.map(revision => (
              <div key={revision.id} style={{ borderTop: `1px solid ${BRAND.border}`, paddingTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <p className="cp-text" style={{ fontWeight: 600 }}>Round {revision.roundNumber}</p>
                  <span className={`cp-badge ${revision.status === 'APPROVED' ? 'cp-badge--green' : 'cp-badge--orange'}`}>{revision.status.replaceAll('_', ' ')}</span>
                </div>
                {revision.notes && <p className="cp-text-muted" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>{revision.notes}</p>}
                {revision.status !== 'APPROVED' && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label htmlFor={`revision-feedback-${revision.id}`} className="cp-label">Feedback for round {revision.roundNumber}</label>
                    <textarea id={`revision-feedback-${revision.id}`} className="cp-input" rows={3} value={revisionFeedback[revision.id] || ''} onChange={event => setRevisionFeedback(current => ({ ...current, [revision.id]: event.target.value }))} placeholder="Describe requested changes, or approve when everything looks right." />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      <button type="button" className="cp-btn-primary" disabled={submittingWorkflow} aria-busy={submittingWorkflow || undefined} onClick={() => handleRevisionResponse(revision, 'APPROVE')}>Approve round</button>
                      <button type="button" className="cp-btn-secondary" disabled={submittingWorkflow} aria-busy={submittingWorkflow || undefined} onClick={() => handleRevisionResponse(revision, 'REQUEST_CHANGES')}>Request changes</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="cp-card" style={{ padding: '1rem 1.25rem' }} aria-labelledby="portal-feedback-title">
        <h3 id="portal-feedback-title" className="cp-section-title">Project feedback</h3>
        <form onSubmit={handleGeneralFeedback}>
          <label htmlFor="portal-project-feedback" className="cp-label">Message to the project team</label>
          <textarea id="portal-project-feedback" className="cp-input" rows={3} value={generalFeedback} onChange={event => setGeneralFeedback(event.target.value)} required />
          <button type="submit" className="cp-btn-primary" style={{ marginTop: '0.5rem' }} disabled={submittingWorkflow || !generalFeedback.trim()} aria-busy={submittingWorkflow || undefined}>Send feedback</button>
        </form>
      </section>

      {workflowStatus && <p role="status" aria-live="polite" className="cp-alert" style={{ background: '#f0fdf4', color: '#166534' }}>{workflowStatus}</p>}
      {workflowError && <p role="alert" className="cp-alert cp-alert--red cp-error">{workflowError}</p>}

      {/* Detail tabs */}
      <div role="tablist" aria-label="Project detail sections" style={{ display: 'flex', gap: '0.25rem', borderBottom: `2px solid ${BRAND.border}` }}>
        {detailTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeView === tab.id}
            className="cp-tab"
            onClick={() => setActiveView(tab.id)}
            style={{
              padding: '0.625rem 1rem',
              fontSize: '0.85rem',
              fontWeight: activeView === tab.id ? 600 : 400,
              color: activeView === tab.id ? BRAND.primary : BRAND.textMuted,
              borderBottom: activeView === tab.id ? `2px solid ${BRAND.accent}` : '2px solid transparent',
              borderTop: 0,
              borderRight: 0,
              borderLeft: 0,
              marginBottom: '-2px',
              background: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              transition: 'all 0.2s',
            }}
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
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, display: 'inline-block' }} />
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{col.label}</span>
                <span className="cp-text-muted" style={{ fontSize: '0.75rem' }}>{col.tasks.length}</span>
              </div>
              <div className="cp-kanban-col-body">
                {col.tasks.length === 0 ? (
                  <p className="cp-text-muted" style={{ fontSize: '0.8rem', textAlign: 'center', padding: '1rem 0' }}>No tasks</p>
                ) : (
                  col.tasks.map(task => (
                    <div key={task.id} className="cp-kanban-card">
                      <h4 className="cp-text" style={{ fontSize: '0.85rem', fontWeight: 500 }}>{task.title}</h4>
                      {task.description && <p className="cp-text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{task.description}</p>}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.25rem' }}>
                        <span className={`cp-badge ${priorityColor(task.priority)}`}>{priorityLabel(task.priority)}</span>
                        {task.assignee && <span className="cp-text-muted" style={{ fontSize: '0.7rem' }}>{task.assignee.name}</span>}
                        {task.dueDate && (
                          <span className="cp-text-muted" style={{ fontSize: '0.7rem' }}>
                            {fmtRelative(task.dueDate)}
                          </span>
                        )}
                      </div>
                    </div>
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
            {messagesError && <div role="alert" className="cp-alert cp-alert--red"><p>Chat messages could not be loaded. Try again.</p><button type="button" className="cp-link" onClick={reloadMessages}>Try again</button></div>}
            {loadingMessages && messages.length === 0 ? (
              <p role="status" className="cp-text-muted">Loading messages…</p>
            ) : messages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <p className="cp-text-muted">No messages yet. Start the conversation!</p>
              </div>
            ) : (
              messages.map(msg => (
                <div key={msg.id} className="cp-chat-bubble">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: BRAND.text }}>
                      {msg.author?.name || 'Team'}
                    </span>
                    <span className="cp-text-muted" style={{ fontSize: '0.7rem' }}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="cp-text" style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{msg.content}</p>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          <PortalChatComposer value={chatInput} onChange={e => setChatInput(e.target.value)} onSubmit={handleSendMessage} connected={connected} sending={sending} sendError={sendError} />
        </div>
      )}

      {/* Documents view */}
      {activeView === 'documents' && (
        <div className="cp-space-y-4">
          {/* Upload area */}
          <input
            type="file"
            ref={fileInputRef}
            multiple
            className="cp-visually-hidden"
            aria-label="Choose project documents to upload"
            onChange={e => { if (e.target.files.length > 0) handleFileUpload(e.target.files); }}
          />
          <button
            type="button"
            className="cp-upload-zone"
            aria-describedby="project-upload-help"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = BRAND.primary; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = BRAND.border; }}
            onDrop={e => {
              e.preventDefault();
              e.currentTarget.style.borderColor = BRAND.border;
              if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
            }}
          >
            {Icons.upload}
            <p className="cp-text" style={{ fontWeight: 600, marginTop: '0.5rem' }}>
              {uploading ? 'Uploading...' : 'Drop files here or click to upload'}
            </p>
            <p id="project-upload-help" className="cp-text-muted" style={{ fontSize: '0.8rem' }}>PDF, images, documents — up to 50MB</p>
          </button>
          <SlowNotice active={uploading} {...slowWrite} />

          {/* Upload error — surfaced so the user sees what failed instead of a ghost-success */}
          {uploadError && (
            <div
              role="alert"
              className="cp-card"
              style={{
                padding: '0.75rem 1rem',
                borderLeft: `4px solid ${BRAND.danger}`,
                background: '#fef2f2',
                color: BRAND.danger,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
              }}
            >
              <span style={{ fontSize: '0.875rem' }}>{uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: BRAND.danger,
                  cursor: 'pointer',
                  fontSize: '1.25rem',
                  lineHeight: 1,
                  padding: '0 0.25rem',
                }}
                aria-label="Dismiss upload error"
              >
                ×
              </button>
            </div>
          )}

          {/* Document list */}
          {documents.length === 0 ? (
            <div className="cp-card" style={{ padding: '2rem', textAlign: 'center' }}>
              <p className="cp-text-muted">No documents yet. Upload one above.</p>
            </div>
          ) : (
            <div className="cp-space-y-2">
              {documents.map(doc => (
                <div key={doc.id} className="cp-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1.25rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="cp-text" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.originalName}</p>
                    <p className="cp-text-muted" style={{ fontSize: '0.75rem' }}>
                      {(doc.size / 1024).toFixed(1)} KB &middot; {fmtDate(doc.createdAt)} &middot; {doc.uploadedBy?.name || 'Unknown'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '0.75rem' }}>
                    <button type="button" onClick={() => handleDownloadDoc(doc)} className="cp-btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}>
                      {Icons.download} Download
                    </button>
                    <button type="button" onClick={() => { setDeleteError(''); setDocumentToDelete(doc); }} disabled={deletingDocument} className="cp-btn-danger" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem', minWidth: 44, minHeight: 44 }} aria-label={`Delete ${doc.originalName}`}>
                      {Icons.trash}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
