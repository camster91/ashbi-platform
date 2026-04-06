import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DollarSign, TrendingUp, TrendingDown, Receipt, Users, Clock,
  ChevronDown, Calendar, BarChart3,
} from 'lucide-react';
import { api } from '../lib/api';
import { Card } from '../components/ui';

function fmt(n) {
  return `$${(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n) {
  return `${(n || 0).toFixed(1)}%`;
}

const PRESETS = [
  { label: 'This Month', getRange: () => {
    const now = new Date();
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  }},
  { label: 'Last Month', getRange: () => {
    const now = new Date();
    return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0) };
  }},
  { label: 'This Quarter', getRange: () => {
    const now = new Date();
    const q = Math.floor(now.getMonth() / 3);
    return { start: new Date(now.getFullYear(), q * 3, 1), end: now };
  }},
  { label: 'This Year', getRange: () => {
    const now = new Date();
    return { start: new Date(now.getFullYear(), 0, 1), end: now };
  }},
  { label: 'Last Year', getRange: () => {
    const now = new Date();
    return { start: new Date(now.getFullYear() - 1, 0, 1), end: new Date(now.getFullYear() - 1, 11, 31) };
  }},
];

function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

export default function Reports() {
  const [presetIdx, setPresetIdx] = useState(0);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [useCustom, setUseCustom] = useState(false);

  const dateRange = useMemo(() => {
    if (useCustom && customStart && customEnd) {
      return { start: new Date(customStart), end: new Date(customEnd) };
    }
    return PRESETS[presetIdx].getRange();
  }, [presetIdx, useCustom, customStart, customEnd]);

  const startStr = toDateStr(dateRange.start);
  const endStr = toDateStr(dateRange.end);

  const { data: pnl, isLoading: pnlLoading } = useQuery({
    queryKey: ['reports-pnl', startStr, endStr],
    queryFn: () => api.getReportsPnl({ startDate: startStr, endDate: endStr }),
  });

  const { data: profitability, isLoading: profLoading } = useQuery({
    queryKey: ['reports-profitability'],
    queryFn: () => api.getClientProfitability(),
  });

  const { data: utilization, isLoading: utilLoading } = useQuery({
    queryKey: ['reports-utilization', startStr, endStr],
    queryFn: () => api.getTeamUtilization({ startDate: startStr, endDate: endStr }),
  });

  const maxMonthlyVal = useMemo(() => {
    if (!pnl?.byMonth?.length) return 1;
    return Math.max(...pnl.byMonth.map(m => Math.max(m.revenue, m.expenses))) || 1;
  }, [pnl]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Financial Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">P&L, client profitability, and team utilization</p>
        </div>

        {/* Date range selector */}
        <div className="flex items-center gap-2 flex-wrap">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => { setPresetIdx(i); setUseCustom(false); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                !useCustom && presetIdx === i
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:border-primary/50'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={customStart}
              onChange={e => { setCustomStart(e.target.value); setUseCustom(true); }}
              className="px-2 py-1.5 text-xs rounded-lg border border-border bg-card text-foreground"
            />
            <span className="text-muted-foreground text-xs">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => { setCustomEnd(e.target.value); setUseCustom(true); }}
              className="px-2 py-1.5 text-xs rounded-lg border border-border bg-card text-foreground"
            />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Revenue"
          value={fmt(pnl?.totalRevenue)}
          icon={DollarSign}
          color="text-emerald-500"
          bgColor="bg-emerald-500/10"
          loading={pnlLoading}
        />
        <SummaryCard
          label="Expenses"
          value={fmt(pnl?.totalExpenses)}
          icon={TrendingDown}
          color="text-red-500"
          bgColor="bg-red-500/10"
          loading={pnlLoading}
        />
        <SummaryCard
          label="Profit"
          value={fmt(pnl?.profit)}
          icon={TrendingUp}
          color={pnl?.profit >= 0 ? 'text-emerald-500' : 'text-red-500'}
          bgColor={pnl?.profit >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}
          loading={pnlLoading}
        />
        <SummaryCard
          label="HST Collected"
          value={fmt(pnl?.totalTax)}
          icon={Receipt}
          color="text-blue-500"
          bgColor="bg-blue-500/10"
          loading={pnlLoading}
        />
      </div>

      {/* Monthly Chart */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          Monthly Revenue vs Expenses
        </h2>
        {pnlLoading ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
        ) : !pnl?.byMonth?.length ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data for this period</div>
        ) : (
          <div className="space-y-3">
            {pnl.byMonth.map(m => (
              <div key={m.month} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium w-20">{m.month}</span>
                  <span>Profit: {fmt(m.profit)}</span>
                </div>
                <div className="flex gap-1 items-center">
                  <div className="flex-1 h-5 bg-muted rounded-md overflow-hidden relative">
                    <div
                      className="absolute inset-y-0 left-0 bg-emerald-500 rounded-md transition-all"
                      style={{ width: `${(m.revenue / maxMonthlyVal) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono w-24 text-right text-emerald-600">{fmt(m.revenue)}</span>
                </div>
                <div className="flex gap-1 items-center">
                  <div className="flex-1 h-5 bg-muted rounded-md overflow-hidden relative">
                    <div
                      className="absolute inset-y-0 left-0 bg-red-400 rounded-md transition-all"
                      style={{ width: `${(m.expenses / maxMonthlyVal) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono w-24 text-right text-red-500">{fmt(m.expenses)}</span>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> Revenue</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400 inline-block" /> Expenses</span>
            </div>
          </div>
        )}
      </Card>

      {/* Client Profitability */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Client Profitability
        </h2>
        {profLoading ? (
          <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
        ) : !profitability?.length ? (
          <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">No client data</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Client</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Revenue</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Hours</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Expenses</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Profit</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">$/hr</th>
                </tr>
              </thead>
              <tbody>
                {profitability.map(c => (
                  <tr key={c.clientId} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                    <td className="py-2 px-3 font-medium text-foreground">{c.clientName}</td>
                    <td className="py-2 px-3 text-right text-emerald-600">{fmt(c.revenue)}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{c.billableHours}h</td>
                    <td className="py-2 px-3 text-right text-red-500">{fmt(c.expenses)}</td>
                    <td className={`py-2 px-3 text-right font-medium ${c.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {fmt(c.profit)}
                    </td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{fmt(c.effectiveHourlyRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Team Utilization */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          Team Utilization
        </h2>
        {utilLoading ? (
          <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
        ) : !utilization?.team?.length ? (
          <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">No team data</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Team Member</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Total Hours</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Billable</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Utilization</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {utilization.team.map(u => (
                  <tr key={u.userId} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                    <td className="py-2 px-3">
                      <div className="font-medium text-foreground">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{u.totalHours}h</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{u.billableHours}h</td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${u.utilizationRate >= 80 ? 'bg-emerald-500' : u.utilizationRate >= 50 ? 'bg-amber-500' : 'bg-red-400'}`}
                            style={{ width: `${Math.min(u.utilizationRate, 100)}%` }}
                          />
                        </div>
                        <span className="font-medium text-foreground">{pct(u.utilizationRate)}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right text-emerald-600">{fmt(u.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 text-xs text-muted-foreground">
              Period: {utilization.workingDays} working days | Capacity: {utilization.capacityHoursPerPerson}h per person
            </div>
          </div>
        )}
      </Card>

      {/* P&L by Client (from PNL data) */}
      {pnl?.byClient?.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" />
            P&L by Client ({PRESETS[presetIdx]?.label || 'Custom'})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Client</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Revenue</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Tax</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Expenses</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Profit</th>
                </tr>
              </thead>
              <tbody>
                {pnl.byClient.map(c => (
                  <tr key={c.clientId} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                    <td className="py-2 px-3 font-medium text-foreground">{c.clientName}</td>
                    <td className="py-2 px-3 text-right text-emerald-600">{fmt(c.revenue)}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{fmt(c.tax)}</td>
                    <td className="py-2 px-3 text-right text-red-500">{fmt(c.expenses)}</td>
                    <td className={`py-2 px-3 text-right font-medium ${c.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {fmt(c.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, color, bgColor, loading }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg ${bgColor} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          {loading ? (
            <div className="h-6 w-20 bg-muted animate-pulse rounded mt-0.5" />
          ) : (
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          )}
        </div>
      </div>
    </Card>
  );
}
