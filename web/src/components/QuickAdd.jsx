import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, FolderOpen, CheckSquare, Users, Command } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

const TAB_OPTIONS = [
  { id: 'project', label: 'Project', icon: FolderOpen, placeholder: 'New website for...' },
  { id: 'task', label: 'Task', icon: CheckSquare, placeholder: 'Design homepage...' },
  { id: 'client', label: 'Client', icon: Users, placeholder: 'Acme Corp' },
];

function useProjects() {
  const [projects, setProjects] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api.projects.getProjects({ limit: '50' }).then(data => {
      if (!cancelled) setProjects(data?.projects || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return projects;
}

function useClients() {
  const [clients, setClients] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api.clients.getClients({ limit: '50' }).then(data => {
      if (!cancelled) setClients(data?.clients || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return clients;
}

export default function QuickAdd({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('project');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const projects = useProjects();
  const clients = useClients();

  // Focus input on open
  useEffect(() => {
    if (open) {
      setActiveTab('project');
      setName('');
      setEmail('');
      setClientId('');
      setProjectId('');
      setError('');
      setDone(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Handle Cmd+K and Escape
  const handleKeyDown = useCallback((e) => {
    if (!open) return;
    if (e.key === 'Escape') { onClose(); return; }

    // Tab switching with numbers
    if ((e.metaKey || e.ctrlKey) && e.key === '1') { e.preventDefault(); setActiveTab('project'); }
    if ((e.metaKey || e.ctrlKey) && e.key === '2') { e.preventDefault(); setActiveTab('task'); }
    if ((e.metaKey || e.ctrlKey) && e.key === '3') { e.preventDefault(); setActiveTab('client'); }
  }, [open, onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }

    setSaving(true);
    setError('');

    try {
      if (activeTab === 'project') {
        const res = await api.projects.createProject({
          name: name.trim(),
          clientId: clientId || undefined,
          status: 'LEAD',
        });
        onClose();
        navigate(`/projects/${res?.id || res?.project?.id}`);
      } else if (activeTab === 'task') {
        const pid = projectId || (projects?.[0]?.id);
        if (!pid) { setError('Select a project'); setSaving(false); return; }
        const res = await api.tasks.createQuickTask(pid, {
          title: name.trim(),
          status: 'TODO',
        });
        setDone(true);
        setTimeout(onClose, 1200);
      } else if (activeTab === 'client') {
        if (!email.trim()) { setError('Email is required'); setSaving(false); return; }
        await api.clients.createClient({
          name: name.trim(),
          contacts: [{ email: email.trim(), isPrimary: true }],
        });
        onClose();
        navigate('/clients');
      }
    } catch (err) {
      setError(err?.message || 'Failed to create. Try again.');
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      role="button"
      tabIndex={0}
      aria-label="Close quick add"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" />

      {/* Panel */}
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-in zoom-in-95 fade-in duration-150">
        {/* Header */}
        <div className="flex items-center px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex gap-1">
            {TAB_OPTIONS.map((t) => (
              <button
                key={t.id}
                onClick={() => { setActiveTab(t.id); setName(''); setEmail(''); setError(''); }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  activeTab === t.id
                    ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-gray-400 bg-gray-100 dark:bg-gray-800 rounded font-mono">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Primary field: Name/Title */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
              {activeTab === 'project' ? 'Project Name' : activeTab === 'task' ? 'Task Title' : 'Client / Company Name'}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={activeTab === 'project' ? 'New website redesign...' : activeTab === 'task' ? 'Design homepage hero...' : 'Acme Corporation'}
              className="w-full px-4 py-3 text-base rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
              autoComplete="off"
            />
          </div>

          {/* Secondary field (context-dependent) */}
          {activeTab === 'project' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
                Client <span className="text-gray-300">(optional)</span>
              </label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full px-4 py-3 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">No client (add later)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {activeTab === 'task' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
                Project
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-4 py-3 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {activeTab === 'client' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="hello@acmecorp.com"
                className="w-full px-4 py-3 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                autoComplete="email"
              />
            </div>
          )}

          {/* Error / Success */}
          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
          )}
          {done && (
            <p className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2 flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              Task created!
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className={cn(
              'w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200',
              saving || !name.trim()
                ? 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] shadow-lg shadow-indigo-500/20'
            )}
          >
            {saving ? 'Creating...' : `Create ${TAB_OPTIONS.find(t => t.id === activeTab)?.label}`}
          </button>
        </form>
      </div>
    </div>
  );
}
