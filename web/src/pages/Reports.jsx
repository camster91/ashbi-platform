import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, FileBarChart2, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { Button, Card } from '../components/ui';
import QueryErrorState from '../components/QueryErrorState';

function dateTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleString();
}

export default function Reports() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [clientId, setClientId] = useState('');
  const [retryRequest, setRetryRequest] = useState(null);

  const reportsQuery = useQuery({
    queryKey: ['client-reports'],
    queryFn: () => api.getReports({ limit: 100 }),
  });
  const clientsQuery = useQuery({
    queryKey: ['clients', 'report-generator'],
    queryFn: () => api.getClients({ limit: 200 }).then(result => result?.clients ?? []),
  });

  const generateMutation = useMutation({
    mutationFn: ({ selectedClientId, requestId }) => api.generateWeeklyReport(selectedClientId, requestId),
    onSuccess: (result) => {
      setRetryRequest(null);
      queryClient.invalidateQueries({ queryKey: ['client-reports'] });
      toast.success(result?.reused ? 'Existing report recovered safely' : 'Weekly report generated');
    },
    onError: (_error, variables) => setRetryRequest(variables),
  });

  const reports = reportsQuery.data?.reports ?? [];
  const clients = clientsQuery.data ?? [];

  function generateNew() {
    if (!clientId) return;
    generateMutation.reset();
    generateMutation.mutate({ selectedClientId: clientId, requestId: crypto.randomUUID() });
  }

  function retrySameRequest() {
    if (!retryRequest) return;
    generateMutation.reset();
    generateMutation.mutate(retryRequest);
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <FileBarChart2 aria-hidden="true" className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Client reports</h1>
            <p className="text-sm text-muted-foreground">Generate and review tenant-scoped weekly updates. Nothing is emailed automatically.</p>
          </div>
        </div>
      </header>

      <Card>
        <h2 className="text-lg font-semibold text-foreground">Generate a weekly report</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The draft summarizes the selected client’s active-project activity from the previous seven days.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium text-foreground">
            Client
            <select
              value={clientId}
              onChange={(event) => { setClientId(event.target.value); setRetryRequest(null); generateMutation.reset(); }}
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={clientsQuery.isLoading}
            >
              <option value="">Select a client</option>
              {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          <Button
            type="button"
            onClick={generateNew}
            disabled={!clientId || generateMutation.isPending}
            isLoading={generateMutation.isPending}
            leftIcon={<Sparkles className="h-4 w-4" />}
          >
            Generate report
          </Button>
        </div>
        {generateMutation.isError && (
          <div role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-foreground">
            <p className="font-medium">The report result is unknown or failed.</p>
            <p className="mt-1 text-muted-foreground">Retry the same request to recover an existing result without creating a duplicate.</p>
            <Button type="button" variant="outline" className="mt-3" onClick={retrySameRequest} disabled={!retryRequest || generateMutation.isPending}>
              Retry same request
            </Button>
          </div>
        )}
      </Card>

      <section aria-labelledby="report-history-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="report-history-title" className="text-lg font-semibold text-foreground">Report history</h2>
            <p className="text-sm text-muted-foreground">{reportsQuery.data?.total ?? 0} reports in this workspace</p>
          </div>
          <Button type="button" variant="ghost" onClick={() => reportsQuery.refetch()} disabled={reportsQuery.isFetching} aria-label="Refresh report history">
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${reportsQuery.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} />
            Refresh
          </Button>
        </div>

        {reportsQuery.isLoading ? (
          <Card><div role="status" className="py-10 text-center text-muted-foreground">Loading client reports…</div></Card>
        ) : reportsQuery.isError ? (
          <QueryErrorState
            error={reportsQuery.error}
            message="Client reports could not be loaded"
            onRetry={reportsQuery.refetch}
            isRetrying={reportsQuery.isFetching}
          />
        ) : reports.length === 0 ? (
          <Card className="py-10 text-center">
            <FileBarChart2 aria-hidden="true" className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 font-medium text-foreground">No client reports yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Choose a client above to generate the first internal draft.</p>
          </Card>
        ) : (
          <div className="grid gap-4">
            {reports.map(report => (
              <Card key={report.id}>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{report.client?.name ?? 'Client'}</p>
                    <h3 className="mt-1 text-lg font-semibold text-foreground">{report.subject}</h3>
                    <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock aria-hidden="true" className="h-4 w-4" />
                      Generated {dateTime(report.generatedAt)}
                    </p>
                  </div>
                  <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${report.sentAt ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning-foreground'}`}>
                    {report.sentAt ? <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> : <Clock aria-hidden="true" className="h-3.5 w-3.5" />}
                    {report.sentAt ? `Sent ${dateTime(report.sentAt)}` : 'Internal draft'}
                  </span>
                </div>
                <details className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Read report</summary>
                  <div className="whitespace-pre-wrap border-t border-border pt-3 text-sm leading-6 text-foreground">{report.body}</div>
                </details>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
