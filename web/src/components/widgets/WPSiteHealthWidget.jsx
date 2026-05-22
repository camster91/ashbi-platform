import { Globe, ShieldCheck, ShieldAlert, WifiOff } from 'lucide-react';
import { Card } from '../ui';
import { cn } from '../../lib/utils';

export default function WPSiteHealthWidget({ sites = [] }) {
  if (!sites?.length) return null;

  const getHealthColor = (score) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'ACTIVE': return <ShieldCheck className="w-3 h-3 text-emerald-500" />;
      case 'ERROR': return <ShieldAlert className="w-3 h-3 text-red-500" />;
      case 'OFFLINE': return <WifiOff className="w-3 h-3 text-red-500" />;
      default: return <Globe className="w-3 h-3 text-amber-500" />;
    }
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-500" />
          <h2 className="font-semibold text-foreground">Site Health ({sites.length})</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[10px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Good
          </span>
          <span className="flex items-center gap-1 text-[10px]">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Fair
          </span>
          <span className="flex items-center gap-1 text-[10px]">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Poor
          </span>
        </div>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {sites.slice(0, 24).map(site => (
            <a
              key={site.id}
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative p-2 rounded-lg border border-border/60 hover:border-primary/20 hover:bg-muted/30 transition-all"
            >
              <div className="flex items-center gap-2">
                {getStatusIcon(site.status)}
                <span className="text-xs font-medium text-foreground truncate">{site.name}</span>
              </div>
              <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', getHealthColor(site.healthScore))}
                  style={{ width: `${site.healthScore}%` }}
                />
              </div>
              <span className={cn('text-[10px] font-bold mt-0.5 block',
                site.healthScore >= 80 ? 'text-emerald-600' :
                site.healthScore >= 60 ? 'text-amber-600' : 'text-red-600'
              )}>
                {site.healthScore}
              </span>
              {site.client && (
                <span className="text-[10px] text-muted-foreground truncate block">{site.client}</span>
              )}
            </a>
          ))}
        </div>
        {sites.length > 24 && (
          <p className="text-xs text-muted-foreground text-center mt-2">+{sites.length - 24} more sites</p>
        )}
      </div>
    </Card>
  );
}
