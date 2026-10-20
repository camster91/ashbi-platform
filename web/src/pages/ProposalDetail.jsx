import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Save, Pencil, Copy, Link2, FileSignature, Receipt, BellRing, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { Button, LoadingState, StatusBadge } from '../components/ui';
import useAutosave from '../hooks/useAutosave';
import DraftRecoveryNotice from '../components/DraftRecoveryNotice';
import QueryErrorState from '../components/QueryErrorState';
import ProposalClientPreview from '../components/proposals/ProposalClientPreview';
import ProposalEditor from '../components/proposals/ProposalEditor';
import ProposalTimeline from '../components/proposals/ProposalTimeline';
import OtherProposals from '../components/proposals/OtherProposals';
import { formatDate } from '../lib/format';
import { taxTypeLabel } from '../lib/invoice-status';
import { invoiceTotals, lineTotal } from '../lib/money-totals';

// Ashbi Hub proposal page (design: Proposals mockup). On the left, what the
// client sees on the public proposal page (or the edit form for a draft); on
// the right, the proposal's status from draft to invoice and the other
// proposals.

// "Booking site for Lakeside Yoga": the client's name is the serif accent,
// inside the title when the title already names the client.
export function ProposalTitle({ title, clientName }) {
  const name = (clientName || '').trim();
  const accent = (text) => <span className="font-display italic font-normal text-primary">{text}</span>;
  if (!name) return title;
  const at = title.toLowerCase().indexOf(name.toLowerCase());
  if (at === -1) return <>{title} {accent(`for ${name}`)}</>;
  return <>{title.slice(0, at)}{accent(title.slice(at, at + name.length))}{title.slice(at + name.length)}</>;
}

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

  const invalidateProposal = () => {
    queryClient.invalidateQueries({ queryKey: ['proposal', id] });
    queryClient.invalidateQueries({ queryKey: ['proposals'] });
  };

  const updateMutation = useMutation({
    mutationFn: (data) => api.updateProposal(id, data),
    onSuccess: () => {
      void formDraft.clearDraft();
      invalidateProposal();
      setEditing(false);
      toast.success('Proposal saved');
    },
    onError: () => toast.error('Failed to save proposal'),
  });

  const sendMutation = useMutation({
    mutationFn: () => api.sendProposal(id),
    onSuccess: (result) => {
      // The list shows the status (DRAFT -> SENT).
      invalidateProposal();
      if (result?.emailSent === false) {
        toast.success('Proposal marked as sent', 'No email went out. Copy the client link to share it.');
      } else {
        toast.success('Proposal sent', 'Client will receive a review link');
      }
    },
    onError: (error) => toast.error('Failed to send proposal', error.message),
  });

  const resendMutation = useMutation({
    mutationFn: () => api.resendProposal(id),
    onSuccess: () => {
      invalidateProposal();
      toast.success('Reminder sent', 'The client was emailed the review link again');
    },
    onError: (error) => {
      // A failed delivery is recorded on the proposal; show it in Status.
      invalidateProposal();
      toast.error('Failed to send reminder', error.message);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: () => api.duplicateProposal(id),
    onSuccess: (copy) => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      toast.success('Proposal duplicated');
      if (copy?.id) navigate(`/proposal/${copy.id}`);
    },
    onError: (error) => toast.error('Failed to duplicate proposal', error.message),
  });

  const generateContractMutation = useMutation({
    mutationFn: () => api.createContractFromProposal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposal', id] });
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      toast.success('Contract generated');
    },
    onError: (error) => toast.error('Failed to generate contract', error.message),
  });

  const createInvoiceMutation = useMutation({
    mutationFn: () => api.createInvoiceFromProposal(id),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice created');
      // Land on the new invoice (the API returns it, or the one already made
      // from this proposal); the list only if no id came back.
      navigate(invoice?.id ? `/invoices/${invoice.id}` : '/invoices');
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
    ? lineItems.reduce((sum, li) => sum + lineTotal(parseFloat(li.quantity) || 1, li.unitPrice), 0)
    : proposal.subtotal;
  // Mirrors the server: a discount never takes the total below zero.
  const total = Math.max(0, subtotal - (editing ? parseFloat(discount) || 0 : proposal.discount));
  // The invoice made from this proposal adds tax at the proposal's rate (the
  // API's taxRate); show it so staff see what the client approves and is
  // billed. Saved figures come from the server (tax / totalWithTax); only an
  // unsaved edit is previewed here, with the same arithmetic.
  const taxRate = Number(proposal.taxRate) || 0;
  const preview = invoiceTotals([{ total }], taxRate);
  const useServer = !editing && proposal.totalWithTax !== undefined && proposal.totalWithTax !== null;
  const tax = useServer ? Number(proposal.tax) || 0 : preview.tax;
  const totalWithTax = useServer ? Number(proposal.totalWithTax) || 0 : preview.total;
  const taxLabel = `${taxTypeLabel(proposal.taxType)} (${taxRate}%)`;
  const isDraft = proposal.status === 'DRAFT';
  const awaitingReply = proposal.status === 'SENT' || proposal.status === 'VIEWED';
  const isApproved = proposal.status === 'APPROVED';
  const clientName = proposal.client?.name || '';
  // Approval revokes the public link, so it is offered only while the client
  // still has a decision to make.
  const clientLink = awaitingReply && proposal.viewToken
    ? `${window.location.origin}/portal/proposal/${proposal.viewToken}`
    : '';

  const copyClientLink = async () => {
    try {
      await navigator.clipboard.writeText(clientLink);
      toast.success('Client link copied');
    } catch {
      toast.error('Could not copy the link', clientLink);
    }
  };

  const doc = {
    title: proposal.title,
    clientName,
    notes: proposal.notes || '',
    status: proposal.status,
    validUntil: proposal.validUntil,
    approvedAt: proposal.approvedAt,
    declinedAt: proposal.declinedAt,
    lines: (proposal.lineItems || []).map((li, index) => ({
      key: li.id || index,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      total: Number.isFinite(Number(li.total)) ? Number(li.total) : lineTotal(li.quantity, li.unitPrice),
    })),
    subtotal: Number(proposal.subtotal) || 0,
    discount: Number(proposal.discount) || 0,
    tax: taxRate > 0 ? tax : 0,
    taxLabel,
    total: totalWithTax,
  };

  return (
    <div className="space-y-5 max-w-[1240px] mx-auto">
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

      <nav aria-label="Breadcrumb" className="text-eyebrow text-muted-foreground">
        <Link to="/proposals" className="rounded-sm hover:text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Proposals</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{clientName || proposal.title}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-3xl font-heading font-semibold tracking-tight text-foreground break-words">
              <ProposalTitle title={proposal.title} clientName={clientName} />
            </h1>
            <StatusBadge domain="proposal" status={proposal.status} size="md" className="font-semibold" />
            {proposal.deliveryFailed && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-0.5 text-sm font-semibold text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                Email not delivered
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {[
              proposal.createdBy?.name && `Created by ${proposal.createdBy.name}`,
              proposal.validUntil && `Valid until ${formatDate(proposal.validUntil)}`,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
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
          ) : (
            <>
              {isDraft && (
                <Button variant="outline" leftIcon={<Pencil className="w-4 h-4" />} onClick={startEdit}>Edit</Button>
              )}
              {clientLink && (
                <Button variant="outline" leftIcon={<Link2 className="w-4 h-4" />} onClick={copyClientLink}>Copy link</Button>
              )}
              <Button
                variant="outline"
                leftIcon={<Copy className="w-4 h-4" />}
                onClick={() => duplicateMutation.mutate()}
                loading={duplicateMutation.isPending}
              >
                Duplicate
              </Button>
              {/* Approval auto-generates the contract, so invoicing must not depend on
                  the contract being absent or accepted work could never be billed. */}
              {isApproved && !proposal.contract && (
                <Button
                  variant="outline"
                  leftIcon={<FileSignature className="w-4 h-4" />}
                  onClick={() => generateContractMutation.mutate()}
                  loading={generateContractMutation.isPending}
                >
                  Generate Contract
                </Button>
              )}
              {isApproved && (
                <Button
                  leftIcon={<Receipt className="w-4 h-4" />}
                  onClick={() => createInvoiceMutation.mutate()}
                  loading={createInvoiceMutation.isPending}
                >
                  Create Invoice
                </Button>
              )}
              {awaitingReply && (
                <Button
                  leftIcon={<BellRing className="w-4 h-4" />}
                  onClick={() => resendMutation.mutate()}
                  loading={resendMutation.isPending}
                >
                  Send reminder
                </Button>
              )}
              {isDraft && (
                <Button
                  leftIcon={<Send className="w-4 h-4" />}
                  onClick={() => sendMutation.mutate()}
                  loading={sendMutation.isPending}
                >
                  Send to Client
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] lg:items-start">
        <div className="min-w-0 space-y-5">
          {editing ? (
            <ProposalEditor
              title={title}
              onTitleChange={setTitle}
              lineItems={lineItems}
              onLineChange={updateLineItem}
              onAddLine={addLineItem}
              onRemoveLine={removeLineItem}
              discount={discount}
              onDiscountChange={setDiscount}
              notes={notes}
              onNotesChange={setNotes}
              totals={{ subtotal, taxRate, tax, taxLabel, total: totalWithTax }}
            />
          ) : (
            <ProposalClientPreview doc={doc} />
          )}
        </div>

        <aside aria-label="Proposal status and other proposals" className="min-w-0 space-y-4">
          <ProposalTimeline proposal={proposal} />
          <OtherProposals currentId={proposal.id} />
        </aside>
      </div>
    </div>
  );
}
