import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { Button, Card, LoadingState } from '../components/ui';
import useAutosave from '../hooks/useAutosave';
import DraftRecoveryNotice from '../components/DraftRecoveryNotice';
import QueryErrorState from '../components/QueryErrorState';

export default function ProposalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const {
    data: proposal,
    isLoading,
    isError: proposalError,
    error: proposalRequestError,
    refetch: refetchProposal,
    isFetching: proposalFetching,
  } = useQuery({
    queryKey: ['proposal', id],
    queryFn: () => api.getProposal(id),
  });

  const [editing, setEditing] = useState(false);
  const [lineItems, setLineItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [discount, setDiscount] = useState(0);
  const [invoiceReviewOpen, setInvoiceReviewOpen] = useState(false);
  const [invoiceTaxType, setInvoiceTaxType] = useState('');
  const [invoiceTaxRate, setInvoiceTaxRate] = useState('');
  const [invoiceTaxReviewed, setInvoiceTaxReviewed] = useState(false);
  const editDraftData = useMemo(() => editing ? { title, notes, discount, lineItems } : null, [editing, title, notes, discount, lineItems]);
  const formDraft = useAutosave('proposal', id, editDraftData, 500, { baseUpdatedAt: proposal?.updatedAt });

  useEffect(() => {
    if (!formDraft.draft) return;
    setTitle(formDraft.draft.title ?? '');
    setNotes(formDraft.draft.notes ?? '');
    setDiscount(formDraft.draft.discount ?? 0);
    setLineItems(formDraft.draft.lineItems ?? []);
    setEditing(true);
  }, [formDraft.draft]);

  const startEdit = () => {
    setLineItems(proposal.lineItems || []);
    setNotes(proposal.notes || '');
    setTitle(proposal.title);
    setDiscount(proposal.discount || 0);
    setEditing(true);
  };

  const updateMutation = useMutation({
    mutationFn: (data) => api.updateProposal(id, data),
    onSuccess: () => {
      void formDraft.clearDraft();
      queryClient.invalidateQueries({ queryKey: ['proposal', id] });
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

  const generateContractMutation = useMutation({
    mutationFn: () => api.createContractFromProposal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposal', id] });
      toast.success('Contract generated');
    },
    onError: (error) => toast.error('Failed to generate contract', error.message),
  });

  const createInvoiceMutation = useMutation({
    mutationFn: (taxDecision) => api.createInvoiceFromProposal(id, taxDecision),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setInvoiceReviewOpen(false);
      toast.success('Invoice draft created');
      navigate('/invoices');
    },
    onError: (error) => toast.error('Failed to create invoice', error.message),
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

  const parsedInvoiceTaxRate = invoiceTaxRate === '' ? Number.NaN : Number(invoiceTaxRate);
  const invoiceTaxDecisionValid = Boolean(invoiceTaxType)
    && Number.isFinite(parsedInvoiceTaxRate)
    && parsedInvoiceTaxRate >= 0
    && parsedInvoiceTaxRate <= 50
    && (invoiceTaxType !== 'NONE' || parsedInvoiceTaxRate === 0)
    && invoiceTaxReviewed;

  const handleCreateInvoiceDraft = () => {
    if (!invoiceTaxDecisionValid) return;
    createInvoiceMutation.mutate({
      taxType: invoiceTaxType,
      taxRate: parsedInvoiceTaxRate,
      taxReviewed: true,
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingState label="Loading proposal…" compact />
      </div>
    );
  }

  if (proposalError) {
    return (
      <QueryErrorState
        error={proposalRequestError}
        message="Proposal details could not be loaded"
        onRetry={refetchProposal}
        isRetrying={proposalFetching}
      />
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
      {(editing || formDraft.draft) && (
        <DraftRecoveryNotice
          draft={formDraft.draft}
          draftSavedAt={formDraft.draftMeta?.draftSavedAt}
          status={formDraft.status}
          lastSaved={formDraft.lastSaved}
          onRecover={(recovered) => {
            setTitle(recovered.title ?? '');
            setNotes(recovered.notes ?? '');
            setDiscount(recovered.discount ?? 0);
            setLineItems(recovered.lineItems ?? []);
            setEditing(true);
            formDraft.setDraft(null);
          }}
          onDiscard={formDraft.discardDraft}
          onRetry={formDraft.saveNow}
        />
      )}
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
          {proposal.status === 'APPROVED' && (
            <div className="mt-2 flex gap-2">
              {!proposal.contract && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => generateContractMutation.mutate()}
                  loading={generateContractMutation.isPending}
                >
                  Generate Contract
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setInvoiceReviewOpen(true)}
              >
                Review invoice draft
              </Button>
            </div>
          )}
        </Card>
      )}

      {invoiceReviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card
            className="w-full max-w-lg space-y-5 p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-review-title"
          >
            <div>
              <h2 id="invoice-review-title" className="text-xl font-semibold">Review invoice draft</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                This creates an internal draft only. It does not email the client, create a payment link, or charge anything.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="invoice-tax-type" className="text-sm font-medium">Tax type</label>
              <select
                id="invoice-tax-type"
                value={invoiceTaxType}
                onChange={(event) => setInvoiceTaxType(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose reviewed tax type</option>
                <option value="HST">HST</option>
                <option value="GST">GST</option>
                <option value="PST">PST</option>
                <option value="NONE">No tax</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="invoice-tax-rate" className="text-sm font-medium">Tax rate percent</label>
              <input
                id="invoice-tax-rate"
                type="number"
                min="0"
                max="50"
                step="0.01"
                value={invoiceTaxRate}
                onChange={(event) => setInvoiceTaxRate(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="Enter the reviewed rate"
              />
              {invoiceTaxType === 'NONE' && parsedInvoiceTaxRate !== 0 && invoiceTaxRate !== '' && (
                <p className="text-sm text-destructive">No tax requires a 0% rate.</p>
              )}
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={invoiceTaxReviewed}
                onChange={(event) => setInvoiceTaxReviewed(event.target.checked)}
                className="mt-1"
              />
              <span>I reviewed the tax treatment for this client and work</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setInvoiceReviewOpen(false)}>Cancel</Button>
              <Button
                onClick={handleCreateInvoiceDraft}
                disabled={!invoiceTaxDecisionValid}
                loading={createInvoiceMutation.isPending}
              >
                Create internal draft
              </Button>
            </div>
          </Card>
        </div>
      )}

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
                  <span className="text-sm">${item.unitPrice?.toFixed(2)} {proposal.currency || 'currency unassigned'}</span>
                )}
              </div>
              <div className="col-span-2 text-right text-sm font-medium">
                ${((parseFloat(item.quantity) || 1) * (parseFloat(item.unitPrice) || 0)).toFixed(2)} {proposal.currency || 'currency unassigned'}
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
            <span>${subtotal.toFixed(2)} {proposal.currency || 'currency unassigned'}</span>
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
              <span>-${(proposal.discount || 0).toFixed(2)} {proposal.currency || 'currency unassigned'}</span>
            )}
          </div>
          <div className="flex justify-between text-base font-semibold border-t border-border pt-2">
            <span>Total</span>
            <span>${total.toFixed(2)} {proposal.currency || 'currency unassigned'}</span>
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
    </div>
  );
}
