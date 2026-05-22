import { Filter, Mail, Target } from 'lucide-react';
import { Card } from '../ui';
import { cn } from '../../lib/utils';

export default function OutreachFunnelWidget({ outreach = {}, coldEmail = {}, linkedIn = {} }) {
  const totalOutreach = Object.values(outreach).reduce((a, b) => a + b, 0);
  const totalColdEmail = Object.values(coldEmail).reduce((a, b) => a + b, 0);
  const totalLinkedIn = Object.values(linkedIn).reduce((a, b) => a + b, 0);

  if (!totalOutreach && !totalColdEmail && !totalLinkedIn) return null;

  const FunnelBar = ({ label, stages, total, colorClass }) => {
    if (!total) return null;
    const max = Math.max(...Object.values(stages).filter(Boolean));
    return (
      <div className="mb-4 last:mb-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{label} ({total})</p>
        <div className="space-y-1.5">
          {Object.entries(stages).map(([stage, count]) => {
            if (!count) return null;
            const pct = (count / max) * 100;
            return (
              <div key={stage} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-16 truncate text-right">{stage}</span>
                <div className="flex-1 h-5 bg-muted rounded-sm overflow-hidden relative">
                  <div
                    className={cn('h-full rounded-sm transition-all duration-500', colorClass)}
                    style={{ width: `${pct}%` }}
                  />
                  <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-bold text-foreground">
                    {count}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Funnel className="w-4 h-4 text-orange-500" />
        <h2 className="font-semibold text-foreground">Outreach Pipeline</h2>
      </div>
      <div className="p-4">
        <FunnelBar label="Outreach" stages={outreach} total={totalOutreach} colorClass="bg-orange-500" />
        <FunnelBar label="Cold Email" stages={coldEmail} total={totalColdEmail} colorClass="bg-blue-500" />
        <FunnelBar label="LinkedIn" stages={linkedIn} total={totalLinkedIn} colorClass="bg-indigo-500" />
      </div>
    </Card>
  );
}
