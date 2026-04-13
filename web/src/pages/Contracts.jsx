import { useState } from 'react';
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
import { Button, Card } from '../components/ui';
import Modal from '../components/Modal';

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

  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ['contracts', filterStatus],
    queryFn: () => api.getContracts(filterStatus ? { status: filterStatus } : {}),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

  const { data: approvedProposals = [] } = useQuery({
    queryKey: ['proposals', 'APPROVED'],
    queryFn: () => api.getProposals({ status: 'APPROVED' }),
    enabled: showProposalPicker,
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createContract(data),
    onSuccess: () => {
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

  const [form, setForm] = useState({ clientId: '', title: '', templateType: 'RETAINER' });

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
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
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
        {approvedProposals.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No approved proposals available.
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {approvedProposals.map((p) => (
              <button
                key={p.id}
                onClick={() => fromProposalMutation.mutate(p.id)}
                disabled={fromProposalMutation.isPending}
                className="w-full text-left px-4 py-3 rounded-lg border border-border hover:bg-muted/50 transition-colors disabled:opacity-50"
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
                onClick={() => navigator.clipboard.writeText(aiResult)}
                className="mt-1 text-xs underline"
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
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Contracts List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : contracts.length === 0 ? (
        <Card className="p-12 text-center">
          <ScrollText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">No contracts yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Create a contract or generate one from an approved proposal.</p>
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
                      onClick={() => setExpandedId(isExpanded ? null : contract.id)}
                      className="text-sm font-medium text-foreground hover:text-primary truncate block text-left"
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
                      onClick={() => openAiRefine(contract)}
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                      title="AI Refine"
                      style={{ '--tw-text-opacity': 1 }}
                    >
                      <Wand2 className="w-4 h-4" style={{ color: '#2e2958' }} />
                    </button>
                    {(contract.status === 'SENT' || contract.status === 'SIGNED') && (
                      <button
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/portal/contract/${contract.signToken}`)}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded"
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
                    Signed by {contract.clientSigName} on {new Date(contract.signedAt).toLocaleDateString()}
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