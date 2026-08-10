import { useState, useEffect, useRef } from 'react';
import { CheckCircle, XCircle, Eye, ChevronRight, Mail, FileText, DollarSign, Megaphone, Code } from 'lucide-react';
import { safeHtml } from '../lib/safeHtml';
import { api } from '../lib/api';
import QueryErrorState from '../components/QueryErrorState';
import Modal, { ModalFooter } from '../components/Modal';
import { Button, LoadingState } from '../components/ui';

const TYPE_ICONS = {
  EMAIL: Mail, PROPOSAL: FileText, CONTRACT: FileText,
  DEPLOY: Code, POST: Megaphone, INVOICE: DollarSign, COPY: FileText, OTHER: FileText,
};

const TYPE_COLORS = {
  EMAIL: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  PROPOSAL: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  CONTRACT: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  DEPLOY: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  POST: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  INVOICE: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  COPY: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  OTHER: 'bg-muted text-muted-foreground',
};

const STATUS_COLORS = {
  PENDING: 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800',
  APPROVED: 'text-green-600 bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
  REJECTED: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800',
  EXPIRED: 'text-muted-foreground bg-muted border-border',
};

function parseContent(raw) {
  try { return JSON.parse(raw); } catch { return raw; }
}

function ContentPreview({ content, type }) {
  const parsed = parseContent(content);
  if (type === 'EMAIL' && typeof parsed === 'object') {
    return (
      <div className="space-y-2 text-sm">
        {parsed.to && <p><span className="font-medium text-muted-foreground">To:</span> <span className="text-foreground">{parsed.to}</span></p>}
        {parsed.subject && <p><span className="font-medium text-muted-foreground">Subject:</span> <span className="text-foreground">{parsed.subject}</span></p>}
        {parsed.body && (
          <div className="mt-3 p-3 bg-muted rounded border border-border max-h-64 overflow-y-auto prose prose-sm dark:prose-invert text-sm">
            <div dangerouslySetInnerHTML={{ __html: safeHtml(parsed.body) }} />
          </div>
        )}
      </div>
    );
  }
  if (typeof parsed === 'string') {
    return (
      <div className="p-3 bg-muted rounded border border-border max-h-64 overflow-y-auto prose prose-sm dark:prose-invert text-sm">
        <div dangerouslySetInnerHTML={{ __html: safeHtml(parsed) }} />
      </div>
    );
  }
  return (
    <pre className="p-3 bg-muted rounded border border-border max-h-64 overflow-y-auto text-xs text-foreground whitespace-pre-wrap">
      {JSON.stringify(parsed, null, 2)}
    </pre>
  );
}

