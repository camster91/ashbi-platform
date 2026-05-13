import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ExternalLink, Trash2, Edit2, Check, X, FileText, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';
import { cn, formatRelativeTime } from '../lib/utils';
import ComingSoonWrapper from '../components/ComingSoonWrapper';
import { isComingSoon } from '../lib/featureFlags';

const STATUS_CONFIG = {
  DRAFT: { label: 'Draft', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', badge: 'bg-amber-500' },
  APPLIED: { label: 'Applied', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', badge: 'bg-blue-500' },
  INTERVIEWED: { label: 'Interviewed', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', badge: 'bg-green-500' },
  REJECTED: { label: 'Rejected', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', badge: 'bg-red-500' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.DRAFT;
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full', cfg.color)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.badge)} />
      {cfg.label}
    </span>
  );
}

function AddJobForm({ onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ url: '', title: '', description: '', budget: '', clientName: '' });

  const mutation = useMutation({
    mutationFn: (data) => api.createUpworkJob(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upwork-jobs'] });
      onClose();
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.url || !form.title) return;
    mutation.mutate(form);
  };

  return (
    <Card className="p-4 border border-primary/30 bg-primary/5">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Add New Job</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <input
          type="url"
          placeholder="Upwork job URL *"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          required
        />
        <input
          type="text"
          placeholder="Job title *"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          required
        />
        <input
          type="text"
          placeholder="Budget (e.g. $500 - $1,000)"
          value={form.budget}
          onChange={(e) => setForm({ ...form, budget: e.target.value })}
          className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="text"
          placeholder="Client name"
          value={form.clientName}
          onChange={(e) => setForm({ ...form, clientName: e.target.value })}
          className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <textarea
          placeholder="Job description (optional)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          rows={3}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? 'Adding...' : 'Add Job'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        </div>
        {mutation.isError && (
          <p className="text-xs text-red-500">Failed to add job. URL may already exist.</p>
        )}
      </form>
    </Card>
  );
}

function DraftEditor({ jobId, draft, onSave, onCancel }) {
  const queryClient = useQueryClient();
  const [coverLetter, setCoverLetter] = useState(draft?.coverLetter || '');
  const [proposedRate, setProposedRate] = useState(draft?.proposedRate || '');

  const mutation = useMutation({
    mutationFn: (data) => draft
      ? api.updateUpworkDraft(draft.id, data)
      : api.createUpworkDraft(jobId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upwork-drafts', jobId] });
      onSave();
    },
  });

  return (
    <Card className="p-4 border border-primary/30">
      <h4 className="text-sm font-semibold mb-3">{draft ? 'Edit Draft' : 'New Cover Letter Draft'}</h4>
      <textarea
        value={coverLetter}
        onChange={(e) => setCoverLetter(e.target.value)}
        placeholder="Write your cover letter here..."
        className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        rows={8}
      />
      <input
        type="text"
        placeholder="Proposed rate (e.g. $75/hr or $500 fixed)"
        value={proposedRate}
        onChange={(e) => setProposedRate(e.target.value)}
        className="w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary mt-2"
      />
      <div className="flex gap-2 mt-3">
        <Button
          size="sm"
          onClick={() => mutation.mutate({ coverLetter, proposedRate, status: 'READY' })}
          disabled={!coverLetter || mutation.isPending}
          leftIcon={<Check className="w-3 h-3" />}
        >
          Save Draft
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function JobRow({ job, onEditDraft, onApply }) {
  const queryClient = useQueryClient();
  const [showDrafts, setShowDrafts] = useState(false);

  const { data: draftsData } = useQuery({
    queryKey: ['upwork-drafts', job.id],
    queryFn: () => api.getUpworkDrafts(job.id),
    enabled: showDrafts,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteUpworkJob(job.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['upwork-jobs'] }),
  });

  const statusMutation = useMutation({
    mutationFn: (status) => api.updateUpworkJob(job.id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['upwork-jobs'] }),
  });

  const drafts = draftsData?.drafts || [];

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">{job.title}</h3>
            <StatusBadge status={job.status} />
            {job.score && (
              <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                Score: {job.score}/10
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {job.clientName && <span>{job.clientName}</span>}
            {job.budget && <span>{job.budget}</span>}
            <span className="flex items-center gap-0.5">
              <Clock className="w-3 h-3" />
              {formatRelativeTime(job.createdAt)}
            </span>
          </div>
          {job.description && (
            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{job.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Quick status change */}
          {job.status === 'DRAFT' && (
            <button
              onClick={() => statusMutation.mutate('APPLIED')}
              className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50"
              disabled={statusMutation.isPending}
            >
              Mark Applied
            </button>
          )}
          {job.status === 'APPLIED' && (
            <button
              onClick={() => statusMutation.mutate('INTERVIEWED')}
              className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50"
              disabled={statusMutation.isPending}
            >
              Mark Interviewed
            </button>
          )}

          <button
            onClick={() => setShowDrafts(!showDrafts)}
            className={cn(
              'p-1.5 rounded hover:bg-muted',
              showDrafts ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
            )}
            title="Cover letter drafts"
          >
            <FileText className="w-4 h-4" />
          </button>

          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
              title="Open on Upwork"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}

          <button
            onClick={() => deleteMutation.mutate()}
            className="p-1.5 text-muted-foreground hover:text-red-500 rounded hover:bg-muted"
            title="Delete job"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Drafts section */}
      {showDrafts && (
        <div className="mt-4 pt-4 border-t space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Cover Letter Drafts</span>
            <Button size="xs" variant="outline" leftIcon={<Plus className="w-3 h-3" />} onClick={onEditDraft}>
              New Draft
            </Button>
          </div>

          {drafts.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No drafts yet. Create one before applying!</p>
          ) : (
            <div className="space-y-2">
              {drafts.map((d) => (
                <div key={d.id} className="p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded',
                      d.status === 'READY' ? 'bg-green-100 text-green-700' :
                      d.status === 'SUBMITTED' ? 'bg-blue-100 text-blue-700' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {d.status}
                    </span>
                    {d.proposedRate && (
                      <span className="text-xs text-muted-foreground">{d.proposedRate}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">{d.coverLetter}</p>
                  <div className="flex gap-2 mt-2">
                    <Button size="xs" variant="outline" onClick={() => onEditDraft(d)}>Edit</Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Apply button */}
          {job.status === 'DRAFT' && drafts.some(d => d.status === 'READY') && (
            <Button
              size="sm"
              onClick={() => onApply(job.id)}
              leftIcon={<Check className="w-3 h-3" />}
            >
              Submit Proposal
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export default function UpworkJobs() {
  if (isComingSoon('upwork')) return <ComingSoonWrapper title="Upwork Jobs" />;
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingDraft, setEditingDraft] = useState(null); // null | { jobId, draft }
  const [filterStatus, setFilterStatus] = useState('');

  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['upwork-jobs', filterStatus],
    queryFn: () => api.getUpworkJobs(filterStatus ? { status: filterStatus } : {}),
  });

  const applyMutation = useMutation({
    mutationFn: (jobId) => api.applyUpworkJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upwork-jobs'] });
    },
  });

  const jobs = data?.jobs || [];

  const statusCounts = jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Upwork Job Tracker</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track jobs, draft cover letters, and manage applications
          </p>
        </div>
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : 'Add Job'}
        </Button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterStatus('')}
          className={cn(
            'px-3 py-1.5 text-sm rounded-lg transition-colors',
            !filterStatus ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
          )}
        >
          All ({jobs.length})
        </button>
        {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
          <button
            key={status}
            onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5',
              filterStatus === status ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', cfg.badge)} />
            {cfg.label} ({statusCounts[status] || 0})
          </button>
        ))}
      </div>

      {/* Add job form */}
      {showAddForm && <AddJobForm onClose={() => setShowAddForm(false)} />}

      {/* Draft editor modal */}
      {editingDraft && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-2xl">
            <DraftEditor
              jobId={editingDraft.jobId}
              draft={editingDraft.draft}
              onSave={() => setEditingDraft(null)}
              onCancel={() => setEditingDraft(null)}
            />
          </div>
        </div>
      )}

      {/* Job list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : jobs.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {filterStatus ? `No ${filterStatus.toLowerCase()} jobs yet.` : 'No jobs tracked yet. Add your first job to start.'}
          </p>
          {!filterStatus && (
            <Button className="mt-4" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowAddForm(true)}>
              Add Your First Job
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onEditDraft={(draft) => setEditingDraft({ jobId: job.id, draft })}
              onApply={(jobId) => applyMutation.mutate(jobId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}