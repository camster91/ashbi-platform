import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, FolderOpen, Users } from 'lucide-react';
import Modal, { ModalFooter } from './Modal';
import QueryErrorState from './QueryErrorState';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

const TAB_OPTIONS = [
  { id: 'project', label: 'Project', icon: FolderOpen },
  { id: 'task', label: 'Task', icon: CheckSquare },
  { id: 'client', label: 'Client', icon: Users },
];

export default function QuickAdd({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('project');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const successTimer = useRef(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: projectsData,
    error: projectsError,
    isFetching: projectsFetching,
    refetch: retryProjects,
  } = useQuery({
    queryKey: ['projects', 'quick-add'],
    queryFn: () => api.getProjects({ limit: '50' }),
    enabled: open,
  });
  const {
    data: clientsData,
    error: clientsError,
    isFetching: clientsFetching,
    refetch: retryClients,
  } = useQuery({
    queryKey: ['clients', 'quick-add'],
    queryFn: () => api.getClients({ limit: '50' }),
    enabled: open,
  });

  const projects = projectsData?.projects || [];
  const clients = clientsData?.clients || [];

  useEffect(() => {
    if (!open) return;
    setActiveTab('project');
    setName('');
    setEmail('');
    setClientId('');
    setProjectId('');
    setError('');
    setDone(false);
    setSaving(false);
  }, [open]);

  useEffect(() => () => {
    if (successTimer.current) clearTimeout(successTimer.current);
  }, []);

  const closeQuickAdd = () => {
    if (saving) return;
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = null;
    onClose();
  };

  const switchTab = (tab) => {
    if (saving) return;
    setActiveTab(tab);
    setName('');
    setEmail('');
    setError('');
    setDone(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) { setError('Name is required'); return; }
    if (activeTab === 'project' && !clientId) { setError('Select a client'); return; }
    if (activeTab === 'task' && !projectId) { setError('Select a project'); return; }
    if (activeTab === 'client' && !email.trim()) { setError('Email is required'); return; }

    setSaving(true);
    setError('');
    setDone(false);

    try {
      if (activeTab === 'project') {
        const result = await api.createProject({ name: name.trim(), clientId });
        await queryClient.invalidateQueries({ queryKey: ['projects'] });
        setSaving(false);
        onClose();
        navigate(`/projects/${result?.id || result?.project?.id}`);
      } else if (activeTab === 'task') {
        await api.createQuickTask(projectId, { title: name.trim(), status: 'PENDING' });
        await queryClient.invalidateQueries({ queryKey: ['tasks'] });
        setDone(true);
        setSaving(false);
        successTimer.current = setTimeout(onClose, 1200);
      } else {
        await api.createClient({
          name: name.trim(),
          contacts: [{ name: name.trim(), email: email.trim(), isPrimary: true }],
        });
        await queryClient.invalidateQueries({ queryKey: ['clients'] });
        setSaving(false);
        onClose();
        navigate('/clients');
      }
    } catch (requestError) {
      setError(requestError?.message || 'Failed to create. Try again.');
      setSaving(false);
    }
  };

  const lookupError = activeTab === 'project' ? clientsError : activeTab === 'task' ? projectsError : null;
  const lookupEmpty = activeTab === 'project' ? clients.length === 0 : activeTab === 'task' ? projects.length === 0 : false;
  const submitDisabled = saving || done || !name.trim() || lookupEmpty || Boolean(lookupError)
    || (activeTab === 'project' && !clientId)
    || (activeTab === 'task' && !projectId)
    || (activeTab === 'client' && !email.trim());

  return (
    <Modal isOpen={open} onClose={closeQuickAdd} title="Quick add" size="md" showCloseButton={!saving}>
      <div className="flex flex-wrap gap-2" aria-label="Item type">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => switchTab(tab.id)}
            disabled={saving}
            aria-pressed={activeTab === tab.id}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors motion-reduce:transition-none',
              activeTab === tab.id
                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            <tab.icon className="h-4 w-4" aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="quick-add-name" className="mb-1.5 block text-sm font-medium">
            {activeTab === 'project' ? 'Project name' : activeTab === 'task' ? 'Task title' : 'Client or company name'}
          </label>
          <input
            id="quick-add-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={saving || done}
            placeholder={activeTab === 'project' ? 'New website redesign' : activeTab === 'task' ? 'Design homepage hero' : 'Acme Corporation'}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoComplete="off"
          />
        </div>

        {activeTab === 'project' && clientsError && (
          <QueryErrorState error={clientsError} message="Clients could not be loaded" onRetry={retryClients} isRetrying={clientsFetching} />
        )}
        {activeTab === 'task' && projectsError && (
          <QueryErrorState error={projectsError} message="Projects could not be loaded" onRetry={retryProjects} isRetrying={projectsFetching} />
        )}

        {activeTab === 'project' && !clientsError && (
          <div>
            <label htmlFor="quick-add-client" className="mb-1.5 block text-sm font-medium">Client</label>
            <select id="quick-add-client" value={clientId} onChange={(event) => setClientId(event.target.value)} disabled={saving || clientsFetching} className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Select a client</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
            {!clientsFetching && clients.length === 0 && <p role="status" className="mt-2 text-sm text-muted-foreground">Create a client before adding a project.</p>}
          </div>
        )}

        {activeTab === 'task' && !projectsError && (
          <div>
            <label htmlFor="quick-add-project" className="mb-1.5 block text-sm font-medium">Project</label>
            <select id="quick-add-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={saving || projectsFetching} className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Select a project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            {!projectsFetching && projects.length === 0 && <p role="status" className="mt-2 text-sm text-muted-foreground">Create a project before adding a task.</p>}
          </div>
        )}

        {activeTab === 'client' && (
          <div>
            <label htmlFor="quick-add-email" className="mb-1.5 block text-sm font-medium">Primary contact email</label>
            <input id="quick-add-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={saving || done} placeholder="hello@acmecorp.com" className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500" autoComplete="email" />
          </div>
        )}

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {done && <p role="status" className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300"><CheckSquare className="h-4 w-4" aria-hidden="true" />Task created.</p>}

        <ModalFooter>
          <button type="button" onClick={closeQuickAdd} disabled={saving} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={submitDisabled} className="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Creating…' : `Create ${TAB_OPTIONS.find((tab) => tab.id === activeTab)?.label}`}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
