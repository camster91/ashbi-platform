import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ChevronLeft,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { api } from '../lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui';
import Button from '../components/ui/Button';
import { cn } from '../lib/utils';

const PAGE_SIZE = 20;

const TYPE_COLORS = {
  income: 'text-green-600 dark:text-green-400',
  payment: 'text-blue-600 dark:text-blue-400',
  expense: 'text-red-600 dark:text-red-400',
};

const TYPE_BG = {
  income: 'bg-green-50 dark:bg-green-900/20',
  payment: 'bg-blue-50 dark:bg-blue-900/20',
  expense: 'bg-red-50 dark:bg-red-900/20',
};

const TYPE_BADGE = {
  income: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  payment: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  expense: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const TYPE_ICONS = {
  income: ArrowUpRight,
  payment: ArrowDownRight,
  expense: Minus,
};

const DATE_RANGES = [
  { label: 'This Month', getValue: () => getMonthRange(0) },
  { label: 'Last Month', getValue: () => getMonthRange(-1) },
  { label: 'This Quarter', getValue: () => getQuarterRange(0) },
  { label: 'This Year', getValue: () => getYearRange() },
  { label: 'Custom', getValue: null },
];

function getMonthRange(offset) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: format(d), end: format(end) };
}

function getQuarterRange(offset) {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3);
  const start = new Date(now.getFullYear(), quarter * 3, 1);
  const end = new Date(now.getFullYear(), quarter * 3 + 3, 0);
  return { start: format(start), end: format(end) };
}

function getYearRange() {
  const now = new Date();
  return {
    start: `${now.getFullYear()}-01-01`,
    end: `${now.getFullYear()}-12-31`,
  };
}

function format(d) {
  return d.toISOString().split('T')[0];
}

