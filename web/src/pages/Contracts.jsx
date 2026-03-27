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
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

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
  const [showCreate, setShowCreate] = useState(false);
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

  const createMutation = useMutation({
    mutationFn: (data) => api.createContract(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      setShowCreate(false);
      setForm({ clientId: '', title: '', templateType: 'RETAINER' });
    },
  });

  const sendMutation = useMutation({
    mutationFn: (id) => api.sendContract(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contracts'] }),
  });

  const [form, setForm] = useState({ clientId: '', title: '', templateType: 'RETAINER' });

  const handleCreate = (e) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Contracts</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage client contracts and agreements</p>
        </div>
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
          New Contract
        </Button>
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
                    {(contract.status === 'SENT' || contract.status === 'SIGNED') && (
                      <button
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/view/contract/${contract.signToken}`)}
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
