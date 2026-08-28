import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw, Rocket, ShieldCheck, XCircle } from 'lucide-react';
import QueryErrorState from '../components/QueryErrorState';
import { Button, LoadingState } from '../components/ui';
import { api } from '../lib/api';

export default function LaunchReadiness() {
  const query = useQuery({
    queryKey: ['unified-launch-readiness'],
    queryFn: api.getUnifiedLaunchReadiness,
    refetchOnWindowFocus: false,
  });

  if (query.isLoading) return <LoadingState label="Evaluating unified launch evidence…" className="min-h-[50vh]" />;
  if (query.isError) return <QueryErrorState error={query.error} message="Launch readiness could not be evaluated" onRetry={query.refetch} isRetrying={query.isFetching} />;

  const report = query.data;
  const passing = report.checks.filter(check => check.ok).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary"><Rocket size={20} /><span className="text-sm font-semibold uppercase tracking-wide">Operating control</span></div>
          <h1 className="mt-1 text-3xl font-bold text-foreground">Unified launch readiness</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Read-only evidence for Ashbi.ca, the Hub, the controlled commercial journey, migration, growth cadence, recovery, and final approval. This screen cannot deploy, import, charge, send, publish, or cancel Bonsai.
          </p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()} loading={query.isFetching} leftIcon={<RefreshCw size={16} />}>Refresh evidence</Button>
      </header>

      <section className={`rounded-xl border p-6 ${report.ready ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/30' : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'}`}>
        <div className="flex items-start gap-4">
          {report.ready ? <ShieldCheck className="mt-1 text-green-700 dark:text-green-300" size={28} /> : <AlertTriangle className="mt-1 text-amber-700 dark:text-amber-300" size={28} />}
          <div>
            <h2 className="text-xl font-semibold text-foreground">{report.ready ? 'Evidence gate passed' : 'Launch remains gated'}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {report.configured ? `${passing} of ${report.checks.length} checks pass.` : 'The owner-controlled evidence manifest is not configured for this Hub environment.'}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="launch-checks-title" className="rounded-xl border border-border bg-card">
        <div className="border-b border-border p-5">
          <h2 id="launch-checks-title" className="text-lg font-semibold text-foreground">Evidence checks</h2>
          <p className="mt-1 text-sm text-muted-foreground">A missing or unreadable artifact stays failed; this page never substitutes an estimate.</p>
        </div>
        <ul className="divide-y divide-border">
          {report.checks.map(check => (
            <li key={check.id} className="flex items-start gap-3 p-5">
              {check.ok ? <CheckCircle2 aria-label="Passed" className="mt-0.5 shrink-0 text-green-600" size={20} /> : <XCircle aria-label="Not passed" className="mt-0.5 shrink-0 text-red-600" size={20} />}
              <div>
                <p className="font-medium text-foreground">{check.id.replaceAll('-', ' ')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{check.message}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
