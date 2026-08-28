import { useEffect, useMemo, useState } from 'react';
import { Check, Download, FileJson, GitMerge, RefreshCw, X } from 'lucide-react';
import QueryErrorState from '../components/QueryErrorState';
import { Button, LoadingState } from '../components/ui';
import { api } from '../lib/api';

const decisionStyles = {
  APPROVED: 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300',
  REJECTED: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300',
  PENDING: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
};

const taskDispositionKind = 'NOTION_BONSAI_TASK_DISPOSITION';
const projectDispositionKind = 'NOTION_BONSAI_PROJECT_DISPOSITION';
const financialExceptionKind = 'BONSAI_FINANCIAL_EXCEPTION';
const activeProjectOutcomeKind = 'BONSAI_ACTIVE_PROJECT_OUTCOME';

function packetLabel(packet) {
  if (packet.kind === taskDispositionKind) return 'Task disposition review';
  if (packet.kind === projectDispositionKind) return 'Project disposition review';
  if (packet.kind === financialExceptionKind) return 'Financial exception review';
  if (packet.kind === activeProjectOutcomeKind) return 'Active project outcome review';
  return 'Project identity review';
}

function downloadJson(value, name) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function MigrationReviews() {
  const [packets, setPackets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [filter, setFilter] = useState('PENDING');
  const [failedAction, setFailedAction] = useState(null);

  const selected = packets.find(packet => packet.id === selectedId) ?? packets[0] ?? null;
  const candidates = useMemo(() => {
    const rows = selected?.candidates ?? [];
    return filter ? rows.filter(candidate => candidate.decision === filter) : rows;
  }, [selected, filter]);

  const load = async () => {
    setLoadError(null);
    try {
      const response = await api.getMigrationReviewPackets();
      setPackets(response.packets ?? []);
      setSelectedId(current => current ?? response.packets?.[0]?.id ?? null);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const importBundle = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusyKey('import');
    setActionError('');
    try {
      const parsed = JSON.parse(await file.text());
      const payload = { ...parsed, requestId: parsed.requestId || crypto.randomUUID() };
      let response;
      if (parsed.format === 'ashbi-hub-task-disposition-review-import') {
        response = await api.importTaskDispositionReview(payload);
      } else if (parsed.format === 'ashbi-hub-project-disposition-review-import') {
        response = await api.importProjectDispositionReview(payload);
      } else if (parsed.format === 'ashbi-hub-financial-exception-review-import') {
        response = await api.importFinancialExceptionReview(payload);
      } else if (parsed.format === 'ashbi-hub-active-project-outcome-review-import') {
        response = await api.importActiveProjectOutcomeReview(payload);
      } else {
        response = await api.importProjectLinkReview(payload);
      }
      await load();
      setSelectedId(response.packet.id);
    } catch (error) {
      setActionError(error.message || 'The evidence bundle could not be imported.');
    } finally {
      setBusyKey('');
    }
  };

  const runDecision = async (action) => {
    setBusyKey(action.candidateId);
    setActionError('');
    try {
      const response = await api.recordMigrationReviewDecision(action.packetId, action.candidateId, {
        requestId: action.requestId,
        decision: action.decision,
        reviewNote: action.reviewNote ?? null,
      });
      setPackets(current => current.map(packet => packet.id === response.packet.id ? response.packet : packet));
      setFailedAction(null);
    } catch (error) {
      setActionError(error.message || 'The decision could not be recorded.');
      setFailedAction(action);
    } finally {
      setBusyKey('');
    }
  };

  const decide = (candidate, decision) => runDecision({
    packetId: selected.id,
    candidateId: candidate.candidateId,
    requestId: crypto.randomUUID(),
    decision,
    reviewNote: null,
  });

  const exportDecision = async () => {
    setBusyKey('export');
    setActionError('');
    try {
      const record = await api.exportMigrationReviewDecision(selected.id);
      const prefix = selected.kind === taskDispositionKind
        ? 'task-disposition-decision'
        : selected.kind === projectDispositionKind
        ? 'project-disposition-decision'
        : selected.kind === financialExceptionKind
        ? 'financial-exception-decision'
        : selected.kind === activeProjectOutcomeKind ? 'active-project-outcome-decision' : 'project-link-decision';
      downloadJson(record, `${prefix}-${selected.id}.json`);
    } catch (error) {
      setActionError(error.message || 'The decision record could not be exported.');
    } finally {
      setBusyKey('');
    }
  };

  if (loading) return <LoadingState label="Loading migration reviews…" className="min-h-[50vh]" />;
  if (loadError) return <QueryErrorState error={loadError} message="Migration reviews could not be loaded" onRetry={load} />;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary"><GitMerge size={20} /><span className="text-sm font-semibold uppercase tracking-wide">Migration control</span></div>
          <h1 className="mt-1 text-3xl font-bold text-foreground">Notion + Bonsai reviews</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Review evidence-bound project identities, project and task dispositions, active-project outcomes, and financial exceptions. Decisions stay inside the Hub and do not edit Notion, Bonsai, projects, tasks, owners, invoices, payments, time entries, or contracts—and never close or archive a project.
          </p>
        </div>
        <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-within:ring-2 focus-within:ring-ring">
          <FileJson size={16} /> {busyKey === 'import' ? 'Importing…' : 'Import verified bundle'}
          <input type="file" accept="application/json,.json" className="sr-only" onChange={importBundle} disabled={Boolean(busyKey)} />
        </label>
      </header>

      {actionError && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          <p>{actionError}</p>
          {failedAction && <Button variant="outline" className="mt-3" onClick={() => runDecision(failedAction)} disabled={Boolean(busyKey)} leftIcon={<RefreshCw size={15} />}>Retry same request</Button>}
        </div>
      )}

      {packets.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <FileJson className="mx-auto text-muted-foreground" size={38} />
          <h2 className="mt-3 font-semibold text-foreground">No verified review packet imported</h2>
          <p className="mt-1 text-sm text-muted-foreground">Import a checksum-bound project-link, project-disposition, task-disposition, active-project-outcome, or financial-exception review bundle. Importing it records evidence only.</p>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <aside className="space-y-2">
            {packets.map(packet => (
              <button key={packet.id} type="button" onClick={() => setSelectedId(packet.id)} className={`w-full rounded-xl border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === packet.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/40'}`}>
                <p className="text-sm font-semibold text-foreground">{packetLabel(packet)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Generation {packet.generation} of {packet.generationCount} · {new Date(packet.sourcePreparedAt).toLocaleString()}</p>
                {packet.superseded && <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">Superseded · read-only</p>}
                <p className="mt-3 text-xs text-muted-foreground">{packet.summary.approved} approved · {packet.summary.rejected} rejected · {packet.summary.pending} pending</p>
              </button>
            ))}
          </aside>

          <main className="space-y-4">
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{packetLabel(selected)}</h2>
                  <p className="mt-1 text-xs font-medium text-muted-foreground">Generation {selected.generation} of {selected.generationCount}{selected.superseded ? ' · superseded and read-only' : ' · current generation'}</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">Source SHA-256: {selected.sourceReviewSha256}</p>
                </div>
                <Button variant="outline" onClick={exportDecision} loading={busyKey === 'export'} leftIcon={<Download size={16} />}>Export decision record</Button>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                {['approved', 'rejected', 'pending'].map(key => <div key={key} className="rounded-lg bg-muted p-3"><p className="text-xl font-bold text-foreground">{selected.summary[key]}</p><p className="text-xs capitalize text-muted-foreground">{key}</p></div>)}
              </div>
            </section>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter candidates by decision">
              {[['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['', 'All']].map(([value, label]) => (
                <Button key={label} size="sm" variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>{label}</Button>
              ))}
            </div>

            {candidates.length === 0 ? <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">No candidates match this filter.</p> : candidates.map(candidate => (
              <article key={candidate.candidateId} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${decisionStyles[candidate.decision]}`}>{candidate.decision}</span>
                      {candidate.tier && <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">{candidate.tier}</span>}
                      {candidate.risk && <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">{candidate.risk} risk</span>}
                      {candidate.sourceKind && <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">{candidate.sourceKind.replaceAll('_', ' ')}</span>}
                      {candidate.exceptionKind && <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">{candidate.exceptionKind.replaceAll('_', ' ')}</span>}
                    </div>
                    {selected.kind === taskDispositionKind ? (
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Source task</p>
                        <p className="mt-1 font-medium text-foreground">{candidate.title}</p>
                        <p className="text-xs text-muted-foreground">{candidate.project} · {candidate.lifecycleState}</p>
                        {candidate.owner && <p className="mt-1 text-xs text-muted-foreground">Recorded owner: {candidate.owner}</p>}
                        {candidate.sourceReviewFields?.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Repair fields: {candidate.sourceReviewFields.join(', ')}</p>}
                      </div>
                    ) : selected.kind === projectDispositionKind ? (
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Source project</p>
                        <p className="mt-1 font-medium text-foreground">{candidate.project}</p>
                        <p className="text-xs text-muted-foreground">{candidate.company || 'No recorded client'} · {candidate.status || 'Duplicate title group'}</p>
                        {candidate.duplicateMembers?.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {candidate.duplicateMembers.map(member => <li key={member.bonsaiProjectId}>Bonsai {member.bonsaiProjectId} · {member.company || 'No client'} · {member.status}</li>)}
                          </ul>
                        )}
                      </div>
                    ) : selected.kind === activeProjectOutcomeKind ? (
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Active Bonsai project</p>
                        <p className="mt-1 font-medium text-foreground">{candidate.project}</p>
                        <p className="text-xs text-muted-foreground">{candidate.company || 'No recorded client'} · {candidate.projectGroup?.name || 'No group'} · {candidate.taskCount} current task(s)</p>
                        <p className="mt-1 text-xs text-muted-foreground">{candidate.triageBucket?.replaceAll('_', ' ')}</p>
                        <p className="mt-2 text-xs text-muted-foreground">Invoices: {candidate.financialEvidence?.invoiceCount ?? 0} total / {candidate.financialEvidence?.nonPaidInvoiceCount ?? 0} non-paid · time: {candidate.financialEvidence?.timeEntryCount ?? 0} total / {candidate.financialEvidence?.unbilledEntryCount ?? 0} unbilled</p>
                        {candidate.financialEvidence?.attentionReasons?.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Financial review: {candidate.financialEvidence.attentionReasons.join(' · ').replaceAll('_', ' ')}</p>}
                      </div>
                    ) : selected.kind === financialExceptionKind ? (
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Source financial exception</p>
                        {candidate.exceptionKind === 'NON_PAID_INVOICE' && <>
                          <p className="mt-1 font-medium text-foreground">Invoice {candidate.invoiceNumber || candidate.sourceId}</p>
                          <p className="text-xs text-muted-foreground">{candidate.company || 'No recorded client'} · {candidate.status} · {candidate.amount} {candidate.currency}</p>
                          <p className="text-xs text-muted-foreground">Invoice date {candidate.date || 'not recorded'} · due {candidate.dueDate || 'not recorded'}</p>
                        </>}
                        {candidate.exceptionKind === 'UNBILLED_TIME_ENTRY' && <>
                          <p className="mt-1 font-medium text-foreground">Unbilled time entry {candidate.sourceId}</p>
                          <p className="text-xs text-muted-foreground">{candidate.seconds} seconds · {candidate.status} · {candidate.linkageState?.replaceAll('_', ' ')}</p>
                          <p className="text-xs text-muted-foreground">Project {candidate.projectId || 'not linked'}</p>
                        </>}
                        {candidate.exceptionKind === 'ACTIVE_PROJECT_CONTRACT_GAP' && <>
                          <p className="mt-1 font-medium text-foreground">{candidate.project}</p>
                          <p className="text-xs text-muted-foreground">{candidate.company || 'No recorded client'} · {candidate.status || 'active'} · contract evidence required</p>
                        </>}
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-border p-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Notion</p><p className="mt-1 font-medium text-foreground">{candidate.notionProject}</p><p className="text-xs text-muted-foreground">{candidate.notionStatus}</p></div>
                        <div className="rounded-lg border border-border p-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Bonsai</p><p className="mt-1 font-medium text-foreground">{candidate.bonsaiProject}</p><p className="text-xs text-muted-foreground">{candidate.bonsaiStatus}</p></div>
                      </div>
                    )}
                    {candidate.sourceEvidence && <p className="text-sm text-muted-foreground">{candidate.sourceEvidence}</p>}
                    <p className="text-xs text-muted-foreground">Recommendation: {candidate.recommendation?.replaceAll('_', ' ')} · {candidate.reasonCode?.replaceAll('_', ' ')}</p>
                    {candidate.recommendedDisposition && <p className="text-xs font-medium text-foreground">Proposed disposition: {candidate.recommendedDisposition.replaceAll('_', ' ')}</p>}
                    {candidate.recommendedOutcome && <p className="text-xs font-medium text-foreground">Proposed active outcome: {candidate.recommendedOutcome.replaceAll('_', ' ')}</p>}
                    {candidate.prerequisites?.length > 0 && <p className="text-xs text-muted-foreground">Prerequisites: {candidate.prerequisites.join(' · ').replaceAll('_', ' ')}</p>}
                    {candidate.reviewedBy && <p className="text-xs text-muted-foreground">Last reviewed by {candidate.reviewedBy} on {new Date(candidate.decidedAt).toLocaleString()}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      onClick={() => decide(candidate, 'APPROVED')}
                      loading={busyKey === candidate.candidateId}
                      disabled={Boolean(busyKey) || selected.superseded || candidate.recommendation !== 'APPROVAL_READY'}
                      leftIcon={<Check size={16} />}
                    >
                      {selected.superseded
                        ? 'Superseded generation'
                        : candidate.recommendation !== 'APPROVAL_READY'
                        ? 'Blocked by prerequisite'
                        : selected.kind === taskDispositionKind || selected.kind === projectDispositionKind || selected.kind === financialExceptionKind || selected.kind === activeProjectOutcomeKind ? 'Approve recommendation' : 'Approve identity'}
                    </Button>
                    <Button variant="destructive" onClick={() => decide(candidate, 'REJECTED')} disabled={Boolean(busyKey) || selected.superseded} leftIcon={<X size={16} />}>Reject</Button>
                  </div>
                </div>
              </article>
            ))}
          </main>
        </div>
      )}
    </div>
  );
}
