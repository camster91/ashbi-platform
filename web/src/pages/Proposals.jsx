import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Copy, Trash2, Clock, XCircle, ExternalLink, Sparkles, Clipboard,
  Save, RefreshCw, Pencil,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button, Card, EmptyState, LoadingState, SlowNotice, StatusBadge } from '../components/ui';
import QueryErrorState from '../components/QueryErrorState';
import useAutosave from '../hooks/useAutosave';
import DraftRecoveryNotice from '../components/DraftRecoveryNotice';

export default function Proposals() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(searchParams.get('create') === 'true');
  const [showGenerator, setShowGenerator] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [form, setForm] = useState({ clientId: '', title: '', notes: '' });
  const [proposalToDelete, setProposalToDelete] = useState(null);
  const formDraft = useAutosave('proposal', 'new', form);

  useEffect(() => {
    if (formDraft.draft) setShowCreate(true);
  }, [formDraft.draft]);

  const {
    data: proposals = [],
    isLoading,
    isError: proposalsError,
    error: proposalsRequestError,
    refetch: refetchProposals,
    isFetching: proposalsFetching,
  } = useQuery({
    queryKey: ['proposals', filterStatus],
    queryFn: () => api.getProposals(filterStatus ? { status: filterStatus } : {}),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients().then((r) => r?.clients ?? []),
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createProposal(data),
    onSuccess: (proposal) => {
      void formDraft.clearDraft();
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      setShowCreate(false);
      navigate(`/proposal/${proposal.id}`);
    },
    onError: (error) => toast.error('Failed to create proposal', error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteProposal(id),
    onSuccess: (result, id) => {
      setProposalToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      const title = proposals.find((proposal) => proposal.id === id)?.title || 'Proposal';
      toast.success({
        title: `${title} deleted`,
        duration: 10000,
        action: {
          label: `Undo delete ${title}`,
          onClick: async () => {
            try {
              await api.restoreTrashItem(result.trashId);
              await queryClient.invalidateQueries({ queryKey: ['proposals'] });
              toast.success('Proposal restored');
            } catch (error) {
              toast.error({
                title: 'Could not restore proposal',
                message: error.message || 'Open Trash or refresh before trying again.',
                duration: 0,
              });
              throw error;
            }
          },
        },
      });
    },
    onError: () => toast.error('Failed to delete proposal'),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id) => api.duplicateProposal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      toast.success('Proposal duplicated');
    },
    onError: () => toast.error('Failed to duplicate proposal'),
  });

  const handleCreate = (e) => {
    e.preventDefault();
    createMutation.mutate({
      ...form,
      lineItems: [{ description: 'Service', quantity: 1, unitPrice: 0 }],
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Proposals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage client proposals
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowGenerator(true)}
            className="min-h-11 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full bg-brand-lime text-brand-indigo hover:brightness-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Sparkles className="w-4 h-4" />
            AI Generate
          </button>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
            New Proposal
          </Button>
        </div>
      </div>

      {/* Status Filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'DRAFT', 'SENT', 'VIEWED', 'APPROVED', 'DECLINED'].map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={filterStatus === s}
            onClick={() => setFilterStatus(s)}
            className={`min-h-11 px-3 py-1.5 text-sm rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              filterStatus === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* AI Proposal Generator */}
      {showGenerator && (
        <ProposalGenerator
          clients={clients}
          onClose={() => setShowGenerator(false)}
          onSaveDraft={(data) => {
            createMutation.mutate(data);
            setShowGenerator(false);
          }}
        />
      )}

      {/* Create Modal */}
      {showCreate && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">New Proposal</h2>
          <DraftRecoveryNotice
            draft={formDraft.draft}
            draftSavedAt={formDraft.draftMeta?.draftSavedAt}
            status={formDraft.status}
            lastSaved={formDraft.lastSaved}
            onRecover={(recovered) => { setForm(recovered); formDraft.setDraft(null); }}
            onDiscard={formDraft.discardDraft}
            onRetry={formDraft.saveNow}
          />
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Client</label>
              <select
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                required
              >
                <option value="">Select client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                placeholder="e.g., Website Redesign Proposal"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={createMutation.isPending} slowAfterMs={false}>Create</Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
            <SlowNotice active={createMutation.isPending} kind="write" />
          </form>
        </Card>
      )}

      {/* Proposals List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingState label="Loading proposals…" compact />
        </div>
      ) : proposalsError ? (
        <QueryErrorState
          error={proposalsRequestError}
          message="Proposals could not be loaded"
          onRetry={refetchProposals}
          isRetrying={proposalsFetching}
        />
      ) : proposals.length === 0 ? (
        <Card>
          <EmptyState
            icon={filterStatus ? 'search' : 'document'}
            title={filterStatus ? `No ${filterStatus.toLowerCase()} proposals` : 'No proposals yet'}
            description={filterStatus ? 'Try another status or clear the current filter.' : 'Create your first proposal to send a professional quote.'}
            actionLabel={filterStatus ? 'Clear Filter' : 'Create Proposal'}
            onAction={filterStatus ? () => setFilterStatus('') : () => setShowCreate(true)}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {proposals.map((proposal) => {
            return (
              <Card key={proposal.id} className="p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <Link
                      to={`/proposal/${proposal.id}`}
                      className="text-sm font-medium text-foreground hover:text-primary truncate block"
                    >
                      {proposal.title}
                    </Link>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{proposal.client?.name}</span>
                      <span>${proposal.total?.toFixed(2)}</span>
                      {proposal.validUntil && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Valid until {new Date(proposal.validUntil).toLocaleDateString('en-CA')}
                        </span>
                      )}
                    </div>
                  </div>
                  <StatusBadge domain="proposal" status={proposal.status} className="px-2.5 py-1" />
                  <div className="flex items-center gap-1">
                    {proposal.status === 'SENT' && proposal.viewToken && (
                      <button
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/portal/proposal/${proposal.viewToken}`)}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                        title="Copy client link"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => duplicateMutation.mutate(proposal.id)}
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                      title="Duplicate"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    {proposal.status === 'DRAFT' && (
                      <button
                        onClick={() => { deleteMutation.reset(); setProposalToDelete(proposal); }}
                        className="p-1.5 text-muted-foreground hover:text-destructive rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(proposalToDelete)}
        title="Delete proposal"
        description={proposalToDelete ? `Delete “${proposalToDelete.title || 'Proposal'}”? You can undo this action for 10 seconds.` : ''}
        confirmLabel="Delete proposal"
        onConfirm={() => proposalToDelete && deleteMutation.mutate(proposalToDelete.id)}
        onCancel={() => { deleteMutation.reset(); setProposalToDelete(null); }}
        pending={deleteMutation.isPending}
        error={deleteMutation.error?.message}
      />
    </div>
  );
}

/* ───────────────────────────────────────────────
   AI Proposal Generator
   ─────────────────────────────────────────────── */

const PROJECT_TYPES = [
  { value: 'branding', label: 'Branding' },
  { value: 'web-design', label: 'Web Design' },
  { value: 'packaging', label: 'Packaging Design' },
  { value: 'full-service', label: 'Full Service' },
  { value: 'seo', label: 'SEO & Digital Marketing' },
  { value: 'shopify', label: 'Shopify / E-Commerce' },
];

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'creative', label: 'Creative' },
];

