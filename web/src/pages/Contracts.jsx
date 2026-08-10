import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ScrollText,
  Plus,
  Send,
  ExternalLink,
  CheckCircle,
  FileText,
  Download,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { Button, Card, EmptyState, LoadingState } from '../components/ui';
import Modal from '../components/Modal';
import useAutosave from '../hooks/useAutosave';
import DraftRecoveryNotice from '../components/DraftRecoveryNotice';
import QueryErrorState from '../components/QueryErrorState';

const statusConfig = {
  DRAFT: { label: 'Draft', color: 'bg-muted text-muted-foreground' },
  SENT: { label: 'Sent', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  SIGNED: { label: 'Signed', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  VOID: { label: 'Void', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

const templateTypes = [
  { value: 'RETAINER', label: 'Retainer Agreement' },
  { value: 'PROJECT', label: 'Project Agreement' },
  { value: 'NDA', label: 'Mutual NDA' },
];

export default function Contracts() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [showProposalPicker, setShowProposalPicker] = useState(false);
  const [showAiRefine, setShowAiRefine] = useState(false);
  const [aiRefineContract, setAiRefineContract] = useState(null);
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [form, setForm] = useState({ clientId: '', title: '', templateType: 'RETAINER' });
  const formDraft = useAutosave('contract', 'new', form);

  useEffect(() => {
    if (formDraft.draft) setShowCreate(true);
  }, [formDraft.draft]);

  const {
    data: contracts = [],
    isLoading,
    isError: contractsError,
    error: contractsRequestError,
    refetch: refetchContracts,
    isFetching: contractsFetching,
  } = useQuery({
    queryKey: ['contracts', filterStatus],
    queryFn: () => api.getContracts(filterStatus ? { status: filterStatus } : {}),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients().then((r) => r?.clients ?? []),
  });

  const {
    data: approvedProposals = [],
    isLoading: proposalsLoading,
    isError: proposalsError,
    error: proposalsRequestError,
    refetch: refetchProposals,
    isFetching: proposalsFetching,
  } = useQuery({
    queryKey: ['proposals', 'APPROVED'],
    queryFn: () => api.getProposals({ status: 'APPROVED' }),
    enabled: showProposalPicker,
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createContract(data),
    onSuccess: () => {
      void formDraft.clearDraft();
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      setShowCreate(false);
      setForm({ clientId: '', title: '', templateType: 'RETAINER' });
      toast.success('Contract created');
    },
    onError: () => toast.error('Failed to create contract'),
  });

  const fromProposalMutation = useMutation({
    mutationFn: (proposalId) => api.createContractFromProposal(proposalId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      setShowProposalPicker(false);
      toast.success('Contract generated from proposal');
    },
    onError: (err) => toast.error('Failed to generate contract', err?.data?.error || 'Please try again'),
  });

  const sendMutation = useMutation({
    mutationFn: (id) => api.sendContract(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      toast.success('Contract sent', 'Client will receive a signing link');
    },
    onError: () => toast.error('Failed to send contract'),
  });

  const handleCreate = (e) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  const handleAiRefine = async () => {
    if (!aiInstruction.trim() || !aiRefineContract) return;
    setAiLoading(true);
    setAiResult('');
    try {
      const contractContent = aiRefineContract.content || '';
      const prompt = `Refine the following contract content with this instruction: "${aiInstruction}"\n\nContract content:\n${contractContent}\n\nReturn only the revised contract content.`;
      const res = await api.aiChat({ messages: [{ role: 'user', content: prompt }] });
      setAiResult(res?.content || res?.text || res?.message || JSON.stringify(res));
    } catch (err) {
      toast.error('AI refine failed', err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const openAiRefine = (contract) => {
    setAiRefineContract(contract);
    setAiInstruction('');
    setAiResult('');
    setShowAiRefine(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Contracts</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage client contracts and agreements</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            leftIcon={<Sparkles className="w-4 h-4" />}
            onClick={() => setShowProposalPicker(true)}
            style={{ borderColor: '#2e2958', color: '#2e2958' }}
          >
            Generate from Proposal
          </Button>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
            New Contract
          </Button>
        </div>
      </div>

      {/* Status Filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'DRAFT', 'SENT', 'SIGNED', 'VOID'].map((s) => (
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

      {/* Generate from Proposal Modal */}
      <Modal
        isOpen={showProposalPicker}
        onClose={() => setShowProposalPicker(false)}
        title="Generate Contract from Proposal"
      >
        {proposalsLoading ? (
          <LoadingState label="Loading approved proposals…" compact />
        ) : proposalsError ? (
          <QueryErrorState
            error={proposalsRequestError}
            message="Approved proposals could not be loaded"
            onRetry={refetchProposals}
            isRetrying={proposalsFetching}
          />
        ) : approvedProposals.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No approved proposals available.
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {approvedProposals.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => fromProposalMutation.mutate(p.id)}
                disabled={fromProposalMutation.isPending}
                className="w-full min-h-11 text-left px-4 py-3 rounded-lg border border-border hover:bg-muted/50 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="text-sm font-medium">{p.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {p.client?.name} — ${Number(p.total || 0).toFixed(2)}
                </div>
              </button>
            ))}
          </div>
        )}
        {fromProposalMutation.isPending && (
          <div className="mt-3 text-sm text-muted-foreground text-center">Generating contract...</div>
        )}
      </Modal>

      {/* AI Refine Modal */}
      <Modal
        isOpen={showAiRefine}
        onClose={() => setShowAiRefine(false)}
        title="AI Refine Contract"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Refinement instructions
            </label>
            <input
              type="text"
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              placeholder="e.g. Add a late payment clause"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAiRefine(); }}
            />
          </div>
          <Button
            onClick={handleAiRefine}
            loading={aiLoading}
            disabled={!aiInstruction.trim()}
            style={{ backgroundColor: '#2e2958' }}
            leftIcon={<Wand2 className="w-4 h-4" />}
          >
            Refine
          </Button>
          {aiResult && (
            <div>
              <label className="block text-sm font-medium mb-1">AI Result</label>
              <textarea
                value={aiResult}
                readOnly
                rows={10}
                className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-mono resize-y"
                onClick={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(aiResult)}
                aria-label="Copy AI result to clipboard"
                className="min-h-11 inline-flex items-center mt-1 text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ color: '#2e2958' }}
              >
                Copy to clipboard
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Create Form */}
      {showCreate && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">New Contract</h2>
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
                placeholder="Contract title"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Template</label>
              <select
                value={form.templateType}
                onChange={(e) => setForm({ ...form, templateType: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              >
                {templateTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={createMutation.isPending}>Create</Button>
              <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Contracts List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingState label="Loading contracts…" compact />
        </div>
      ) : contractsError ? (
        <QueryErrorState
          error={contractsRequestError}
          message="Contracts could not be loaded"
          onRetry={refetchContracts}
          isRetrying={contractsFetching}
        />
      ) : contracts.length === 0 ? (
        <Card>
          <EmptyState
            icon="document"
            title={filterStatus ? `No ${filterStatus.toLowerCase()} contracts` : 'No contracts yet'}
            description={filterStatus
              ? 'Try another status or clear the current filter.'
              : 'Create a contract or generate one from an approved proposal.'}
            actionLabel={filterStatus ? 'Clear Filter' : 'Create Contract'}
            onAction={filterStatus ? () => setFilterStatus('') : () => setShowCreate(true)}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {contracts.map((contract) => {
            const config = statusConfig[contract.status] || statusConfig.DRAFT;
            const isExpanded = expandedId === contract.id;
            return (
              <Card key={contract.id} className="p-4">
                <div className="flex items-center gap-4">
                  <ScrollText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : contract.id)}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} contract ${contract.title}`}
                      className="min-h-11 text-sm font-medium text-foreground hover:text-primary truncate block text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {contract.title}
                    </button>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{contract.client?.name}</span>
                      <span>{contract.templateType}</span>
                      {contract.proposal && (
                        <span>From: {contract.proposal.title}</span>
                      )}
                    </div>
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${config.color}`}>
                    {config.label}
                  </span>
                  <div className="flex items-center gap-1">
                    {contract.status === 'DRAFT' && (
                      <Button
                        size="sm"
                        variant="outline"
                        leftIcon={<Send className="w-3 h-3" />}
                        onClick={() => sendMutation.mutate(contract.id)}
                        loading={sendMutation.isPending}
                      >
                        Send
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => openAiRefine(contract)}
                      aria-label={`Refine contract ${contract.title} with AI`}
                      className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="AI Refine"
                      style={{ '--tw-text-opacity': 1 }}
                    >
                      <Wand2 className="w-4 h-4" style={{ color: '#2e2958' }} />
                    </button>
                    {(contract.status === 'SENT' || contract.status === 'SIGNED') && (
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/portal/contract/${contract.signToken}`)}
                        aria-label={`Copy signing link for ${contract.title}`}
                        className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title="Copy signing link"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    )}
                    <a
                      href={`/api/contracts/${contract.id}/pdf`}
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  </div>
                </div>
                {contract.status === 'SIGNED' && contract.clientSigName && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle className="w-3 h-3" />
                    Signed by {contract.clientSigName} on {new Date(contract.signedAt).toLocaleDateString('en-CA')}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
