import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, Filter, Eye, ChevronRight, Mail, FileText, Send, DollarSign, Megaphone, Code } from 'lucide-react';
import DOMPurify from 'dompurify';
import { api } from '../lib/api';

const TYPE_ICONS = {
  EMAIL: Mail,
  PROPOSAL: FileText,
  CONTRACT: FileText,
  DEPLOY: Code,
  POST: Megaphone,
  INVOICE: DollarSign,
  COPY: FileText,
  OTHER: FileText,
};

const TYPE_COLORS = {
  EMAIL: 'bg-blue-100 text-blue-700',
  PROPOSAL: 'bg-purple-100 text-purple-700',
  CONTRACT: 'bg-orange-100 text-orange-700',
  DEPLOY: 'bg-red-100 text-red-700',
  POST: 'bg-green-100 text-green-700',
  INVOICE: 'bg-yellow-100 text-yellow-700',
  COPY: 'bg-pink-100 text-pink-700',
  OTHER: 'bg-gray-100 text-gray-700',
};

const STATUS_COLORS = {
  PENDING: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  APPROVED: 'text-green-600 bg-green-50 border-green-200',
  REJECTED: 'text-red-600 bg-red-50 border-red-200',
  EXPIRED: 'text-gray-500 bg-gray-50 border-gray-200',
};

function parseContent(raw) {
  try { return JSON.parse(raw); } catch { return raw; }
}

function ContentPreview({ content, type }) {
  const parsed = parseContent(content);
  if (type === 'EMAIL' && typeof parsed === 'object') {
    return (
      <div className="space-y-2 text-sm">
        {parsed.to && <p><span className="font-medium text-gray-500">To:</span> {parsed.to}</p>}
        {parsed.subject && <p><span className="font-medium text-gray-500">Subject:</span> {parsed.subject}</p>}
        {parsed.body && (
          <div className="mt-3 p-3 bg-gray-50 rounded border border-gray-200 max-h-64 overflow-y-auto prose prose-sm">
            <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(parsed.body) }} />
          </div>
        )}
      </div>
    );
  }
  if (typeof parsed === 'string') {
    return (
      <div className="p-3 bg-gray-50 rounded border border-gray-200 max-h-64 overflow-y-auto prose prose-sm text-sm">
        <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(parsed) }} />
      </div>
    );
  }
  return (
    <pre className="p-3 bg-gray-50 rounded border border-gray-200 max-h-64 overflow-y-auto text-xs text-gray-700 whitespace-pre-wrap">
      {JSON.stringify(parsed, null, 2)}
    </pre>
  );
}

export default function ApprovalQueue() {
  const [approvals, setApprovals] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
    try {
      const filters = {};
      if (filterStatus) filters.status = filterStatus;
      if (filterType) filters.type = filterType;
      const data = await api.getApprovals(filters);
      setApprovals(data.approvals || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id) => {
    setActionLoading(true);
    try {
      await api.updateApproval(id, { status: 'APPROVED' });
      await fetchApprovals();
      setSelectedId(null);
    } catch (err) { setError(err.message); }
    setActionLoading(false);
  };

  const handleReject = async (id) => {
    setActionLoading(true);
    try {
      await api.updateApproval(id, { status: 'REJECTED', reviewNote: rejectNote });
      await fetchApprovals();
      setSelectedId(null);
      setRejectNote('');
      setShowRejectModal(false);
    } catch (err) { setError(err.message); }
    setActionLoading(false);
  };

  const selected = approvals.find(a => a.id === selectedId);
  const pending = approvals.filter(a => a.status === 'PENDING');

  return (
    <div className="flex h-full bg-[#f8f4ef]">
      {/* List panel */}
      <div className="w-96 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-[#1a2744]">Approvals</h1>
            {filterStatus === 'PENDING' && pending.length > 0 && (
              <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
                {pending.length}
              </span>
            )}
          </div>
          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value); setSelectedId(null); }}
              className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#c9a84c]"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <select
              value={filterType}
              onChange={e => { setFilterType(e.target.value); setSelectedId(null); }}
              className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#c9a84c]"
            >
              <option value="">All types</option>
              {['EMAIL','POST','PROPOSAL','CONTRACT','INVOICE','DEPLOY','COPY','OTHER'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Approval list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
          ) : approvals.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <CheckCircle className="mx-auto mb-2 opacity-30" size={32} />
              <p className="text-sm">No approvals{filterStatus ? ` (${filterStatus.toLowerCase()})` : ''}</p>
            </div>
          ) : (
            approvals.map(a => {
              const Icon = TYPE_ICONS[a.type] || FileText;
              const isSelected = selectedId === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(isSelected ? null : a.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50 border-l-2 border-l-[#c9a84c]' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[a.type] || TYPE_COLORS.OTHER}`}>
                        {a.type}
                      </span>
                      {a.status === 'PENDING' && (
                        <span className="flex-shrink-0 w-2 h-2 bg-yellow-400 rounded-full" />
                      )}
                    </div>
                    <ChevronRight size={14} className="flex-shrink-0 text-gray-400 mt-0.5" />
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-[#1a2744] truncate">{a.title}</p>
                  {a.clientName && (
                    <p className="text-xs text-gray-500 truncate">{a.clientName}</p>
                  )}
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-gray-400">{a.createdBy}</span>
                    <span className="text-xs text-gray-400">
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
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <Eye size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select an approval to review</p>
            </div>
          </div>
        ) : (
          <div className="p-6 max-w-3xl">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-600 text-sm">{error}</div>
            )}
            {/* Header */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${TYPE_COLORS[selected.type] || TYPE_COLORS.OTHER}`}>
                      {selected.type}
                    </span>
                    <span className={`px-2 py-0.5 rounded border text-xs font-semibold ${STATUS_COLORS[selected.status]}`}>
                      {selected.status}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-[#1a2744]">{selected.title}</h2>
                  {selected.clientName && (
                    <p className="text-sm text-gray-600 mt-0.5">Client: {selected.clientName}</p>
                  )}
                </div>
                <div className="text-right text-xs text-gray-400 flex-shrink-0">
                  <p>Created by <strong>{selected.createdBy}</strong></p>
                  <p>{new Date(selected.createdAt).toLocaleString()}</p>
                </div>
              </div>
              {selected.reviewNote && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
                  <strong>Note:</strong> {selected.reviewNote}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Content</h3>
              <ContentPreview content={selected.content} type={selected.type} />
            </div>

            {/* Metadata */}
            {selected.metadata && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Metadata</h3>
                <pre className="text-xs text-gray-600 whitespace-pre-wrap">
                  {JSON.stringify(parseContent(selected.metadata), null, 2)}
                </pre>
              </div>
            )}

            {/* Actions — only show for PENDING */}
            {selected.status === 'PENDING' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Decision</h3>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleApprove(selected.id)}
                    disabled={actionLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 font-semibold"
                  >
                    <CheckCircle size={18} /> Approve
                  </button>
                  <button
                    onClick={() => setShowRejectModal(true)}
                    disabled={actionLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 font-semibold"
                  >
                    <XCircle size={18} /> Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reject modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-[#1a2744] mb-4">Reject & Return</h3>
            <textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              placeholder="Optional: feedback for the agent (e.g. 'Make tone warmer' or 'Wrong client name')"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#c9a84c] outline-none mb-4 h-24 resize-none"
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowRejectModal(false); setRejectNote(''); }}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium">
                Cancel
              </button>
              <button onClick={() => selected && handleReject(selected.id)} disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 text-sm font-semibold">
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