function ProposalGenerator({ clients, onClose, onSaveDraft }) {
  const toast = useToast();
  const [genForm, setGenForm] = useState({
    clientId: '',
    clientName: '',
    projectType: 'branding',
    budget: '',
    requirements: '',
    tone: 'professional',
  });
  const [generatedResult, setGeneratedResult] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');

  // Sync clientName when clientId changes
  const handleClientChange = (clientId) => {
    const client = clients.find((c) => c.id === clientId);
    setGenForm((prev) => ({
      ...prev,
      clientId,
      clientName: client?.name || '',
    }));
  };

  // POST /api/ai/generate-proposal: the client is referenced by id (the
  // server reads its name inside this organization); project type, tone and
  // requirements travel in the free-text brief.
  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!genForm.clientId) {
      toast.error('Select a client to generate a proposal for');
      return;
    }
    setIsGenerating(true);
    setGeneratedResult(null);
    setIsEditing(false);
    setEditedContent('');

    const projectTypeLabel = PROJECT_TYPES.find((pt) => pt.value === genForm.projectType)?.label || genForm.projectType;
    const toneLabel = TONE_OPTIONS.find((t) => t.value === genForm.tone)?.label || genForm.tone;
    const brief = [
      `Project type: ${projectTypeLabel}`,
      `Tone: ${toneLabel}`,
      genForm.requirements.trim() ? `Requirements: ${genForm.requirements.trim()}` : '',
    ].filter(Boolean).join('\n');
    const budget = Number(genForm.budget);

    try {
      const result = await api.generateProposal({
        clientId: genForm.clientId,
        brief,
        budget: Number.isFinite(budget) && budget > 0 ? budget : undefined,
      });
      setGeneratedResult(result);
    } catch (err) {
      toast.error('Failed to generate proposal: ' + (err.message || 'Unknown error'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = () => {
    handleGenerate({ preventDefault: () => {} });
  };

  const handleCopy = () => {
    const text = proposalText();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEdit = () => {
    setEditedContent(proposalText());
    setIsEditing(true);
  };

  const proposalText = () => generatedResult?.proposal || '';

  const handleSaveDraft = () => {
    const content = isEditing ? editedContent : proposalText();
    const title = `${genForm.projectType.charAt(0).toUpperCase() + genForm.projectType.slice(1).replace('-', ' ')} Proposal - ${generatedResult?.clientName || genForm.clientName}`;

    onSaveDraft({
      clientId: generatedResult?.clientId || genForm.clientId,
      title,
      notes: content,
      lineItems: [{ description: genForm.projectType, quantity: 1, unitPrice: 0 }],
    });
  };

  return (
    <Card className="p-6 border-2 border-brand-indigo/20">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-brand-indigo" />
          <h2 className="text-lg font-semibold">AI Proposal Generator</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close proposal generator" className="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <XCircle className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleGenerate} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Client dropdown: a proposal is generated for an existing client */}
          <div className="sm:col-span-2">
            <label htmlFor="proposal-generator-client" className="block text-sm font-medium mb-1">Client</label>
            <select
              id="proposal-generator-client"
              value={genForm.clientId}
              onChange={(e) => handleClientChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
            >
              <option value="">Select client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Project type */}
          <div>
            <label className="block text-sm font-medium mb-1">Project Type</label>
            <select
              value={genForm.projectType}
              onChange={(e) => setGenForm({ ...genForm, projectType: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              {PROJECT_TYPES.map((pt) => (
                <option key={pt.value} value={pt.value}>{pt.label}</option>
              ))}
            </select>
          </div>

          {/* Budget */}
          <div>
            <label className="block text-sm font-medium mb-1">Budget</label>
            <input
              type="number"
              value={genForm.budget}
              onChange={(e) => setGenForm({ ...genForm, budget: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              placeholder="e.g., 5000"
              min="0"
            />
          </div>

          {/* Requirements */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Requirements</label>
            <textarea
              value={genForm.requirements}
              onChange={(e) => setGenForm({ ...genForm, requirements: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              rows={3}
              placeholder="Describe the project scope, deliverables, timeline, or any specific requirements..."
            />
          </div>

          {/* Tone */}
          <div>
            <label className="block text-sm font-medium mb-1">Tone</label>
            <select
              value={genForm.tone}
              onChange={(e) => setGenForm({ ...genForm, tone: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              {TONE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={isGenerating}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-full bg-brand-lime text-brand-indigo hover:brightness-95 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-brand-indigo border-t-transparent" />
              Generating proposal...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Generate
            </>
          )}
        </button>
      </form>

      {/* Loading state */}
      {isGenerating && (
        <div className="mt-6 flex flex-col items-center justify-center py-12 text-muted-foreground">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-brand-indigo border-t-transparent mb-4" />
          <p className="text-sm font-medium">Generating proposal...</p>
          <p className="text-xs mt-1">This usually takes 10-20 seconds</p>
        </div>
      )}

      {/* Generated result */}
      {generatedResult && !isGenerating && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Generated Proposal</h3>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="xs"
                onClick={handleCopy}
                leftIcon={<Clipboard className="w-3 h-3" />}
              >
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={handleRegenerate}
                leftIcon={<RefreshCw className="w-3 h-3" />}
              >
                Regenerate
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={isEditing ? () => setIsEditing(false) : handleEdit}
                leftIcon={<Pencil className="w-3 h-3" />}
              >
                {isEditing ? 'Preview' : 'Edit'}
              </Button>
              <button
                onClick={handleSaveDraft}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-full bg-brand-indigo text-brand-lime hover:brightness-110 transition"
              >
                <Save className="w-3 h-3" />
                Create Proposal
              </button>
            </div>
          </div>

          {/* Content: either formatted preview or editable textarea */}
          {isEditing ? (
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-border bg-background text-sm font-mono"
              rows={20}
            />
          ) : (
            <div className="rounded-lg border border-border bg-background p-5 max-h-[500px] overflow-y-auto">
              <FormattedProposal result={generatedResult} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ───────────────────────────────────────────────
   Formatted proposal preview
   ─────────────────────────────────────────────── */

function FormattedProposal({ result }) {
  // POST /api/ai/generate-proposal returns the proposal as plain text
  const text = result.proposal || '';
  return (
    <div className="text-sm whitespace-pre-line leading-relaxed">{text}</div>
  );
}
