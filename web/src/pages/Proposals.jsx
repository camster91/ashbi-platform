import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  FileText,
  Plus,
  Send,
  Copy,
  Trash2,
  Eye,
  Clock,
  CheckCircle,
  XCircle,
  ExternalLink,
  Sparkles,
  Clipboard,
  Save,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const statusConfig = {
  DRAFT: { label: 'Draft', color: 'bg-muted text-muted-foreground', icon: FileText },
  SENT: { label: 'Sent', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Send },
  VIEWED: { label: 'Viewed', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Eye },
  APPROVED: { label: 'Approved', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle },
  DECLINED: { label: 'Declined', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
};

export default function Proposals() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  const { data: proposals = [], isLoading } = useQuery({
    queryKey: ['proposals', filterStatus],
    queryFn: () => api.getProposals(filterStatus ? { status: filterStatus } : {}),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createProposal(data),
    onSuccess: (proposal) => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      setShowCreate(false);
      navigate(`/proposal/${proposal.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteProposal(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['proposals'] }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id) => api.duplicateProposal(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['proposals'] }),
  });

  const [form, setForm] = useState({ clientId: '', title: '', notes: '' });

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
          <Button variant="outline" leftIcon={<Sparkles className="w-4 h-4" />} onClick={() => setShowGenerator(true)}>
            AI Generate
          </Button>
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
              <Button type="submit" loading={createMutation.isPending}>Create</Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Proposals List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : proposals.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">No proposals yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Create your first proposal to get started.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {proposals.map((proposal) => {
            const config = statusConfig[proposal.status] || statusConfig.DRAFT;
            const StatusIcon = config.icon;
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
                          Valid until {new Date(proposal.validUntil).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${config.color}`}>
                    <StatusIcon className="w-3 h-3" />
                    {config.label}
                  </span>
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
                        onClick={() => { if (confirm('Delete this proposal?')) deleteMutation.mutate(proposal.id); }}
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
    </div>
  );
}

function ProposalGenerator({ clients, onClose, onSaveDraft }) {
  const [genForm, setGenForm] = useState({
    clientName: '',
    projectType: 'branding',
    budgetRange: '',
    notes: ''
  });
  const [generatedProposal, setGeneratedProposal] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async (e) => {
    e.preventDefault();
    setIsGenerating(true);
    setGeneratedProposal('');
    try {
      const result = await api.generateProposal(genForm);
      setGeneratedProposal(result.proposal);
    } catch (error) {
      setGeneratedProposal(`Error: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedProposal);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveDraft = () => {
    const matchedClient = clients.find(c =>
      c.name.toLowerCase().includes(genForm.clientName.toLowerCase())
    );
    onSaveDraft({
      clientId: matchedClient?.id || clients[0]?.id,
      title: `${genForm.projectType.charAt(0).toUpperCase() + genForm.projectType.slice(1)} Proposal - ${genForm.clientName}`,
      notes: generatedProposal,
      lineItems: [{ description: genForm.projectType, quantity: 1, unitPrice: 0 }]
    });
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">AI Proposal Generator</h2>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <XCircle className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleGenerate} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Client Name</label>
            <input
              type="text"
              value={genForm.clientName}
              onChange={(e) => setGenForm({ ...genForm, clientName: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              placeholder="e.g., Acme Foods"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Project Type</label>
            <select
              value={genForm.projectType}
              onChange={(e) => setGenForm({ ...genForm, projectType: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              <option value="branding">Branding</option>
              <option value="web">Web Design & Development</option>
              <option value="packaging">Packaging Design</option>
              <option value="seo">SEO & Digital Marketing</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Budget Range</label>
            <input
              type="text"
              value={genForm.budgetRange}
              onChange={(e) => setGenForm({ ...genForm, budgetRange: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              placeholder="e.g., $5,000 - $10,000"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Additional Notes</label>
            <input
              type="text"
              value={genForm.notes}
              onChange={(e) => setGenForm({ ...genForm, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              placeholder="Any specific requirements..."
            />
          </div>
        </div>

        <Button type="submit" isLoading={isGenerating} leftIcon={<Sparkles className="w-4 h-4" />}>
          {isGenerating ? 'Generating...' : 'Generate Proposal'}
        </Button>
      </form>

      {generatedProposal && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Generated Proposal</h3>
            <div className="flex gap-2">
              <Button variant="ghost" size="xs" onClick={handleCopy} leftIcon={<Clipboard className="w-3 h-3" />}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              <Button variant="outline" size="xs" onClick={handleSaveDraft} leftIcon={<Save className="w-3 h-3" />}>
                Save as Draft
              </Button>
            </div>
          </div>
          <textarea
            value={generatedProposal}
            onChange={(e) => setGeneratedProposal(e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-border bg-background text-sm font-mono"
            rows={16}
          />
        </div>
      )}
    </Card>
  );
}
