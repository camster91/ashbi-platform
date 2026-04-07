import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  DollarSign, TrendingUp, TrendingDown, Wallet, Receipt, 
  Plus, Calendar, Filter, Search, MoreVertical, Trash2, 
  Download, ArrowUpRight, ArrowDownRight, CreditCard,
  Briefcase, User, Info, AlertCircle, CheckCircle
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const CATEGORIES = [
  'SOFTWARE', 'SUBCONTRACTOR', 'HOSTING', 'MARKETING', 
  'TRAVEL', 'SUPPLIES', 'ADVERTISING', 'RENT', 'OTHER'
];

function fmt(n) {
  return `$${(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FinanceDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('expenses'); // 'expenses' | 'revenue'
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    description: '',
    amount: '',
    category: 'OTHER',
    date: new Date().toISOString().split('T')[0],
    clientId: '',
    notes: '',
    billable: false
  });

  // Queries
  const { data: expenseData = { expenses: [], summary: { totalAmount: 0 } }, isLoading: expensesLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.getExpenses ? api.getExpenses() : Promise.resolve({ expenses: [], summary: { totalAmount: 0 } })
  });

  const { data: invoiceData = { invoices: [], stats: {} }, isLoading: invoicesLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => api.getInvoices ? api.getInvoices() : Promise.resolve({ invoices: [], stats: {} })
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients ? api.getClients() : Promise.resolve([])
  });

  // Mutations
  const createExpenseMutation = useMutation({
    mutationFn: (data) => api.createExpense(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setShowAddExpense(false);
      setExpenseForm({
        description: '', amount: '', category: 'OTHER', 
        date: new Date().toISOString().split('T')[0], 
        clientId: '', notes: '', billable: false
      });
    }
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: (id) => api.deleteExpense(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] })
  });

  // Calculate Metrics
  const totalRevenue = invoiceData.invoices
    .filter(i => i.status === 'PAID')
    .reduce((sum, i) => sum + (i.total || 0), 0);
  
  const totalExpenses = expenseData.summary.totalAmount;
  const netProfit = totalRevenue - totalExpenses;

  const handleAddExpense = (e) => {
    e.preventDefault();
    createExpenseMutation.mutate(expenseForm);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Finance Dashboard</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
          <Button size="sm" onClick={() => setShowAddExpense(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Expense
          </Button>
        </div>
      </div>

      {/* Top Metrics */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
              <h3 className="text-2xl font-bold text-green-600">{fmt(totalRevenue)}</h3>
            </div>
            <div className="p-3 bg-green-100 rounded-full dark:bg-green-900/20">
              <TrendingUp className="h-6 w-6 text-green-600" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Paid invoices only</p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Expenses</p>
              <h3 className="text-2xl font-bold text-red-600">{fmt(totalExpenses)}</h3>
            </div>
            <div className="p-3 bg-red-100 rounded-full dark:bg-red-900/20">
              <TrendingDown className="h-6 w-6 text-red-600" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">All tracked expenses</p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Net Profit</p>
              <h3 className={`text-2xl font-bold ${netProfit >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                {fmt(netProfit)}
              </h3>
            </div>
            <div className="p-3 bg-blue-100 rounded-full dark:bg-blue-900/20">
              <Wallet className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Revenue - Expenses</p>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <div className="space-y-4">
        <div className="flex border-b">
          <button
            className={`px-4 py-2 font-medium text-sm transition-colors ${activeTab === 'expenses' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('expenses')}
          >
            Expenses
          </button>
          <button
            className={`px-4 py-2 font-medium text-sm transition-colors ${activeTab === 'revenue' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('revenue')}
          >
            Invoices & Revenue
          </button>
        </div>

        {activeTab === 'expenses' && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Date</th>
                    <th className="px-6 py-3 font-semibold">Description</th>
                    <th className="px-6 py-3 font-semibold">Category</th>
                    <th className="px-6 py-3 font-semibold">Client</th>
                    <th className="px-6 py-3 font-semibold">Amount</th>
                    <th className="px-6 py-3 font-semibold">Status</th>
                    <th className="px-6 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-muted/20">
                  {expenseData.expenses.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-6 py-8 text-center text-muted-foreground">
                        No expenses found. Add your first expense to get started.
                      </td>
                    </tr>
                  ) : (
                    expenseData.expenses.map((expense) => (
                      <tr key={expense.id} className="hover:bg-muted/5">
                        <td className="px-6 py-4 whitespace-nowrap">
                          {new Date(expense.date).toLocaleDateString('en-CA')}
                        </td>
                        <td className="px-6 py-4 font-medium">{expense.description}</td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 rounded-full bg-muted text-[10px] font-bold uppercase tracking-wider">
                            {expense.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">
                          {expense.client?.name || '-'}
                        </td>
                        <td className="px-6 py-4 font-bold text-red-600">
                          {fmt(expense.amount)}
                        </td>
                        <td className="px-6 py-4">
                          {expense.billable ? (
                            <span className="flex items-center text-blue-600 gap-1 text-xs">
                              <CheckCircle className="h-3 w-3" /> Billable
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">Internal</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button 
                            onClick={() => deleteExpenseMutation.mutate(expense.id)}
                            className="text-muted-foreground hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {activeTab === 'revenue' && (
          <Card className="overflow-hidden">
             <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Invoice #</th>
                    <th className="px-6 py-3 font-semibold">Client</th>
                    <th className="px-6 py-3 font-semibold">Due Date</th>
                    <th className="px-6 py-3 font-semibold">Amount</th>
                    <th className="px-6 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-muted/20">
                  {invoiceData.invoices.slice(0, 10).map((inv) => (
                    <tr key={inv.id} className="hover:bg-muted/5">
                      <td className="px-6 py-4 font-medium">{inv.invoiceNumber}</td>
                      <td className="px-6 py-4">{inv.client?.name}</td>
                      <td className="px-6 py-4">{new Date(inv.dueDate).toLocaleDateString('en-CA')}</td>
                      <td className="px-6 py-4 font-bold">{fmt(inv.total)}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                          inv.status === 'PAID' ? 'bg-green-100 text-green-700' : 
                          inv.status === 'OVERDUE' ? 'bg-red-100 text-red-700' : 
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* Add Expense Modal (Simplified as an overlay here) */}
      {showAddExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md p-6 bg-background shadow-xl">
            <h2 className="text-xl font-bold mb-4">Add Expense</h2>
            <form onSubmit={handleAddExpense} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <input 
                  type="text" 
                  required
                  className="w-full p-2 border rounded bg-background"
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm({...expenseForm, description: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Amount ($)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    required
                    className="w-full p-2 border rounded bg-background"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({...expenseForm, amount: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <select 
                    className="w-full p-2 border rounded bg-background"
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm({...expenseForm, category: e.target.value})}
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Date</label>
                  <input 
                    type="date" 
                    required
                    className="w-full p-2 border rounded bg-background"
                    value={expenseForm.date}
                    onChange={(e) => setExpenseForm({...expenseForm, date: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Client (Optional)</label>
                  <select 
                    className="w-full p-2 border rounded bg-background"
                    value={expenseForm.clientId}
                    onChange={(e) => setExpenseForm({...expenseForm, clientId: e.target.value})}
                  >
                    <option value="">None</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="billable"
                  checked={expenseForm.billable}
                  onChange={(e) => setExpenseForm({...expenseForm, billable: e.target.checked})}
                />
                <label htmlFor="billable" className="text-sm">Billable to client</label>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" type="button" onClick={() => setShowAddExpense(false)}>Cancel</Button>
                <Button type="submit" disabled={createExpenseMutation.isLoading}>
                  {createExpenseMutation.isLoading ? 'Saving...' : 'Save Expense'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