function formatCurrency(n) {
  if (n == null) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export default function Bookkeeping() {
  const [dateRangeIdx, setDateRangeIdx] = useState(0);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [page, setPage] = useState(1);

  const dateRange = DATE_RANGES[dateRangeIdx]?.getValue?.() ?? null;
  const startDate = dateRange?.start ?? customStart;
  const endDate = dateRange?.end ?? customEnd;

  const { data: clientsData } = useQuery({
    queryKey: ['clients-for-bookkeeping'],
    queryFn: () => api.getClients(),
  });
  const clients = clientsData ?? [];

  const summaryParams = startDate && endDate ? { startDate, endDate } : undefined;
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['bookkeeping-summary', summaryParams],
    queryFn: () => api.getBookkeepingSummary(summaryParams),
    enabled: !!summaryParams,
  });

  const { data: balance } = useQuery({
    queryKey: ['bookkeeping-balance'],
    queryFn: () => api.getBookkeepingBalance(),
  });

  const txParams = {
    ...(startDate && endDate ? { startDate, endDate } : {}),
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(clientFilter ? { clientId: clientFilter } : {}),
    page,
    limit: PAGE_SIZE,
  };
  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['bookkeeping-transactions', txParams],
    queryFn: () => api.getBookkeepingTransactions(txParams),
  });

  const transactions = txData?.transactions ?? [];
  const total = txData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const netIncome = summary?.netIncome ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Bookkeeping</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Track income, payments, and expenses
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Revenue"
          value={summary?.totalInvoiced}
          loading={summaryLoading}
          icon={TrendingUp}
          color="green"
        />
        <SummaryCard
          title="Total Expenses"
          value={summary?.totalExpenses}
          loading={summaryLoading}
          icon={TrendingDown}
          color="red"
        />
        <SummaryCard
          title="Net Income"
          value={netIncome}
          loading={summaryLoading}
          icon={netIncome >= 0 ? TrendingUp : TrendingDown}
          color={netIncome >= 0 ? 'green' : 'red'}
        />
        <SummaryCard
          title="Outstanding"
          value={summary?.outstanding}
          loading={summaryLoading}
          icon={AlertCircle}
          color="orange"
        />
      </div>

      {/* Balance Card */}
      {balance && (
        <Card>
          <CardContent className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Total Receivables</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(balance.totalReceivables)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Overdue</p>
                <p className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">
                  {balance.overdueCount ?? 0} overdue
                </p>
                {balance.totalOverdue > 0 && (
                  <p className="text-sm text-red-500">{formatCurrency(balance.totalOverdue)}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Date Range</label>
              <select
                value={dateRangeIdx}
                onChange={(e) => {
                  setDateRangeIdx(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {DATE_RANGES.map((r, i) => (
                  <option key={i} value={i}>{r.label}</option>
                ))}
              </select>
            </div>

            {dateRangeIdx === DATE_RANGES.length - 1 && (
              <>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">From</label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => { setCustomStart(e.target.value); setPage(1); }}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">To</label>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => { setCustomEnd(e.target.value); setPage(1); }}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
              <select
                value={typeFilter}
                onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">All Types</option>
                <option value="income">Income</option>
                <option value="payment">Payments</option>
                <option value="expense">Expenses</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Client</label>
              <select
                value={clientFilter}
                onChange={(e) => { setClientFilter(e.target.value); setPage(1); }}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">All Clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transaction Ledger */}
      <Card>
        <CardHeader className="px-6 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Transactions</CardTitle>
            <span className="text-sm text-muted-foreground">
              {total} result{total !== 1 ? 's' : ''}
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {txLoading ? (
            <div className="space-y-3 p-6">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-12 px-6">
              <Filter className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No transactions found for the selected filters</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Description</th>
                      <th className="px-6 py-3">Client</th>
                      <th className="px-6 py-3 text-right">Amount</th>
                      <th className="px-6 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {transactions.map((tx) => (
                      <TransactionRow key={tx.id} tx={tx} />
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-border">
                  <p className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ title, value, loading, icon: Icon, color }) {
  const colorMap = {
    green: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20',
    red: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20',
    blue: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20',
    orange: 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20',
  };
  const iconColorMap = {
    green: 'text-green-600 dark:text-green-400',
    red: 'text-red-600 dark:text-red-400',
    blue: 'text-blue-600 dark:text-blue-400',
    orange: 'text-orange-600 dark:text-orange-400',
  };

  return (
    <Card className={cn('border', colorMap[color] ?? '')}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <Icon className={cn('w-5 h-5', iconColorMap[color] ?? '')} />
        </div>
        {loading ? (
          <div className="h-8 bg-muted animate-pulse rounded w-24" />
        ) : (
          <p className={cn('text-2xl font-bold', iconColorMap[color] ?? '')}>
            {formatCurrency(value)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TransactionRow({ tx }) {
  const Icon = TYPE_ICONS[tx.type] ?? Minus;

  return (
    <tr className="hover:bg-muted/50 transition-colors">
      <td className="px-6 py-3 text-sm whitespace-nowrap">
        {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </td>
      <td className="px-6 py-3">
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', TYPE_BADGE[tx.type] ?? '')}>
          <Icon className="w-3 h-3" />
          {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
        </span>
      </td>
      <td className="px-6 py-3 text-sm max-w-xs truncate">
        {tx.description}
      </td>
      <td className="px-6 py-3 text-sm text-muted-foreground">
        {tx.client?.name ?? '—'}
      </td>
      <td className={cn('px-6 py-3 text-sm font-medium text-right', TYPE_COLORS[tx.type] ?? '')}>
        {tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : ''}
        {formatCurrency(tx.amount)}
      </td>
      <td className="px-6 py-3">
        <span className={cn(
          'px-2 py-0.5 rounded-full text-xs font-medium',
          tx.status === 'completed' && 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
          tx.status === 'pending' && 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
          tx.status === 'overdue' && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
          tx.status === 'cancelled' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
          !['completed', 'pending', 'overdue', 'cancelled'].includes(tx.status) && 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
        )}>
          {tx.status ? tx.status.charAt(0).toUpperCase() + tx.status.slice(1) : 'Unknown'}
        </span>
      </td>
    </tr>
  );
}