import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
  RefreshCw,
  Pencil,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
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
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(searchParams.get('create') === 'true');
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      toast.success('Proposal deleted');
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
          <button
            onClick={() => setShowGenerator(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full bg-[#e6f354] text-[#2e2958] hover:brightness-95 transition"
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

  const handleGenerate = async (e) => {
    e.preventDefault();
    setIsGenerating(true);
    setGeneratedResult(null);
    setIsEditing(false);
    setEditedContent('');

    const payload = {
      clientName: genForm.clientName,
      projectType: genForm.projectType,
      budget: genForm.budget || undefined,
      requirements: genForm.requirements || undefined,
      tone: genForm.tone,
    };

    try {
      // Try the structured proposals-ai endpoint first (returns JSON with lineItems)
      if (genForm.clientId) {
        const aiPayload = {
          clientId: genForm.clientId,
          clientName: genForm.clientName,
          projectType: genForm.projectType,
          budget: genForm.budget || undefined,
          scope: genForm.requirements || undefined,
          notes: genForm.requirements || undefined,
        };
        const result = await api.generateProposalAI(aiPayload);
        setGeneratedResult({ ...result, source: 'ai' });
      } else {
        // No clientId — use the sales text-based endpoint
        const result = await api.generateSalesProposal(payload);
        setGeneratedResult({ ...result, source: 'sales' });
      }
    } catch (err) {
      // Fallback: try the other endpoint if the first fails
      try {
        const fallback = await api.generateSalesProposal(payload);
        setGeneratedResult({ ...fallback, source: 'sales' });
      } catch (fallbackErr) {
        toast.error('Failed to generate proposal: ' + (fallbackErr.message || 'Unknown error'));
      }
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

  const proposalText = () => {
    if (!generatedResult) return '';
    if (generatedResult.source === 'ai' && generatedResult.proposal) {
      const p = generatedResult.proposal;
      const parts = [
        p.title ? `# ${p.title}` : '',
        p.summary ? `\n${p.summary}` : '',
        p.lineItems?.length
          ? `\n## Deliverables & Pricing\n` +
            p.lineItems.map((li) => `- ${li.description} (x${li.quantity ?? 1}): $${li.unitPrice?.toLocaleString()}`).join('\n')
          : '',
        p.timeline ? `\n## Timeline\n${p.timeline}` : '',
        p.notes ? `\n## Terms & Notes\n${p.notes}` : '',
      ].filter(Boolean);
      return parts.join('\n') || JSON.stringify(generatedResult, null, 2);
    }
    // Sales endpoint returns proposal as plain text string
    return generatedResult.proposal || JSON.stringify(generatedResult, null, 2);
  };

  const handleSaveDraft = () => {
    const content = isEditing ? editedContent : proposalText();
    const matchedClient = clients.find((c) => c.id === genForm.clientId);
    const title =
      generatedResult?.title ||
      `${genForm.projectType.charAt(0).toUpperCase() + genForm.projectType.slice(1).replace('-', ' ')} Proposal - ${genForm.clientName}`;

    const lineItems =
      generatedResult?.proposal?.lineItems?.map((li) => ({
        description: li.description,
        quantity: li.quantity ?? 1,
        unitPrice: li.unitPrice ?? 0,
      })) || [{ description: genForm.projectType, quantity: 1, unitPrice: 0 }];

    onSaveDraft({
      clientId: matchedClient?.id || genForm.clientId || clients[0]?.id,
      title,
      notes: content,
      lineItems,
    });
  };

  return (
    <Card className="p-6 border-2 border-[#2e2958]/20">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#2e2958]" />
          <h2 className="text-lg font-semibold">AI Proposal Generator</h2>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <XCircle className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleGenerate} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Client dropdown */}
          <div>
            <label className="block text-sm font-medium mb-1">Client</label>
            <select
              value={genForm.clientId}
              onChange={(e) => handleClientChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              <option value="">Select client (or type below)...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Client name (auto-filled from dropdown, or free text) */}
          <div>
            <label className="block text-sm font-medium mb-1">Client Name</label>
            <input
              type="text"
              value={genForm.clientName}
              onChange={(e) => setGenForm({ ...genForm, clientName: e.target.value, clientId: '' })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              placeholder="e.g., Acme Foods"
              required
            />
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
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-full bg-[#e6f354] text-[#2e2958] hover:brightness-95 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#2e2958] border-t-transparent" />
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
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#2e2958] border-t-transparent mb-4" />
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
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-full bg-[#2e2958] text-[#e6f354] hover:brightness-110 transition"
              >
                <Save className="w-3 h-3" />
                Create Proposal
              </button>
            </div>
          </div>

          {/* Metadata bar */}
          <div className="flex gap-3 text-xs text-muted-foreground">
            {generatedResult.metadata?.generatedAt && (
              <span>Generated {new Date(generatedResult.metadata.generatedAt).toLocaleString()}</span>
            )}
            {generatedResult.source === 'ai' && <span>Structured output with line items</span>}
            {generatedResult.source === 'sales' && <span>Text-based output</span>}
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
  // Structured output from proposals-ai endpoint
  if (result.source === 'ai' && result.proposal) {
    const p = result.proposal;
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        {p.title && <h2 className="text-lg font-bold text-[#2e2958] dark:text-[#e6f354]">{p.title}</h2>}
        {p.summary && <p className="text-sm leading-relaxed">{p.summary}</p>}

        {p.lineItems?.length > 0 && (
          <>
            <h3 className="text-sm font-semibold mt-4 mb-2">Deliverables &amp; Pricing</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2">Deliverable</th>
                  <th className="pb-2 w-16 text-center">Qty</th>
                  <th className="pb-2 w-24 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {p.lineItems.map((li, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-2">{li.description}</td>
                    <td className="py-2 text-center">{li.quantity ?? 1}</td>
                    <td className="py-2 text-right">${li.unitPrice?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              {p.subtotal != null && (
                <tfoot>
                  <tr className="font-semibold">
                    <td colSpan={2} className="pt-2">Total</td>
                    <td className="pt-2 text-right">${p.total?.toLocaleString() ?? p.subtotal?.toLocaleString()}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </>
        )}

        {p.timeline && (
          <>
            <h3 className="text-sm font-semibold mt-4 mb-1">Timeline</h3>
            <p className="text-sm">{p.timeline}</p>
          </>
        )}

        {p.notes && (
          <>
            <h3 className="text-sm font-semibold mt-4 mb-1">Terms &amp; Notes</h3>
            <p className="text-sm whitespace-pre-line">{p.notes}</p>
          </>
        )}
      </div>
    );
  }

  // Plain-text output from sales endpoint
  const text = result.proposal || '';
  return (
    <div className="text-sm whitespace-pre-line leading-relaxed">{text}</div>
  );
}