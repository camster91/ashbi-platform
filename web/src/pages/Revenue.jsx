import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  RefreshCw,
  ArrowUpRight,
  Calendar,
  Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

function fmt(n, decimals = 0) {
  return `$${(n || 0).toLocaleString('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function MonthBar({ month, revenue, maxRevenue }) {
  const pct = maxRevenue > 0 ? (revenue / maxRevenue) * 100 : 0;
  const label = month.split('-').slice(1).join('/') + '/' + month.split('-')[0].slice(2);
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <span className="text-[10px] text-muted-foreground">{fmt(revenue, 0).replace('$', '$')}</span>
      <div className="w-full flex flex-col justify-end" style={{ height: '80px' }}>
        <div
          className="w-full bg-primary rounded-t transition-all"
          style={{ height: `${pct}%`, minHeight: revenue > 0 ? '4px' : '0' }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

export default function Revenue() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['revenue-dashboard'],
    queryFn: () => api.getRevenueDashboard(),
    staleTime: 5 * 60 * 1000,
  });

  const handleRefresh = async () => {
    await api.getRevenueDashboard(true);
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const s = data?.summary || {};
  const trends = data?.seasonalTrends || [];
  const maxRevenue = Math.max(...trends.map(t => t.revenue), 1);
  const byClient = data?.revenueByClient || [];
  const overdueByClient = data?.overdueByClient || {};
  const retainers = data?.retainerPlans || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Revenue</h1>
          <p className="text-sm text-muted-foreground mt-1">MRR, collections, and financial overview</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          loading={isFetching}
          leftIcon={<RefreshCw className="w-4 h-4" />}
        >
          Refresh
        </Button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">MRR</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(s.mrr)}</p>
          <p className="text-xs text-muted-foreground mt-1">ARR {fmt(s.arr)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="w-4 h-4 text-blue-500" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">This Month</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(s.thisMonthRevenue)}</p>
          <p className="text-xs text-muted-foreground mt-1">Sent {fmt(s.thisMonthSent)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-purple-500" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">YTD Revenue</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(s.ytdRevenue)}</p>
          <p className="text-xs text-muted-foreground mt-1">Total {fmt(s.totalRevenue)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className={`w-4 h-4 ${s.collectionsRate >= 90 ? 'text-green-500' : 'text-amber-500'}`} />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Collections</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{s.collectionsRate}%</p>
          <p className="text-xs text-muted-foreground mt-1">{s.paidInvoices}/{s.totalInvoices} invoices paid</p>
        </Card>
        {s.overdueAmount > 0 && (
          <Card className="p-4 border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Overdue</span>
            </div>
            <p className="text-2xl font-bold text-red-600">{fmt(s.overdueAmount)}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.overdueCount} invoice{s.overdueCount !== 1 ? 's' : ''}</p>
          </Card>
        )}
        {s.outstandingAmount > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Outstanding</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{fmt(s.outstandingAmount)}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.outstandingCount} sent, not yet paid</p>
          </Card>
        )}
      </div>

      {/* Revenue Trend Chart */}
      {trends.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-foreground">Monthly Revenue (last 12 months)</h2>
          </div>
          <div className="flex items-end gap-1">
            {trends.map((t) => (
              <MonthBar key={t.month} month={t.month} revenue={t.revenue} maxRevenue={maxRevenue} />
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Client */}
        {byClient.length > 0 && (
          <Card className="p-5">
            <h2 className="font-semibold text-foreground mb-3">Top Clients by Revenue</h2>
            <div className="space-y-3">
              {byClient.slice(0, 8).map((c, i) => (
                <div key={c.clientId} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <Link to={`/client/${c.clientId}`} className="text-sm font-medium text-foreground hover:text-primary truncate">
                        {c.clientName}
                      </Link>
                      <span className="text-sm font-semibold ml-2 shrink-0">{fmt(c.total)}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${(c.total / byClient[0].total) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.invoiceCount} invoices</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Overdue by Client */}
        {Object.keys(overdueByClient).length > 0 && (
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-foreground">Overdue by Client</h2>
              <Link to="/invoice-chaser" className="text-xs text-primary hover:underline flex items-center gap-1">
                Chase <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-3">
              {Object.entries(overdueByClient).map(([clientName, data]) => (
                <div key={clientName} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{clientName}</p>
                    <p className="text-xs text-muted-foreground">{data.count} invoice{data.count !== 1 ? 's' : ''}</p>
                  </div>
                  <span className="text-sm font-semibold text-red-600">{fmt(data.amount)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Active Retainers */}
        {retainers.filter(r => r.clientStatus === 'ACTIVE').length > 0 && (
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-foreground">Active Retainers</h2>
              <Link to="/retainers" className="text-xs text-primary hover:underline">Manage</Link>
            </div>
            <div className="space-y-2">
              {retainers.filter(r => r.clientStatus === 'ACTIVE').map((r, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{r.clientName}</p>
                    <p className="text-xs text-muted-foreground">{r.hoursPerMonth} hrs/mo</p>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{fmt(r.monthlyRate)}/mo</span>
                </div>
              ))}
              <div className="pt-2 border-t border-border mt-2 flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Total MRR</span>
                <span className="text-sm font-bold text-foreground">
                  {fmt(retainers.filter(r => r.clientStatus === 'ACTIVE').reduce((sum, r) => sum + r.monthlyRate, 0))}/mo
                </span>
              </div>
            </div>
          </Card>
        )}
      </div>

      {data?.cached && (
        <p className="text-xs text-muted-foreground text-center">
          Data cached · {data.cacheAge} old · <button onClick={handleRefresh} className="text-primary hover:underline">Refresh</button>
        </p>
      )}
    </div>
  );
}
