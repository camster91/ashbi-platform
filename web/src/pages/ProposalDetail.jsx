import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Send,
  Plus,
  Trash2,
  Save,
  FileText,
  ExternalLink,
  CheckCircle,
  XCircle,
  History,
  RotateCcw,
  Copy,
  Eye,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { Button, Card } from '../components/ui';

function computeDiff(oldData, newData) {
  const changes = [];
  if (oldData.title !== newData.title) {
    changes.push({ field: 'Title', old: oldData.title, new: newData.title });
  }
  if (oldData.notes !== newData.notes) {
    changes.push({ field: 'Notes', old: oldData.notes || '(empty)', new: newData.notes || '(empty)' });
  }
  if (Number(oldData.subtotal || 0).toFixed(2) !== Number(newData.subtotal || 0).toFixed(2)) {
    changes.push({ field: 'Subtotal', old: `$${Number(oldData.subtotal || 0).toFixed(2)}`, new: `$${Number(newData.subtotal || 0).toFixed(2)}` });
  }
  if (Number(oldData.discount || 0).toFixed(2) !== Number(newData.discount || 0).toFixed(2)) {
    changes.push({ field: 'Discount', old: `-$${Number(oldData.discount || 0).toFixed(2)}`, new: `-$${Number(newData.discount || 0).toFixed(2)}` });
  }
  if (Number(oldData.total || 0).toFixed(2) !== Number(newData.total || 0).toFixed(2)) {
    changes.push({ field: 'Total', old: `$${Number(oldData.total || 0).toFixed(2)}`, new: `$${Number(newData.total || 0).toFixed(2)}` });
  }

  const oldItems = oldData.lineItems || [];
  const newItems = newData.lineItems || [];
  if (oldItems.length !== newItems.length) {
    changes.push({ field: 'Line Items', old: `${oldItems.length} items`, new: `${newItems.length} items` });
  } else {
    oldItems.forEach((item, i) => {
      const ni = newItems[i];
      if (!ni) return;
      if (item.description !== ni.description || Number(item.quantity || 1) !== Number(ni.quantity || 1) || Number(item.unitPrice || 0) !== Number(ni.unitPrice || 0)) {
        changes.push({
          field: `Line Item ${i + 1}`,
          old: `${item.description} — ${item.quantity || 1} × $${Number(item.unitPrice || 0).toFixed(2)}`,
          new: `${ni.description} — ${ni.quantity || 1} × $${Number(ni.unitPrice || 0).toFixed(2)}`,
        });
      }
    });
  }

  return changes;
}

