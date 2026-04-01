import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Save,
  Plus,
  Trash2,
  Loader2,
  Brain,
  Pencil,
  X,
  Check,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

export default function AiContextSettings() {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data: contextItems = [], isLoading } = useQuery({
    queryKey: ['ai-context'],
    queryFn: () => api.getAiContext(),
  });

  const saveMutation = useMutation({
    mutationFn: ({ key, value }) => api.saveAiContext({ key, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-context'] });
      setEditingKey(null);
      setEditValue('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key) => api.deleteAiContext(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-context'] });
    },
  });

  const addMutation = useMutation({
    mutationFn: ({ key, value }) => api.saveAiContext({ key, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-context'] });
      setNewKey('');
      setNewValue('');
      setShowAdd(false);
    },
  });

  const startEdit = (item) => {
    setEditingKey(item.key);
    setEditValue(item.value);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const handleSave = (key) => {
    saveMutation.mutate({ key, value: editValue });
  };

  const handleAdd = () => {
    if (!newKey.trim() || !newValue.trim()) return;
    addMutation.mutate({ key: newKey.trim(), value: newValue.trim() });
  };

  const keyLabels = {
    brand_voice: 'Brand Voice',
    services: 'Services',
    pricing: 'Pricing',
    icp: 'Ideal Client Profile',
    tone_examples: 'Tone Examples',
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            AI Context Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the context injected into every AI agent call as a system prompt prefix
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Context
        </button>
      </div>

      {/* Add new row */}
      {showAdd && (
        <div className="bg-card rounded-xl border border-primary/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">New Context Entry</h3>
            <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="key (e.g. brand_voice, services, pricing)"
            className="w-full px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <textarea
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Value..."
            rows={3}
            className="w-full px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!newKey.trim() || !newValue.trim() || addMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {addMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
          </div>
        </div>
      )}

      {/* Context items */}
      <div className="space-y-3">
        {contextItems.length === 0 && !showAdd && (
          <div className="bg-card rounded-xl border border-border p-8 text-center">
            <Settings className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No AI context configured yet. Add your first entry above.</p>
          </div>
        )}

        {contextItems.map((item) => (
          <div
            key={item.key}
            className="bg-card rounded-xl border border-border p-4 hover:border-border/80 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-mono px-2 py-0.5 bg-primary/10 text-primary rounded">
                    {item.key}
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {keyLabels[item.key] || item.key.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    Updated {new Date(item.updatedAt).toLocaleDateString()}
                  </span>
                </div>

                {editingKey === item.key ? (
                  <div className="space-y-2">
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 text-sm bg-muted border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSave(item.key)}
                        disabled={saveMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {item.value}
                  </p>
                )}
              </div>

              {editingKey !== item.key && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => startEdit(item)}
                    className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${item.key}"?`)) {
                        deleteMutation.mutate(item.key);
                      }
                    }}
                    className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
                    title="Delete"
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Preview */}
      {contextItems.length > 0 && (
        <div className="bg-muted/50 rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            System Prompt Preview
          </h3>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-card p-3 rounded-lg border border-border">
            {contextItems.map(item =>
              `[${item.key.replace(/_/g, ' ').toUpperCase()}]: ${item.value}`
            ).join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
}
