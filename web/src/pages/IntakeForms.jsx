import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList, Plus, Trash2, Pencil, Eye, Copy, Link2,
  GripVertical, ToggleLeft, ToggleRight, ChevronDown, ChevronUp,
  Check, X, FileText, Users, Loader2,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';
import { cn } from '../lib/utils';

const FIELD_TYPES = [
  { value: 'TEXT', label: 'Short Text' },
  { value: 'TEXTAREA', label: 'Long Text' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'PHONE', label: 'Phone' },
  { value: 'DATE', label: 'Date' },
  { value: 'SELECT', label: 'Dropdown' },
  { value: 'CHECKBOX', label: 'Checkbox' },
  { value: 'FILE', label: 'File Upload' },
];

const emptyField = { label: '', type: 'TEXT', required: false, options: '' };

export default function IntakeForms() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '', clientId: '', fields: [{ ...emptyField }] });
  const [copiedToken, setCopiedToken] = useState(null);

  const { data: forms = [], isLoading } = useQuery({
    queryKey: ['intake-forms'],
    queryFn: api.getIntakeForms,
  });

  const { data: formDetail } = useQuery({
    queryKey: ['intake-form', viewingId],
    queryFn: () => api.getIntakeForm(viewingId),
    enabled: !!viewingId,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createIntakeForm(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['intake-forms'] }); resetForm(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateIntakeForm(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['intake-forms'] }); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteIntakeForm(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['intake-forms'] }); },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }) => api.updateIntakeForm(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['intake-forms'] }),
  });

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setPreviewMode(false);
    setFormData({ name: '', description: '', clientId: '', fields: [{ ...emptyField }] });
  }

  function startEdit(form) {
    setEditingId(form.id);
    setFormData({
      name: form.name,
      description: form.description || '',
      clientId: form.clientId || '',
      fields: form.fields.length > 0 ? form.fields.map(f => ({
        ...f,
        options: Array.isArray(f.options) ? f.options.join(', ') : (f.options || ''),
      })) : [{ ...emptyField }],
    });
    setShowForm(true);
    setViewingId(null);
  }

  function addField() {
    setFormData(prev => ({ ...prev, fields: [...prev.fields, { ...emptyField }] }));
  }

  function removeField(index) {
    setFormData(prev => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== index),
    }));
  }

  function updateField(index, key, value) {
    setFormData(prev => ({
      ...prev,
      fields: prev.fields.map((f, i) => i === index ? { ...f, [key]: value } : f),
    }));
  }

  function moveField(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= formData.fields.length) return;
    setFormData(prev => {
      const fields = [...prev.fields];
      [fields[index], fields[newIndex]] = [fields[newIndex], fields[index]];
      return { ...prev, fields };
    });
  }

  function handleSave() {
    const payload = {
      name: formData.name,
      description: formData.description || null,
      clientId: formData.clientId || null,
      fields: formData.fields.filter(f => f.label.trim()).map(f => ({
        label: f.label,
        type: f.type,
        required: f.required,
        ...(f.type === 'SELECT' && f.options
          ? { options: f.options.split(',').map(o => o.trim()).filter(Boolean) }
          : {}),
      })),
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function copyLink(token) {
    const url = `${window.location.origin}/portal/form/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  // ─── Viewing responses detail ─────────────────────────────────────────────
  if (viewingId && formDetail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <button onClick={() => setViewingId(null)} className="text-sm text-muted-foreground hover:text-foreground mb-1">&larr; Back to Forms</button>
            <h1 className="text-2xl font-heading font-bold text-foreground">{formDetail.name}</h1>
            {formDetail.description && <p className="text-muted-foreground mt-1">{formDetail.description}</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => copyLink(formDetail.viewToken)} leftIcon={copiedToken === formDetail.viewToken ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}>
              {copiedToken === formDetail.viewToken ? 'Copied!' : 'Copy Link'}
            </Button>
            <Button size="sm" onClick={() => startEdit(formDetail)} leftIcon={<Pencil className="w-4 h-4" />}>Edit</Button>
          </div>
        </div>

        {/* Fields overview */}
        <Card className="p-4">
          <h3 className="font-semibold text-foreground mb-3">Form Fields</h3>
          <div className="space-y-2">
            {formDetail.fields.map((field, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-xs font-mono">{field.type}</span>
                <span className="text-foreground">{field.label}</span>
                {field.required && <span className="text-xs text-red-400">Required</span>}
                {field.options?.length > 0 && (
                  <span className="text-xs text-muted-foreground">Options: {field.options.join(', ')}</span>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Responses */}
        <div>
          <h3 className="font-semibold text-foreground mb-3">Responses ({formDetail.responses?.length || 0})</h3>
          {formDetail.responses?.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">No responses yet. Share the form link to collect responses.</Card>
          ) : (
            <div className="space-y-3">
              {formDetail.responses?.map(r => (
                <Card key={r.id} className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="font-medium text-foreground">{r.respondentName}</span>
                      <span className="text-muted-foreground ml-2 text-sm">{r.respondentEmail}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="grid gap-2 text-sm">
                    {Object.entries(r.answers).map(([key, val]) => (
                      <div key={key} className="flex gap-2">
                        <span className="font-medium text-muted-foreground min-w-[140px]">{key}:</span>
                        <span className="text-foreground">{typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Form builder ─────────────────────────────────────────────────────────
  if (showForm) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-heading font-bold text-foreground">
            {editingId ? 'Edit Form' : 'Create Intake Form'}
          </h1>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPreviewMode(!previewMode)}>
              <Eye className="w-4 h-4 mr-1" /> {previewMode ? 'Edit' : 'Preview'}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetForm}>Cancel</Button>
          </div>
        </div>

        {previewMode ? (
          // ─── Preview ────────────────────────────────────────────────
          <Card className="p-6 max-w-2xl mx-auto">
            <h2 className="text-xl font-bold text-foreground mb-1">{formData.name || 'Untitled Form'}</h2>
            {formData.description && <p className="text-muted-foreground mb-6">{formData.description}</p>}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Your Name <span className="text-red-400">*</span></label>
                <input disabled className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm" placeholder="Enter your name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Your Email <span className="text-red-400">*</span></label>
                <input disabled className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm" placeholder="Enter your email" />
              </div>

              {formData.fields.filter(f => f.label.trim()).map((field, i) => (
                <div key={i}>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {field.label} {field.required && <span className="text-red-400">*</span>}
                  </label>
                  {field.type === 'TEXTAREA' ? (
                    <textarea disabled className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm" rows={3} />
                  ) : field.type === 'SELECT' ? (
                    <select disabled className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm">
                      <option>Select...</option>
                      {field.options?.split(',').map(o => o.trim()).filter(Boolean).map(o => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : field.type === 'CHECKBOX' ? (
                    <div className="flex items-center gap-2">
                      <input type="checkbox" disabled className="rounded border-border" />
                      <span className="text-sm text-muted-foreground">Yes</span>
                    </div>
                  ) : (
                    <input
                      disabled
                      type={field.type === 'DATE' ? 'date' : field.type === 'EMAIL' ? 'email' : field.type === 'PHONE' ? 'tel' : 'text'}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6">
              <Button disabled>Submit</Button>
            </div>
          </Card>
        ) : (
          // ─── Editor ─────────────────────────────────────────────────
          <div className="space-y-4">
            <Card className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Form Name *</label>
                <input
                  value={formData.name}
                  onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. Website Project Questionnaire"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  rows={2}
                  placeholder="Brief instructions for the form"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Client (optional)</label>
                <select
                  value={formData.clientId}
                  onChange={e => setFormData(p => ({ ...p, clientId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">No client linked</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold text-foreground mb-3">Fields</h3>
              <div className="space-y-3">
                {formData.fields.map((field, index) => (
                  <div key={index} className="flex gap-2 items-start p-3 rounded-lg border border-border bg-muted/30">
                    <div className="flex flex-col gap-1 pt-1">
                      <button onClick={() => moveField(index, -1)} disabled={index === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button onClick={() => moveField(index, 1)} disabled={index === formData.fields.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-2">
                      <div className="md:col-span-2">
                        <input
                          value={field.label}
                          onChange={e => updateField(index, 'label', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                          placeholder="Field label"
                        />
                      </div>
                      <div>
                        <select
                          value={field.type}
                          onChange={e => updateField(index, 'type', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        >
                          {FIELD_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateField(index, 'required', !field.required)}
                          className={cn('flex items-center gap-1 text-sm px-2 py-1 rounded', field.required ? 'text-primary' : 'text-muted-foreground')}
                        >
                          {field.required ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                          Required
                        </button>
                        <button onClick={() => removeField(index)} className="text-muted-foreground hover:text-destructive p-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {field.type === 'SELECT' && (
                        <div className="md:col-span-4">
                          <input
                            value={field.options}
                            onChange={e => updateField(index, 'options', e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            placeholder="Options (comma separated): Option 1, Option 2, Option 3"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="mt-3" onClick={addField} leftIcon={<Plus className="w-4 h-4" />}>
                Add Field
              </Button>
            </Card>

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={resetForm}>Cancel</Button>
              <Button onClick={handleSave} disabled={!formData.name.trim() || saving} leftIcon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}>
                {editingId ? 'Update Form' : 'Create Form'}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── List view ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Intake Forms</h1>
          <p className="text-muted-foreground">Create questionnaires for client onboarding and project briefs</p>
        </div>
        <Button onClick={() => setShowForm(true)} leftIcon={<Plus className="w-4 h-4" />}>
          New Form
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : forms.length === 0 ? (
        <Card className="p-12 text-center">
          <ClipboardList className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-semibold text-foreground mb-1">No intake forms yet</h3>
          <p className="text-muted-foreground text-sm mb-4">Create a form to collect information from clients and prospects.</p>
          <Button onClick={() => setShowForm(true)} leftIcon={<Plus className="w-4 h-4" />}>Create Form</Button>
        </Card>
      ) : (
        <div className="grid gap-4">
          {forms.map(form => (
            <Card key={form.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', form.isActive ? 'bg-primary/10' : 'bg-muted')}>
                    <FileText className={cn('w-5 h-5', form.isActive ? 'text-primary' : 'text-muted-foreground')} />
                  </div>
                  <div className="min-w-0">
                    <button onClick={() => setViewingId(form.id)} className="font-semibold text-foreground hover:text-primary truncate block text-left">
                      {form.name}
                    </button>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      {form.client && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{form.client.name}</span>}
                      <span>{form.fields.length} field{form.fields.length !== 1 ? 's' : ''}</span>
                      <span>{form.responseCount} response{form.responseCount !== 1 ? 's' : ''}</span>
                      <span className={cn('px-1.5 py-0.5 rounded-full', form.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400')}>
                        {form.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => copyLink(form.viewToken)} title="Copy public link">
                    {copiedToken === form.viewToken ? <Check className="w-4 h-4 text-green-500" /> : <Link2 className="w-4 h-4" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setViewingId(form.id)} title="View responses">
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(form)} title="Edit">
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleActiveMutation.mutate({ id: form.id, isActive: !form.isActive })}
                    title={form.isActive ? 'Deactivate' : 'Activate'}
                  >
                    {form.isActive ? <ToggleRight className="w-4 h-4 text-green-500" /> : <ToggleLeft className="w-4 h-4" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm('Delete this form and all responses?')) deleteMutation.mutate(form.id); }} title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
