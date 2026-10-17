import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { X, RotateCcw, Trash2, Search, AlertTriangle } from 'lucide-react';
import QueryErrorState from '../components/QueryErrorState';
import Modal, { ModalFooter } from '../components/Modal';
import { Button } from '../components/ui';

const RETENTION_MESSAGE = 'Items with resource links, including archived links, stay in Trash and can be restored.';
const ENTITY_LABELS = { CLIENT: 'Client', PROJECT: 'Project', INVOICE: 'Invoice', PROPOSAL: 'Proposal', CONTRACT: 'Contract', EXPENSE: 'Expense', TASK: 'Task', ESTIMATE: 'Estimate', NOTE: 'Note', RETAINER_PLAN: 'Retainer plan' };
const displayText = value => typeof value === 'string' ? value : '';

function displayTrashItem(item) {
  const data = item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data : {};
  const typeLabel = ENTITY_LABELS[item.entity] || 'Item';
  return {
    id: item.id,
    type: displayText(item.entity).toLowerCase(),
    typeLabel,
    title: displayText(data.title) || displayText(data.name) || typeLabel,
    clientName: '',
    deletedAt: item.deletedAt,
  };
}

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
      if (!Array.isArray(res?.items) || !res.items.every(item => item && typeof item.id === 'string' && typeof item.entity === 'string')) {
        throw new Error('Invalid trash response');
      }
      setItems(res.items.map(displayTrashItem));
      return res.items;
    } catch (err) {
      setLoadError(err);
      return null;
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
      setOperationError(err?.data?.code === 'RESOURCE_LINK_RETENTION'
        ? RETENTION_MESSAGE
        : 'This item could not be permanently deleted. Please refresh Trash before trying again.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleEmptyTrash = async () => {
    if (pendingAction) return;
    setPendingAction('empty');
    setOperationError('');
    try {
      const result = await api.request('/trash/empty', { method: 'DELETE' });
      const refreshed = await loadTrash();
      const knownResult = typeof result?.success === 'boolean'
        && Number.isInteger(result.deleted) && result.deleted >= 0
        && Number.isInteger(result.failed) && result.failed >= 0
        && Array.isArray(result.failures) && result.failures.length === result.failed
        && result.success === (result.failed === 0);
      if (refreshed === null) {
        setOperationError('The deletion request finished, but Trash could not be refreshed. Retry loading Trash to check what remains.');
      } else if (!knownResult) {
        setOperationError('The deletion result could not be confirmed. Trash has been refreshed; check the remaining items before trying again.');
      } else if (result.failed > 0) {
        const retained = result.failures.some(failure => failure?.code === 'RESOURCE_LINK_RETENTION');
        setOperationError(`${result.deleted} deleted; ${result.failed} could not be deleted.${retained ? ` ${RETENTION_MESSAGE}` : ' Remaining items can be restored or reviewed before retrying.'}`);
      } else if (refreshed.length > 0) {
        setOperationError(`${result.deleted} deleted. Trash has additional items; review them before trying again.`);
      } else {
        setShowEmptyConfirm(false);
      }
    } catch {
      setOperationError('The deletion result could not be confirmed. Reload Trash before trying again.');
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

  const types = [...new Map(items.map(item => [item.type, item.typeLabel])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Trash</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {items.length} item{items.length !== 1 ? 's' : ''} — eligible items are automatically removed after 30 days. Items with resource links are retained for recovery.
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={() => { setOperationError(''); setShowEmptyConfirm(true); }}
            className="px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/5 rounded-lg transition-colors"
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
            className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select aria-label="Filter by type"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/30"
        >
          <option value="ALL">All Types</option>
          {types.map(([type, label]) => (
            <option key={type} value={type}>{label}</option>
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
          <h3 className="text-lg font-medium mb-1">{items.length ? 'No matching items' : 'Trash is empty'}</h3>
          <p className="text-sm text-muted-foreground">
            Deleted items appear here. Eligible items are removed after 30 days; items with resource links, including archived links, remain recoverable.
          </p>
        </div>
      )}

      {/* Items list */}
      {!loading && !loadError && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(item => (
            <div
              key={`${item.type}-${item.id}`}
              className="flex items-center gap-4 p-4 bg-card border border-border rounded-lg hover:shadow-xs transition-shadow"
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
                  type="button"
                  aria-label={`Restore ${item.typeLabel}: ${item.title}`}
                  onClick={() => { setOperationError(''); setConfirmRestore(item); }}
                  className="min-h-11 min-w-11 p-2 text-success hover:bg-success/5 rounded-lg transition-colors"
                  title="Restore"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Permanently delete ${item.typeLabel}: ${item.title}`}
                  onClick={() => { setOperationError(''); setConfirmDelete(item); }}
                  className="min-h-11 min-w-11 p-2 text-destructive hover:bg-destructive/5 rounded-lg transition-colors"
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
      <Modal
        isOpen={Boolean(confirmRestore)}
        onClose={() => {
          if (pendingAction) return;
          setOperationError('');
          setConfirmRestore(null);
        }}
        title="Restore this item?"
        size="sm"
        showCloseButton={!pendingAction}
      >
        {confirmRestore && (
          <>
            <p className="text-sm text-muted-foreground mb-1">
              <strong>{confirmRestore.typeLabel}</strong>: {confirmRestore.title}
            </p>
            <p className="text-sm text-muted-foreground">It will reappear in your lists immediately.</p>
            {operationError && <p role="alert" className="mt-4 text-sm text-destructive">{operationError}</p>}
            <ModalFooter className="flex-col-reverse sm:flex-row">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => { setOperationError(''); setConfirmRestore(null); }} disabled={Boolean(pendingAction)}>Cancel</Button>
              <Button className="w-full sm:w-auto" onClick={() => handleRestore(confirmRestore.id, confirmRestore.type)} loading={pendingAction === `restore:${confirmRestore.id}`}>Restore</Button>
            </ModalFooter>
          </>
        )}
      </Modal>

      {/* Permanent delete confirmation */}
      <Modal
        isOpen={Boolean(confirmDelete)}
        onClose={() => {
          if (pendingAction) return;
          setOperationError('');
          setConfirmDelete(null);
        }}
        title="Permanently delete?"
        size="sm"
        showCloseButton={!pendingAction}
      >
        {confirmDelete && (
          <>
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground mt-1">
                  <strong>{confirmDelete.typeLabel}</strong>: {confirmDelete.title}
                </p>
                <p className="text-sm text-destructive mt-2">
                  Eligible items are permanently removed and cannot be recovered. Items with resource links, including archived links, are retained and can be restored.
                </p>
              </div>
            </div>
            {operationError && <p role="alert" className="mb-4 text-sm text-destructive">{operationError}</p>}
            <ModalFooter className="flex-col-reverse sm:flex-row">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => { setOperationError(''); setConfirmDelete(null); }} disabled={Boolean(pendingAction)}>Cancel</Button>
              <Button variant="destructive" className="w-full sm:w-auto" onClick={() => handlePermanentDelete(confirmDelete.id, confirmDelete.type)} loading={pendingAction === `delete:${confirmDelete.id}`}>Delete forever</Button>
            </ModalFooter>
          </>
        )}
      </Modal>

      {/* Empty trash confirmation */}
      <Modal
        isOpen={showEmptyConfirm}
        onClose={() => {
          if (pendingAction) return;
          setOperationError('');
          setShowEmptyConfirm(false);
        }}
        title="Empty the entire trash?"
        size="sm"
        showCloseButton={!pendingAction}
      >
        <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground mt-1">
                  Attempt to permanently delete eligible items in Trash. Deleted items cannot be recovered. Items with resource links, including archived links, are retained and can be restored.
                </p>
              </div>
            </div>
            {operationError && <p role="alert" className="mb-4 text-sm text-destructive">{operationError}</p>}
            {operationError && <Button variant="outline" onClick={loadTrash} disabled={Boolean(pendingAction) || loading}>Refresh Trash</Button>}
        <ModalFooter className="flex-col-reverse sm:flex-row">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => { setOperationError(''); setShowEmptyConfirm(false); }} disabled={Boolean(pendingAction)}>Cancel</Button>
          <Button variant="destructive" className="w-full sm:w-auto" onClick={handleEmptyTrash} loading={pendingAction === 'empty'}>Empty trash</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
