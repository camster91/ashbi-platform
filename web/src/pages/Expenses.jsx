import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Receipt, Plus, DollarSign, Filter, Search, Trash2, Pencil, Upload,
  X, TrendingUp, Tag, Calendar, Building2, FolderOpen,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const CATEGORIES = [
  { value: 'OFFICE', label: 'Office' },
  { value: 'SOFTWARE', label: 'Software' },
  { value: 'TRAVEL', label: 'Travel' },
  { value: 'MEALS', label: 'Meals' },
  { value: 'CONTRACTORS', label: 'Contractors' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'HOSTING', label: 'Hosting' },
  { value: 'SUBCONTRACTOR', label: 'Subcontractor' },
  { value: 'SUPPLIES', label: 'Supplies' },
  { value: 'OTHER', label: 'Other' },
];

const CATEGORY_COLORS = {
  OFFICE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  SOFTWARE: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  TRAVEL: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  MEALS: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  CONTRACTORS: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  MARKETING: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  HOSTING: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  SUBCONTRACTOR: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  SUPPLIES: 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400',
  OTHER: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

function fmt(n) {
  return `$${(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const emptyForm = {
  description: '',
  amount: '',
  category: 'OTHER',
  currency: 'CAD',
  date: new Date().toISOString().split('T')[0],
  billable: false,
  notes: '',
  clientId: '',
  projectId: '',
  receiptUrl: '',
};

export default function Expenses() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [receiptFile, setReceiptFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  // Filters
  const [filterCategory, setFilterCategory] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Queries
  const { data: expenseData = { expenses: [], total: 0 }, isLoading } = useQuery({
    queryKey: ['expenses', filterCategory, filterClient, startDate, endDate, searchQuery],
    queryFn: () => api.getExpenses({
      ...(filterCategory ? { category: filterCategory } : {}),
      ...(filterClient ? { clientId: filterClient } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(searchQuery ? { search: searchQuery } : {}),
    }),
  });

  const { data: summary = {} } = useQuery({
    queryKey: ['expense-summary'],
    queryFn: () => api.getExpenseSummary(),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects ? api.getProjects() : Promise.resolve([]),
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data) => api.createExpense(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateExpense(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteExpense(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
    },
  });

  function resetForm() {
    setForm({ ...emptyForm });
    setEditingId(null);
    setShowForm(false);
    setReceiptFile(null);
  }

  function startEdit(expense) {
    setForm({
      description: expense.description || '',
      amount: expense.amount?.toString() || '',
      category: expense.category || 'OTHER',
      currency: expense.currency || 'CAD',
      date: expense.date ? new Date(expense.date).toISOString().split('T')[0] : '',
      billable: expense.billable || false,
      notes: expense.notes || '',
      clientId: expense.clientId || '',
      projectId: expense.projectId || '',
      receiptUrl: expense.receiptUrl || '',
    });
    setEditingId(expense.id);
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    let receiptUrl = form.receiptUrl;

    // Upload receipt if file selected
    if (receiptFile) {
      setUploading(true);
      try {
        const result = await api.uploadReceipt(receiptFile);
        receiptUrl = result.url;
      } catch (err) {
        console.error('Receipt upload failed:', err);
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    const payload = {
      ...form,
      amount: parseFloat(form.amount),
      receiptUrl,
      clientId: form.clientId || null,
      projectId: form.projectId || null,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const expenses = expenseData.expenses || [];
  const categoryBreakdown = summary.byCategory || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Expenses</h1>
          <p className="text-muted-foreground">Track and manage business expenses</p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          Add Expense
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
              <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">This Month</p>
              <p className="text-xl font-bold text-foreground">{fmt(summary.totalThisMonth)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">All Time</p>
              <p className="text-xl font-bold text-foreground">{fmt(summary.allTimeTotal)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Receipt className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Entries</p>
              <p className="text-xl font-bold text-foreground">{summary.allTimeCount || 0}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Tag className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Categories</p>
              <p className="text-xl font-bold text-foreground">{Object.keys(categoryBreakdown).length}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Category Breakdown */}
      {Object.keys(categoryBreakdown).length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">This Month by Category</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(categoryBreakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, amount]) => (
                <div key={cat} className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[cat] || CATEGORY_COLORS.OTHER}`}>
                    {cat}
                  </span>
                  <span className="text-sm font-medium text-foreground">{fmt(amount)}</span>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Filter className="w-4 h-4" />
            <span className="text-sm font-medium">Filters</span>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary w-48"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="py-2 px-3 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="py-2 px-3 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary"
          >
            <option value="">All Clients</option>
            {(Array.isArray(clients) ? clients : clients?.clients || []).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="py-2 px-3 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary"
            placeholder="Start date"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="py-2 px-3 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary"
            placeholder="End date"
          />
          {(filterCategory || filterClient || startDate || endDate || searchQuery) && (
            <button
              onClick={() => { setFilterCategory(''); setFilterClient(''); setStartDate(''); setEndDate(''); setSearchQuery(''); }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </Card>

      {/* Add/Edit Form */}
      {showForm && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              {editingId ? 'Edit Expense' : 'Add Expense'}
            </h2>
            <button onClick={resetForm} className="text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Description */}
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">Description *</label>
                <input
                  type="text"
                  required
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="What was this expense for?"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Amount *</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    placeholder="0.00"
                  />
                  <select
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className="px-2 py-2 text-sm bg-background border border-border rounded-md"
                  >
                    <option value="CAD">CAD</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              {/* Client */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Client (optional)</label>
                <select
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="">No client</option>
                  {(Array.isArray(clients) ? clients : clients?.clients || []).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Project */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Project (optional)</label>
                <select
                  value={form.projectId}
                  onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="">No project</option>
                  {(Array.isArray(projects) ? projects : projects?.projects || []).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Receipt Upload */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Receipt</label>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 px-3 py-2 text-sm bg-background border border-border rounded-md cursor-pointer hover:bg-muted transition-colors">
                    <Upload className="w-4 h-4" />
                    <span>{receiptFile ? receiptFile.name : (form.receiptUrl ? 'Replace' : 'Upload')}</span>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
                      className="hidden"
                      onChange={(e) => setReceiptFile(e.target.files[0] || null)}
                    />
                  </label>
                  {form.receiptUrl && !receiptFile && (
                    <a href={form.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                      View
                    </a>
                  )}
                </div>
              </div>

              {/* Billable */}
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.billable}
                    onChange={(e) => setForm({ ...form, billable: e.target.checked })}
                    className="rounded border-border"
                  />
                  <span className="text-sm text-foreground">Billable expense</span>
                </label>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder="Additional notes..."
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending || uploading}>
                {uploading ? 'Uploading...' : (editingId ? 'Update' : 'Add')} Expense
              </Button>
              <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Expense List */}
      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading expenses...</div>
        ) : expenses.length === 0 ? (
          <div className="p-8 text-center">
            <Receipt className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-muted-foreground">No expenses found</p>
            <p className="text-sm text-muted-foreground mt-1">Add your first expense to start tracking</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Date</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Description</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Category</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Client</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Amount</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                        {new Date(expense.date).toLocaleDateString('en-CA')}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-foreground">{expense.description}</div>
                      {expense.notes && (
                        <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">{expense.notes}</div>
                      )}
                      {expense.receiptUrl && (
                        <a href={expense.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                          View receipt
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[expense.category] || CATEGORY_COLORS.OTHER}`}>
                        {expense.category}
                      </span>
                      {expense.billable && (
                        <span className="ml-1 inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Billable
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {expense.client ? (
                        <div className="flex items-center gap-1.5 text-sm text-foreground">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                          {expense.client.name}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">--</span>
                      )}
                      {expense.project && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                          <FolderOpen className="w-3 h-3" />
                          {expense.project.name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-semibold text-foreground">{fmt(expense.amount)}</span>
                      <span className="text-xs text-muted-foreground ml-1">{expense.currency}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => startEdit(expense)}
                          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('Delete this expense?')) {
                              deleteMutation.mutate(expense.id);
                            }
                          }}
                          className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-muted-foreground hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