function DiffView({ oldData, newData, onClose }) {
  const changes = computeDiff(oldData, newData);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" /> Version Comparison
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {changes.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No differences found between these versions.</p>
          ) : (
            changes.map((change, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-muted/40 border border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">{change.field}</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="p-2 rounded bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30">
                    <p className="text-xs text-red-600 dark:text-red-400 mb-0.5">Before</p>
                    <p className="text-foreground">{change.old}</p>
                  </div>
                  <div className="p-2 rounded bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30">
                    <p className="text-xs text-green-600 dark:text-green-400 mb-0.5">After</p>
                    <p className="text-foreground">{change.new}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="px-6 py-3 border-t border-border flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

function HistoryTab({ proposalId, currentData, isDraft }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [diffVersions, setDiffVersions] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);

  const { data: versions, isLoading } = useQuery({
    queryKey: ['proposal-versions', proposalId],
    queryFn: () => api.getProposalVersions(proposalId),
  });

  const restoreMutation = useMutation({
    mutationFn: (versionId) => api.restoreProposalVersion(proposalId, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposal', proposalId] });
      queryClient.invalidateQueries({ queryKey: ['proposal-versions', proposalId] });
      toast.success('Version restored');
      setSelectedVersion(null);
    },
    onError: () => toast.error('Failed to restore version'),
  });

  const openDiff = (v1, v2) => {
    setDiffVersions({ oldData: v2.data, newData: v1.data });
  };

  const compareCurrent = (version) => {
    setDiffVersions({ oldData: version.data, newData: currentData });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  const versionList = versions || [];

  return (
    <div className="space-y-4">
      {diffVersions && (
        <DiffView
          oldData={diffVersions.oldData}
          newData={diffVersions.newData}
          onClose={() => setDiffVersions(null)}
        />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="w-4 h-4" />
          <span>{versionList.length} version{versionList.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {versionList.length === 0 ? (
        <Card className="p-8 text-center">
          <History className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No saved versions</p>
          <p className="text-sm text-muted-foreground mt-1">Versions are created automatically when you save the proposal.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {versionList.map((version, idx) => {
            const isFirst = idx === 0;
            const isSelected = selectedVersion === version.id;
            return (
              <div
                key={version.id}
                className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/30'
                }`}
                onClick={() => setSelectedVersion(isSelected ? null : version.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                      <History className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {version.createdBy?.name || 'Unknown'}
                        {isFirst && <span className="ml-2 text-xs text-primary">(Current)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(version.createdAt).toLocaleString('en-CA', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {idx < versionList.length - 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); openDiff(version, versionList[idx + 1]); }}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); compareCurrent(version); }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    {isDraft && !isFirst && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Restore this version? Current changes will be replaced.')) {
                            restoreMutation.mutate(version.id);
                          }
                        }}
                        loading={restoreMutation.isPending && isSelected}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {isSelected && (
                  <div className="mt-3 pt-3 border-t border-border text-sm text-muted-foreground">
                    <div className="grid grid-cols-2 gap-2">
                      <div><span className="font-medium">Title:</span> {version.data.title}</div>
                      <div><span className="font-medium">Total:</span> ${Number(version.data.total || 0).toFixed(2)}</div>
                      <div><span className="font-medium">Status:</span> {version.data.status}</div>
                      <div><span className="font-medium">Line Items:</span> {(version.data.lineItems || []).length}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ProposalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState('details');

  const { data: proposal, isLoading } = useQuery({
    queryKey: ['proposal', id],
    queryFn: () => api.getProposal(id),
  });

  const [editing, setEditing] = useState(false);
  const [lineItems, setLineItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [discount, setDiscount] = useState(0);

  const startEdit = () => {
    setLineItems(proposal.lineItems || []);
    setNotes(proposal.notes || '');
    setTitle(proposal.title);
    setDiscount(proposal.discount || 0);
    setEditing(true);
    setTab('details');
  };

  const updateMutation = useMutation({
    mutationFn: (data) => api.updateProposal(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposal', id] });
      queryClient.invalidateQueries({ queryKey: ['proposal-versions', id] });
      setEditing(false);
      toast.success('Proposal saved');
    },
    onError: () => toast.error('Failed to save proposal'),
  });

  const sendMutation = useMutation({
    mutationFn: () => api.sendProposal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposal', id] });
      toast.success('Proposal sent', 'Client will receive a review link');
    },
    onError: () => toast.error('Failed to send proposal'),
  });

  const addLineItem = () => {
    setLineItems([...lineItems, { description: '', quantity: 1, unitPrice: 0 }]);
  };

  const updateLineItem = (index, field, value) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  const removeLineItem = (index) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const items = lineItems.map((li) => ({
      description: li.description,
      quantity: parseFloat(li.quantity) || 1,
      unitPrice: parseFloat(li.unitPrice) || 0,
    }));
    updateMutation.mutate({ title, notes, discount: parseFloat(discount) || 0, lineItems: items });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!proposal) {
    return <div className="text-center py-12 text-muted-foreground">Proposal not found</div>;
  }

  const subtotal = editing
    ? lineItems.reduce((sum, li) => sum + (parseFloat(li.quantity) || 1) * (parseFloat(li.unitPrice) || 0), 0)
    : proposal.subtotal;

  const total = subtotal - (editing ? parseFloat(discount) || 0 : proposal.discount);
  const isDraft = proposal.status === 'DRAFT';

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/proposals')} className="p-2 hover:bg-muted rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          {editing ? (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-2xl font-heading font-bold bg-transparent border-b border-border focus:border-primary outline-none w-full"
            />
          ) : (
            <h1 className="text-2xl font-heading font-bold text-foreground">{proposal.title}</h1>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            {proposal.client?.name} &middot; Created by {proposal.createdBy?.name}
          </p>
        </div>
        <div className="flex gap-2">
          {isDraft && !editing && (
            <>
              <Button variant="outline" onClick={startEdit}>Edit</Button>
              <Button
                leftIcon={<Send className="w-4 h-4" />}
                onClick={() => sendMutation.mutate()}
                loading={sendMutation.isPending}
              >
                Send to Client
              </Button>
            </>
          )}
          {editing && (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button
                leftIcon={<Save className="w-4 h-4" />}
                onClick={handleSave}
                loading={updateMutation.isPending}
              >
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Status Banner */}
      {proposal.status !== 'DRAFT' && (
        <Card className={`p-4 ${
          proposal.status === 'APPROVED' ? 'border-green-500/30 bg-green-50 dark:bg-green-900/10' :
          proposal.status === 'DECLINED' ? 'border-red-500/30 bg-red-50 dark:bg-red-900/10' :
          'border-blue-500/30 bg-blue-50 dark:bg-blue-900/10'
        }`}>
          <div className="flex items-center gap-2 text-sm">
            {proposal.status === 'APPROVED' && <CheckCircle className="w-4 h-4 text-green-600" />}
            {proposal.status === 'DECLINED' && <XCircle className="w-4 h-4 text-red-600" />}
            {proposal.status === 'SENT' && <Send className="w-4 h-4 text-blue-600" />}
            {proposal.status === 'VIEWED' && <FileText className="w-4 h-4 text-amber-600" />}
            <span className="font-medium">
              {proposal.status === 'APPROVED' && `Approved on ${new Date(proposal.approvedAt).toLocaleDateString('en-CA')}`}
              {proposal.status === 'DECLINED' && `Declined on ${new Date(proposal.declinedAt).toLocaleDateString('en-CA')}`}
              {proposal.status === 'SENT' && `Sent on ${new Date(proposal.sentAt).toLocaleDateString('en-CA')}`}
              {proposal.status === 'VIEWED' && 'Viewed by client'}
            </span>
          </div>
          {(proposal.status === 'SENT' || proposal.status === 'VIEWED') && proposal.viewToken && (
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/portal/proposal/${proposal.viewToken}`)}
              className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="w-3 h-3" /> Copy client view link
            </button>
          )}
          {proposal.status === 'APPROVED' && !proposal.contract && (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => api.createContractFromProposal(proposal.id).then(() => {
                  queryClient.invalidateQueries({ queryKey: ['proposal', id] });
                })}
              >
                Generate Contract
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => api.createInvoiceFromProposal(proposal.id).then(() => {
                  navigate('/invoices');
                })}
              >
                Create Invoice
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setTab('details')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'details'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Details
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            tab === 'history'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <History className="w-3.5 h-3.5" /> History
        </button>
      </div>

      {/* Tab Content */}
      {tab === 'history' && (
        <HistoryTab
          proposalId={id}
          currentData={{
            title: proposal.title,
            notes: proposal.notes,
            discount: proposal.discount,
            subtotal: proposal.subtotal,
            total: proposal.total,
            status: proposal.status,
            lineItems: proposal.lineItems || [],
          }}
          isDraft={isDraft}
        />
      )}

      {tab === 'details' && (
        <>
          {/* Line Items */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Line Items</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-3 text-xs font-medium text-muted-foreground uppercase">
                <div className="col-span-5">Description</div>
                <div className="col-span-2 text-right">Qty</div>
                <div className="col-span-2 text-right">Unit Price</div>
                <div className="col-span-2 text-right">Total</div>
                {editing && <div className="col-span-1" />}
              </div>

              {(editing ? lineItems : proposal.lineItems || []).map((item, idx) => (
                <div key={item.id || idx} className="grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-5">
                    {editing ? (
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateLineItem(idx, 'description', e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
                        placeholder="Description"
                      />
                    ) : (
                      <span className="text-sm">{item.description}</span>
                    )}
                  </div>
                  <div className="col-span-2 text-right">
                    {editing ? (
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm text-right"
                        min="0"
                        step="0.5"
                      />
                    ) : (
                      <span className="text-sm">{item.quantity}</span>
                    )}
                  </div>
                  <div className="col-span-2 text-right">
                    {editing ? (
                      <input
                        type="number"
                        value={item.unitPrice}
                        onChange={(e) => updateLineItem(idx, 'unitPrice', e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm text-right"
                        min="0"
                        step="0.01"
                      />
                    ) : (
                      <span className="text-sm">${item.unitPrice?.toFixed(2)}</span>
                    )}
                  </div>
                  <div className="col-span-2 text-right text-sm font-medium">
                    ${((parseFloat(item.quantity) || 1) * (parseFloat(item.unitPrice) || 0)).toFixed(2)}
                  </div>
                  {editing && (
                    <div className="col-span-1">
                      <button onClick={() => removeLineItem(idx)} className="p-1 text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {editing && (
                <button
                  onClick={addLineItem}
                  className="flex items-center gap-1 text-sm text-primary hover:underline mt-2"
                >
                  <Plus className="w-4 h-4" /> Add line item
                </button>
              )}
            </div>

            {/* Totals */}
            <div className="mt-6 border-t border-border pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                {editing ? (
                  <input
                    type="number"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    className="w-24 px-2 py-1 rounded border border-border bg-background text-sm text-right"
                    min="0"
                    step="0.01"
                  />
                ) : (
                  <span>-${(proposal.discount || 0).toFixed(2)}</span>
                )}
              </div>
              <div className="flex justify-between text-base font-semibold border-t border-border pt-2">
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </div>
          </Card>

          {/* Notes */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-2">Notes</h2>
            {editing ? (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                rows={3}
                placeholder="Notes visible to client..."
              />
            ) : (
              <p className="text-sm text-muted-foreground">{proposal.notes || 'No notes'}</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
