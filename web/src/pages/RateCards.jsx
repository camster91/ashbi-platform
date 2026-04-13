import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Star, DollarSign } from 'lucide-react';
import { api } from '../lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui';
import Button from '../components/ui/Button';
import { useToast } from '../hooks/useToast';
import { cn } from '../lib/utils';

const EMPTY_RATE_ROW = { serviceName: '', unit: 'hour', rate: '', description: '' };

export default function RateCards() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const { data: rateCardsData, isLoading } = useQuery({
    queryKey: ['rateCards'],
    queryFn: () => api.getRateCards(),
  });

  const { data: clientsData } = useQuery({
    queryKey: ['clients-for-ratecards'],
    queryFn: () => api.getClients(),
  });

  const rateCards = rateCardsData?.rateCards ?? [];
  const clients = clientsData ?? [];

  const createMutation = useMutation({
    mutationFn: (data) => api.createRateCard(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rateCards'] });
      toast.success('Rate card created');
      closeModal();
    },
    onError: (err) => toast.error('Failed to create rate card', err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateRateCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rateCards'] });
      toast.success('Rate card updated');
      closeModal();
    },
    onError: (err) => toast.error('Failed to update rate card', err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteRateCard(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rateCards'] });
      toast.success('Rate card deleted');
      setDeleteConfirm(null);
    },
    onError: (err) => toast.error('Failed to delete rate card', err.message),
  });

  function openNew() {
    setEditingCard(null);
    setModalOpen(true);
  }

  function openEdit(card) {
    setEditingCard(card);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingCard(null);
  }

  const sortedCards = [...rateCards].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    if (!a.clientId && b.clientId) return -1;
    if (a.clientId && !b.clientId) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Rate Cards</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage pricing templates for your services
          </p>
        </div>
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={openNew}>
          New Rate Card
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="h-24" />
            </Card>
          ))}
        </div>
      ) : sortedCards.length === 0 ? (
        <Card className="text-center py-12">
          <DollarSign className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No rate cards yet</h3>
          <p className="text-muted-foreground mb-4">
            Create your first rate card to standardize pricing across clients
          </p>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={openNew}>
            Create Rate Card
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sortedCards.map((card) => (
            <RateCardRow
              key={card.id}
              card={card}
              onEdit={() => openEdit(card)}
              onDelete={() => setDeleteConfirm(card)}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <RateCardModal
          card={editingCard}
          clients={clients}
          onSubmit={(data) => {
            if (editingCard) {
              updateMutation.mutate({ id: editingCard.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          onClose={closeModal}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {deleteConfirm && (
        <DeleteConfirmModal
          card={deleteConfirm}
          onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
          isLoading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

function RateCardRow({ card, onEdit, onDelete }) {
  const rateCount = card.rates?.length ?? 0;

  return (
    <Card
      className={cn(
        'transition-all duration-200',
        card.isDefault && 'ring-2 ring-primary/40'
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-lg">{card.name}</h3>
              {card.isDefault && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                  <Star className="w-3 h-3" />
                  Default
                </span>
              )}
              <span className={cn(
                'px-2 py-0.5 rounded-full text-xs font-medium',
                card.clientId
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
              )}>
                {card.client?.name ?? 'Global'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {rateCount} service rate{rateCount !== 1 ? 's' : ''}
            </p>
            {rateCount > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {card.rates.slice(0, 4).map((r, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-muted"
                  >
                    <span className="font-medium">{r.serviceName}</span>
                    <span className="text-muted-foreground">
                      ${typeof r.rate === 'number' ? r.rate.toFixed(2) : r.rate}/{r.unit}
                    </span>
                  </span>
                ))}
                {rateCount > 4 && (
                  <span className="px-2 py-1 rounded-md text-xs text-muted-foreground bg-muted">
                    +{rateCount - 4} more
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 ml-4">
            <Button variant="ghost" size="sm" onClick={onEdit} aria-label="Edit rate card">
              <Pencil className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Delete rate card">
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RateCardModal({ card, clients, onSubmit, onClose, isLoading }) {
  const isEditing = !!card;
  const [name, setName] = useState(card?.name ?? '');
  const [clientId, setClientId] = useState(card?.clientId ?? '');
  const [isDefault, setIsDefault] = useState(card?.isDefault ?? false);
  const [rates, setRates] = useState(
    card?.rates?.length
      ? card.rates.map((r) => ({ ...r }))
      : [{ ...EMPTY_RATE_ROW }]
  );

  function addRate() {
    setRates((prev) => [...prev, { ...EMPTY_RATE_ROW }]);
  }

  function removeRate(index) {
    setRates((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRate(index, field, value) {
    setRates((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      clientId: clientId || null,
      isDefault,
      rates: rates.map((r) => ({
        ...r,
        rate: parseFloat(r.rate) || 0,
      })).filter((r) => r.serviceName.trim()),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-lg font-heading font-semibold">
            {isEditing ? 'Edit Rate Card' : 'New Rate Card'}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Standard Pricing"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Client</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Global (all clients)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50"
            />
            <span className="text-sm">Set as default rate card</span>
          </label>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium">Service Rates</label>
              <Button type="button" variant="outline" size="xs" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={addRate}>
                Add Rate
              </Button>
            </div>

            <div className="space-y-2">
              {rates.map((rate, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <input
                    type="text"
                    value={rate.serviceName}
                    onChange={(e) => updateRate(idx, 'serviceName', e.target.value)}
                    placeholder="Service name"
                    className="flex-1 min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <select
                    value={rate.unit}
                    onChange={(e) => updateRate(idx, 'unit', e.target.value)}
                    className="w-28 rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="hour">Hour</option>
                    <option value="project">Project</option>
                    <option value="item">Item</option>
                  </select>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <input
                      type="number"
                      value={rate.rate}
                      onChange={(e) => updateRate(idx, 'rate', e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="w-24 rounded-lg border border-border bg-background pl-7 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <input
                    type="text"
                    value={rate.description}
                    onChange={(e) => updateRate(idx, 'description', e.target.value)}
                    placeholder="Description"
                    className="w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 hidden sm:block"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => removeRate(idx)}
                    className="text-destructive hover:text-destructive"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              {isEditing ? 'Save Changes' : 'Create Rate Card'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ card, onConfirm, onCancel, isLoading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-heading font-semibold mb-2">Delete Rate Card</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Are you sure you want to delete <strong>{card.name}</strong>? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} isLoading={isLoading}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}