export default function ApprovalQueue() {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState('');
  const fetchingRef = useRef(false);
  const [selectedId, setSelectedId] = useState(null);
  const [filterStatus, setFilterStatus] = useState('PENDING');
  const [filterType, setFilterType] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 10000);
    return () => clearInterval(interval);
  }, [filterStatus, filterType]);

  const fetchApprovals = async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setIsFetching(true);
    setLoadError('');
    try {
      const filters = {};
      if (filterStatus) filters.status = filterStatus;
      if (filterType) filters.type = filterType;
      const data = await api.getApprovals(filters);
      setApprovals(data.approvals || []);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
      setIsFetching(false);
      fetchingRef.current = false;
    }
  };

  const handleApprove = async (id) => {
    setActionLoading(true);
    setActionError('');
    try {
      await api.updateApproval(id, { status: 'APPROVED' });
      await fetchApprovals();
      setSelectedId(null);
    } catch (err) { setActionError(err.message); }
    setActionLoading(false);
  };

  const handleReject = async (id) => {
    setActionLoading(true);
    setActionError('');
    try {
      await api.updateApproval(id, { status: 'REJECTED', reviewNote: rejectNote });
      await fetchApprovals();
      setSelectedId(null);
      setRejectNote('');
      setShowRejectModal(false);
    } catch (err) { setActionError(err.message); }
    setActionLoading(false);
  };

  const selected = approvals.find(a => a.id === selectedId);
  const pendingCount = approvals.filter(a => a.status === 'PENDING').length;

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-8rem)] lg:h-[calc(100vh-8rem)] -mx-4 sm:-mx-6">
      {/* List panel */}
      <div className="w-full lg:w-80 flex-shrink-0 border-b lg:border-b-0 lg:border-r border-border bg-card flex flex-col max-h-[50vh] lg:max-h-none">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-foreground">Approvals</h1>
            {filterStatus === 'PENDING' && pendingCount > 0 && (
              <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">{pendingCount}</span>
            )}
          </div>
          <div className="flex gap-2">
            <select
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value); setSelectedId(null); }}
              className="flex-1 px-2 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <select
              value={filterType}
              onChange={e => { setFilterType(e.target.value); setSelectedId(null); }}
              className="flex-1 px-2 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All types</option>
              {['EMAIL','POST','PROPOSAL','CONTRACT','INVOICE','DEPLOY','COPY','OTHER'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <LoadingState label="Loading approvals…" compact className="p-8" />
          ) : loadError ? (
            <QueryErrorState
              error={loadError}
              message="Failed to load approvals"
              onRetry={fetchApprovals}
              isRetrying={isFetching}
            />
          ) : !loadError && approvals.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <CheckCircle className="mx-auto mb-2 opacity-30" size={32} />
              <p className="text-sm">No approvals{filterStatus ? ` (${filterStatus.toLowerCase()})` : ''}</p>
            </div>
          ) : (
            approvals.map(a => {
              const isSelected = selectedId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedId(isSelected ? null : a.id)}
                  aria-label={`${isSelected ? 'Collapse' : 'Open'} approval ${a.title}`}
                  aria-expanded={isSelected}
                  className={`w-full min-h-11 text-left px-4 py-3 border-b border-border hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[a.type] || TYPE_COLORS.OTHER}`}>
                        {a.type}
                      </span>
                      {a.status === 'PENDING' && <span className="flex-shrink-0 w-2 h-2 bg-yellow-400 rounded-full" />}
                    </div>
                    <ChevronRight size={14} className="flex-shrink-0 text-muted-foreground mt-0.5" />
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-foreground truncate">{a.title}</p>
                  {a.clientName && <p className="text-xs text-muted-foreground truncate">{a.clientName}</p>}
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-muted-foreground">{a.createdBy}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto bg-background">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Eye size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select an approval to review</p>
            </div>
          </div>
        ) : (
          <div className="p-6 max-w-3xl space-y-4">
            {actionError && (
              <div role="alert" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 text-sm">{actionError}</div>
            )}

            {/* Header */}
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${TYPE_COLORS[selected.type] || TYPE_COLORS.OTHER}`}>
                      {selected.type}
                    </span>
                    <span className={`px-2 py-0.5 rounded border text-xs font-semibold ${STATUS_COLORS[selected.status] || STATUS_COLORS.EXPIRED}`}>
                      {selected.status}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-foreground">{selected.title}</h2>
                  {selected.clientName && <p className="text-sm text-muted-foreground mt-0.5">Client: {selected.clientName}</p>}
                </div>
                <div className="text-right text-xs text-muted-foreground flex-shrink-0">
                  <p>Created by <strong className="text-foreground">{selected.createdBy}</strong></p>
                  <p>{new Date(selected.createdAt).toLocaleString()}</p>
                </div>
              </div>
              {selected.reviewNote && (
                <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-sm text-amber-800 dark:text-amber-300">
                  <strong>Note:</strong> {selected.reviewNote}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Content</h3>
              <ContentPreview content={selected.content} type={selected.type} />
            </div>

            {/* Metadata */}
            {selected.metadata && (
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Metadata</h3>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {JSON.stringify(parseContent(selected.metadata), null, 2)}
                </pre>
              </div>
            )}

            {/* Actions */}
            {selected.status === 'PENDING' && (
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Decision</h3>
                <div className="flex gap-3">
                  <Button
                    className="flex-1"
                    onClick={() => handleApprove(selected.id)}
                    loading={actionLoading}
                    leftIcon={<CheckCircle className="w-4 h-4" />}
                  >
                    Approve
                  </Button>
                  <Button
                    className="flex-1"
                    variant="destructive"
                    onClick={() => setShowRejectModal(true)}
                    disabled={actionLoading}
                    leftIcon={<XCircle className="w-4 h-4" />}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reject modal */}
      <Modal
        isOpen={showRejectModal}
        onClose={() => {
          if (actionLoading) return;
          setShowRejectModal(false);
          setRejectNote('');
        }}
        title="Reject and return"
        size="sm"
        showCloseButton={!actionLoading}
      >
        <label htmlFor="approval-reject-note" className="block text-sm font-medium text-foreground mb-2">
          Feedback for the requester <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="approval-reject-note"
          value={rejectNote}
          onChange={e => setRejectNote(e.target.value)}
          placeholder="For example: Make the tone warmer"
          disabled={actionLoading}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:ring-2 focus:ring-primary outline-none h-24 resize-none disabled:opacity-50"
        />
        <ModalFooter className="flex-col-reverse sm:flex-row">
          <Button variant="outline" className="w-full sm:w-auto" disabled={actionLoading} onClick={() => { setShowRejectModal(false); setRejectNote(''); }}>
            Cancel
          </Button>
          <Button variant="destructive" className="w-full sm:w-auto" onClick={() => selected && handleReject(selected.id)} loading={actionLoading}>
            Reject approval
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
