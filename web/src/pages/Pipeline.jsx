import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Target, FileText, ScrollText, FolderOpen, Receipt, DollarSign,
  ChevronRight, ArrowRight, X, ExternalLink, TrendingUp,
} from 'lucide-react';
import { api } from '../lib/api';
import { Card } from '../components/ui';

function fmt(n) {
  if (n == null) return '--';
  return `$${(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const STAGE_CONFIG = {
  leads: { icon: Target, color: 'from-violet-500 to-purple-600', bg: 'bg-violet-500/10', text: 'text-violet-500', border: 'border-violet-500/30' },
  proposals: { icon: FileText, color: 'from-blue-500 to-cyan-500', bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/30' },
  contracts: { icon: ScrollText, color: 'from-amber-500 to-orange-500', bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/30' },
  projects: { icon: FolderOpen, color: 'from-emerald-500 to-green-600', bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/30' },
  invoiced: { icon: Receipt, color: 'from-pink-500 to-rose-500', bg: 'bg-pink-500/10', text: 'text-pink-500', border: 'border-pink-500/30' },
  paid: { icon: DollarSign, color: 'from-emerald-400 to-teal-500', bg: 'bg-teal-500/10', text: 'text-teal-500', border: 'border-teal-500/30' },
};

const CONVERSION_LABELS = {
  leadToProposal: 'Lead > Proposal',
  proposalToContract: 'Proposal > Contract',
  contractToProject: 'Contract > Project',
  invoiceToPaid: 'Invoice > Paid',
};

export default function Pipeline() {
  const [expandedStage, setExpandedStage] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => api.getPipeline(),
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-foreground">Pipeline</h1>
        <div className="flex items-center justify-center h-64 text-muted-foreground">Loading pipeline data...</div>
      </div>
    );
  }

  const stages = data?.stages || [];
  const rates = data?.conversionRates || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">Track deals from lead to payment</p>
      </div>

      {/* Funnel visualization */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-6 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          Sales Funnel
        </h2>

        {/* Desktop: horizontal funnel */}
        <div className="hidden lg:block">
          <div className="flex items-stretch gap-0">
            {stages.map((stage, i) => {
              const config = STAGE_CONFIG[stage.key] || STAGE_CONFIG.leads;
              const Icon = config.icon;
              const isExpanded = expandedStage === stage.key;

              return (
                <div key={stage.key} className="flex items-stretch flex-1">
                  <button
                    onClick={() => setExpandedStage(isExpanded ? null : stage.key)}
                    className={`flex-1 relative p-4 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] ${
                      isExpanded ? `${config.border} shadow-lg` : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${config.color} flex items-center justify-center mx-auto mb-2`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground font-medium">{stage.label}</p>
                      <p className="text-2xl font-bold text-foreground mt-0.5">{stage.count}</p>
                      {stage.value != null && (
                        <p className={`text-sm font-semibold ${config.text} mt-0.5`}>{fmt(stage.value)}</p>
                      )}
                    </div>
                  </button>
                  {i < stages.length - 1 && (
                    <div className="flex items-center px-1">
                      <ArrowRight className="w-4 h-4 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Mobile: vertical funnel */}
        <div className="lg:hidden space-y-3">
          {stages.map((stage, i) => {
            const config = STAGE_CONFIG[stage.key] || STAGE_CONFIG.leads;
            const Icon = config.icon;
            const isExpanded = expandedStage === stage.key;
            // Width decreases through funnel for visual effect
            const widthPct = 100 - (i * 6);

            return (
              <div key={stage.key} style={{ width: `${widthPct}%` }} className="mx-auto">
                <button
                  onClick={() => setExpandedStage(isExpanded ? null : stage.key)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                    isExpanded ? `${config.border} shadow-lg` : 'border-border'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${config.color} flex items-center justify-center shrink-0`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-xs text-muted-foreground">{stage.label}</p>
                    <p className="text-lg font-bold text-foreground">{stage.count}</p>
                  </div>
                  {stage.value != null && (
                    <p className={`text-sm font-semibold ${config.text}`}>{fmt(stage.value)}</p>
                  )}
                  <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Expanded stage items */}
      {expandedStage && (
        <StageDetail
          stage={stages.find(s => s.key === expandedStage)}
          config={STAGE_CONFIG[expandedStage]}
          onClose={() => setExpandedStage(null)}
        />
      )}

      {/* Conversion Rates */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Conversion Rates (All-Time)</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(CONVERSION_LABELS).map(([key, label]) => {
            const rate = rates[key] || 0;
            return (
              <div key={key} className="text-center p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className={`text-xl font-bold ${rate >= 50 ? 'text-emerald-500' : rate >= 25 ? 'text-amber-500' : 'text-red-400'}`}>
                  {rate}%
                </p>
                <div className="w-full h-1.5 bg-muted rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${rate >= 50 ? 'bg-emerald-500' : rate >= 25 ? 'bg-amber-500' : 'bg-red-400'}`}
                    style={{ width: `${Math.min(rate, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function StageDetail({ stage, config, onClose }) {
  if (!stage) return null;
  const Icon = config?.icon || Target;

  const linkFor = (item) => {
    switch (stage.key) {
      case 'leads': return null;
      case 'proposals': return `/proposal/${item.id}`;
      case 'contracts': return `/contracts`;
      case 'projects': return `/project/${item.id}`;
      case 'invoiced':
      case 'paid': return `/invoices/${item.id}`;
      default: return null;
    }
  };

  const nameFor = (item) => {
    if (item.name) return item.name;
    if (item.title) return item.title;
    if (item.invoiceNumber) return item.invoiceNumber;
    return 'Unnamed';
  };

  return (
    <Card className={`p-6 border-2 ${config?.border || 'border-border'}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Icon className={`w-5 h-5 ${config?.text || 'text-primary'}`} />
          {stage.label} ({stage.count})
          {stage.value != null && <span className={`text-sm font-normal ${config?.text}`}> -- {fmt(stage.value)}</span>}
        </h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {!stage.items?.length ? (
        <p className="text-sm text-muted-foreground">No items in this stage</p>
      ) : (
        <div className="space-y-2">
          {stage.items.map((item, i) => {
            const link = linkFor(item);
            const name = nameFor(item);
            const Wrapper = link ? Link : 'div';
            const wrapperProps = link ? { to: link } : {};

            return (
              <Wrapper
                key={item.id || i}
                {...wrapperProps}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {item.clientName && <span>{item.clientName}</span>}
                    {item.status && <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{item.status}</span>}
                    {item.company && <span>{item.company}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(item.total != null || item.budget != null) && (
                    <span className={`text-sm font-semibold ${config?.text || 'text-foreground'}`}>
                      {fmt(item.total ?? item.budget)}
                    </span>
                  )}
                  {link && <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />}
                </div>
              </Wrapper>
            );
          })}
        </div>
      )}
    </Card>
  );
}
