import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import Modal from './Modal';
import Button from './ui/Button';

const activeProjectStatuses = ['STARTING_UP', 'DESIGN_DEV', 'ADDING_CONTENT', 'FINALIZING', 'ACTIVE'];
const fieldClass = 'w-full rounded-lg border border-input bg-background p-3 text-sm';
const needsReauth = (error) => error?.data?.code === 'REAUTH_REQUIRED' || error?.code === 'REAUTH_REQUIRED';
const denied = (error) => !needsReauth(error) && [401, 403].includes(error?.status ?? error?.statusCode);
const definitive = (action) => (action?.status === 'PENDING_CONFIRMATION' && action.expired === true) || ['EXECUTED', 'REJECTED', 'EXPIRED'].includes(action?.status) || (action?.status === 'FAILED' && action.outcome === 'failed');
const storageName = (user, clientId, messageId) => `ashbi:email-task:${[user.organizationId, user.id, clientId, 'inbox', messageId].map(encodeURIComponent).join(':')}`;
function savedIntent(name) {
  const value = sessionStorage.getItem(name);
  if (!value) return null;
  const intent = JSON.parse(value);
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(intent.key || '') || !/^[a-f0-9]{64}$/.test(intent.fingerprint || '')) throw new Error('Unavailable saved attempt');
  return { key: intent.key, fingerprint: intent.fingerprint };
}
async function fingerprint(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function clientProjects(clientId) {
  const rows = [];
  for (let offset = 0; ; offset += 200) {
    const page = await api.getProjects({ clientId, limit: 200, offset });
    if (!Array.isArray(page?.projects)) throw new Error('Projects unavailable');
    rows.push(...page.projects.filter((project) => project.clientId === clientId && activeProjectStatuses.includes(project.status) && !project.deletedAt));
    if (offset + page.projects.length >= page.total || page.projects.length < 200) break;
  }
  return [...new Map(rows.map((project) => [project.id, project])).values()];
}

export default function CommunicationTaskDialog({ clientId, message, user, onClose }) {
  const name = storageName(user, clientId, message.id);
  const [recovery, setRecovery] = useState(() => { try { return { intent: savedIntent(name), blocked: false }; } catch { return { intent: null, blocked: true }; } });
  const [title, setTitle] = useState((message.subject || 'Email follow-up').slice(0, 500));
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [dueDate, setDueDate] = useState('');
  const [projectId, setProjectId] = useState(message.projectId || '');
  const [action, setAction] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [confirmationUnknown, setConfirmationUnknown] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const projects = useQuery({ queryKey: ['email-task-projects', user.organizationId, user.id, clientId], queryFn: () => clientProjects(clientId), retry: false, refetchOnWindowFocus: false });

  async function recover() {
    if (busy.current || !recovery.intent || recovery.blocked || forbidden) return;
    busy.current = true; setPending(true); setError('');
    try {
      const receipt = action?.id
        ? await api.getCommunicationTaskAction(clientId, message.id, action.id)
        : await api.getCommunicationTaskByIntent(clientId, message.id, recovery.intent.key);
      if (alive.current) { setAction(receipt.action); setConfirmationUnknown(false); }
    } catch (failure) {
      if (!alive.current) return;
      if (denied(failure)) { setForbidden(true); setAction(null); }
      setError('The saved request could not be checked. Keep this request and check again before creating another task.');
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  // A reopen may read the receipt; it never prepares or confirms a task.
  useEffect(() => { if (recovery.intent && !recovery.blocked) recover(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function retain(intent) {
    const raw = JSON.stringify(intent);
    sessionStorage.setItem(name, raw);
    if (sessionStorage.getItem(name) !== raw) throw new Error('Storage unavailable');
    if (alive.current) setRecovery({ intent, blocked: false });
  }
  async function prepare(event) {
    event.preventDefault();
    if (busy.current || forbidden || recovery.blocked || action || !title.trim() || !projects.data?.some((project) => project.id === projectId)) return;
    busy.current = true; setPending(true); setError('');
    try {
      const input = { projectId, title: title.trim(), description: description.trim(), priority, ...(dueDate ? { dueDate: `${dueDate}T00:00:00.000Z` } : {}) };
      const hash = await fingerprint(input);
      const previous = savedIntent(name);
      if (previous && previous.fingerprint !== hash) { setError('An earlier preview is unresolved. Restore the same task details or check its saved status.'); return; }
      const intent = previous || { key: crypto.randomUUID(), fingerprint: hash };
      try { retain(intent); } catch { setRecovery((value) => ({ ...value, blocked: true })); throw new Error('Storage unavailable'); }
      const receipt = await api.prepareCommunicationTask(clientId, message.id, { input, idempotencyKey: intent.key });
      if (alive.current) setAction(receipt.action);
    } catch (failure) {
      if (!alive.current) return;
      if (denied(failure)) { setForbidden(true); setAction(null); }
      setError('The preview could not be confirmed. Check the saved request, or retry the exact same details.');
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function confirm() {
    if (busy.current || forbidden || confirmationUnknown || !action?.preview || action.status !== 'PENDING_CONFIRMATION' || action.expired || recovery.blocked) return;
    busy.current = true; setPending(true); setError('');
    try {
      const receipt = await api.confirmCommunicationTask(clientId, message.id, action.id);
      if (alive.current) setAction(receipt.action);
    } catch (failure) {
      if (!alive.current) return;
      if (needsReauth(failure)) {
        setError('Confirm your identity to create this task. No task was created.');
        return;
      }
      if (denied(failure)) { setForbidden(true); setAction(null); }
      setConfirmationUnknown(true);
      setError('Task creation could not be confirmed. Check the saved status before trying again.');
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  function newRequest() {
    if (!definitive(action) || busy.current) return;
    try {
      sessionStorage.removeItem(name);
      if (sessionStorage.getItem(name) !== null) throw new Error('Storage unavailable');
      setRecovery({ intent: null, blocked: false }); setAction(null); setError('');
    } catch { setRecovery((value) => ({ ...value, blocked: true })); }
  }
  const preview = !forbidden && action?.preview;
  return <Modal isOpen title="Create task from email" onClose={onClose}>
    <div className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">Review the task and its source before confirming.</p>
      {error && <p role="alert">{error}</p>}
      {recovery.blocked && <p role="alert">This browser cannot safely recover the request. Task creation is unavailable.</p>}
      {forbidden ? <p role="alert">You no longer have access to this request.</p> : <>
        {recovery.intent && <div className="space-y-2"><p role="status">A saved request is retained. Checking its status does not create a task.</p><Button type="button" variant="outline" disabled={pending || recovery.blocked} onClick={recover}>Check saved status</Button></div>}
        {!action && <form onSubmit={prepare} className="space-y-3">
          {projects.isPending && <p role="status">Loading client projects…</p>}
          {projects.isError && <div role="alert"><p>Client projects could not be loaded.</p><Button type="button" variant="outline" onClick={() => projects.refetch()}>Retry projects</Button></div>}
          {projects.data?.length === 0 && <p role="status">This client has no active projects. Add an active project before creating a task.</p>}
          <label className="block">Project<select className={fieldClass} value={projectId} disabled={Boolean(message.projectId) || pending} onChange={(event) => setProjectId(event.target.value)} required><option value="">Choose client project</option>{projects.data?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="block">Title<input className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={500} disabled={pending} /></label>
          <label className="block">Description<textarea className={fieldClass} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={10000} disabled={pending} /></label>
          <label className="block">Priority<select className={fieldClass} value={priority} onChange={(event) => setPriority(event.target.value)} disabled={pending}>{['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="block">Due date (UTC)<input className={fieldClass} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={pending} /></label>
          <Button type="submit" disabled={pending || recovery.blocked || projects.isError || !projects.data?.some((project) => project.id === projectId) || !title.trim()} loading={pending}>{recovery.intent ? 'Retry same preview' : 'Preview task'}</Button>
        </form>}
        {preview && <section aria-label="Task preview" className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="font-medium">{preview.task.title}</h3><p className="whitespace-pre-wrap break-words">{preview.task.description}</p>
          <p>Project: {preview.destination.projectName}</p><p>Priority: {preview.task.priority}</p><p>Due: {preview.task.dueDate || 'No due date'}</p>
          <p className="break-words">Source email: {preview.source.subject || 'No subject'}</p><p className="break-words">From: {preview.source.sender}</p><p>Received: {preview.source.receivedAt || 'Date unavailable'}</p>
          {preview.source.threadId && <Link className="inline-flex min-h-11 items-center underline" to={`/thread/${encodeURIComponent(preview.source.threadId)}`}>Open source thread</Link>}
          {action.status === 'PENDING_CONFIRMATION' && !action.expired && <Button type="button" disabled={pending || recovery.blocked || confirmationUnknown} loading={pending} onClick={confirm}>Confirm create task</Button>}
        </section>}
        {action?.status === 'EXECUTED' && action.result?.task?.id && <div role="status"><p>Task created.</p><Link className="inline-flex min-h-11 items-center underline" to={`/task/${encodeURIComponent(action.result.task.id)}`}>Open created task</Link></div>}
        {action && action.status !== 'PENDING_CONFIRMATION' && action.status !== 'EXECUTED' && <p role="status">{action.status === 'EXECUTING' || action.outcome === 'unknown' ? 'The outcome is not yet confirmed. Check the saved status before starting another request.' : 'This request did not create a confirmed task.'}</p>}
        {action?.expired && <p role="status">This preview has expired.</p>}
        {definitive(action) && <Button type="button" variant="outline" disabled={pending || recovery.blocked} onClick={newRequest}>Start another task</Button>}
      </>}
      <Button type="button" variant="outline" onClick={onClose}>Close</Button>
    </div>
  </Modal>;
}
