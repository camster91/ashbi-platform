import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { X, RotateCcw, Trash2, Search, AlertTriangle } from 'lucide-react';
import QueryErrorState from '../components/QueryErrorState';

export default function Trash() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [operationError, setOperationError] = useState('');
  const [pendingAction, setPendingAction] = useState(null);

  const loadTrash = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.request('/trash');
      setItems(res.items || []);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTrash(); }, []);

  const handleRestore = async (id, type) => {
    const action = `restore:${id}`;
    if (pendingAction) return;
    setPendingAction(action);
    setOperationError('');
    try {
      await api.request(`/trash/${id}/restore`, { method: 'POST' });
      setItems(items.filter(i => i.id !== id));
      setConfirmRestore(null);
    } catch (err) {
      setOperationError(err?.message || 'This item could not be restored. Please try again.');
    } finally {
      setPendingAction(null);
    }
  };

  const handlePermanentDelete = async (id, type) => {
    const action = `delete:${id}`;
    if (pendingAction) return;
    setPendingAction(action);
    setOperationError('');
    try {
      await api.request(`/trash/${id}/permanent`, { method: 'DELETE' });
      setItems(items.filter(i => i.id !== id));
      setConfirmDelete(null);
    } catch (err) {
      setOperationError(err?.message || 'This item could not be permanently deleted. Please try again.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleEmptyTrash = async () => {
    if (pendingAction) return;
    setPendingAction('empty');
    setOperationError('');
    try {
      await api.request('/trash/empty', { method: 'DELETE' });
      setItems([]);
      setShowEmptyConfirm(false);
    } catch (err) {
      setOperationError(err?.message || 'Trash could not be emptied. Please try again.');
    } finally {
      setPendingAction(null);
    }
  };

  // Format relative time
  const timeAgo = (date) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const filtered = items
    .filter(i => typeFilter === 'ALL' || i.type === typeFilter.toLowerCase())
    .filter(i => !search || i.title.toLowerCase().includes(search.toLowerCase()) || i.clientName.toLowerCase().includes(search.toLowerCase()));

  const types = [...new Set(items.map(i => i.typeLabel))].sort();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Trash</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {items.length} item{items.length !== 1 ? 's' : ''} — items are automatically removed after 30 days
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={() => { setOperationError(''); setShowEmptyConfirm(true); }}
            className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4 inline mr-1" />
            Empty Trash
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search trash..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="ALL">All Types</option>
          {types.map(t => (
            <option key={t} value={t.toLowerCase()}>{t}</option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-muted-foreground">
          Loading trash...
        </div>
      )}

      {!loading && loadError && (
        <QueryErrorState
          error={loadError}
          onRetry={loadTrash}
          isRetrying={loading}
          message="Trash could not be loaded"
        />
      )}

      {/* Empty state */}
      {!loading && !loadError && filtered.length === 0 && (
        <div className="text-center py-16">
          <Trash2 className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-medium mb-1">Trash is empty</h3>
          <p className="text-sm text-muted-foreground">
            Deleted items will appear here. They're automatically removed after 30 days.
          </p>
        </div>
      )}

      {/* Items list */}
      {!loading && !loadError && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(item => (
            <div
              key={`${item.type}-${item.id}`}
              className="flex items-center gap-4 p-4 bg-card border border-border rounded-lg hover:shadow-sm transition-shadow"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {item.typeLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Deleted {timeAgo(item.deletedAt)}
                  </span>
                </div>
                <h3 className="font-medium truncate mt-1">{item.title}</h3>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{item.clientName}</span>
                  {item.status && <span>· {item.status}</span>}
                  {item.amount && <span>· ${item.amount.toLocaleString()}</span>}
                </div>
              </div>

              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => { setOperationError(''); setConfirmRestore(item); }}
                  className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                  title="Restore"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setOperationError(''); setConfirmDelete(item); }}
                  className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  title="Delete permanently"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Restore confirmation */}
      {confirmRestore && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-xl shadow-xl max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-2">Restore this item?</h3>
            <p className="text-sm text-muted-foreground mb-1">
              <strong>{confirmRestore.typeLabel}</strong>: {confirmRestore.title}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              It will reappear in your lists immediately.
            </p>
            {operationError && <p role="alert" className="mb-4 text-sm text-red-600">{operationError}</p>}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setOperationError(''); setConfirmRestore(null); }}
                disabled={Boolean(pendingAction)}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRestore(confirmRestore.id, confirmRestore.type)}
                disabled={pendingAction === `restore:${confirmRestore.id}`}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pendingAction === `restore:${confirmRestore.id}` ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-xl shadow-xl max-w-sm mx-4">
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-semibold">Permanently delete?</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  <strong>{confirmDelete.typeLabel}</strong>: {confirmDelete.title}
                </p>
                <p className="text-sm text-red-600 mt-2">
                  This cannot be undone. The item will be permanently removed.
                </p>
              </div>
            </div>
            {operationError && <p role="alert" className="mb-4 text-sm text-red-600">{operationError}</p>}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setOperationError(''); setConfirmDelete(null); }}
                disabled={Boolean(pendingAction)}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handlePermanentDelete(confirmDelete.id, confirmDelete.type)}
                disabled={pendingAction === `delete:${confirmDelete.id}`}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pendingAction === `delete:${confirmDelete.id}` ? 'Deleting…' : 'Delete Forever'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty trash confirmation */}
      {showEmptyConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-xl shadow-xl max-w-sm mx-4">
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-semibold">Empty the entire trash?</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  All {items.length} items will be permanently deleted. This cannot be undone.
                </p>
              </div>
            </div>
            {operationError && <p role="alert" className="mb-4 text-sm text-red-600">{operationError}</p>}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setOperationError(''); setShowEmptyConfirm(false); }}
                disabled={Boolean(pendingAction)}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEmptyTrash}
                disabled={pendingAction === 'empty'}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pendingAction === 'empty' ? 'Emptying…' : 'Empty Trash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
