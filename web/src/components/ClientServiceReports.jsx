import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import Button from './ui/Button';
import Input, { inputStyles } from './ui/Input';

function DateValue({ value }) {
  const date = value && new Date(value);
  return date && !Number.isNaN(date.getTime()) ? <time dateTime={value}>{date.toLocaleString()}</time> : 'Not available';
}

function MappingControls({ clientId, mapping, refreshed, user }) {
  const credentials = useQuery({ queryKey: ['client-service-credentials', user.organizationId, user.id, clientId], queryFn: () => api.getClientServiceCredentials(clientId), retry: false, refetchOnWindowFocus: false });
  const [credentialId, setCredentialId] = useState(mapping.credentialId ?? '');
  const [label, setLabel] = useState(mapping.displayLabel);
  const [enabled, setEnabled] = useState(mapping.enabled);
  const [reportId, setReportId] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [sourceReportedAt, setSourceReportedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function save(operation, refresh = false) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice('');
    try { const result = await operation(); if (alive.current) { setNotice(refresh ? result?.outcome === 'UNAVAILABLE' ? 'OpenSEO is unavailable. Saved reports were retained.' : result?.outcome === 'EMPTY' ? 'OpenSEO returned no reports. Saved reports were retained.' : result?.outcome === 'OK' ? 'Existing OpenSEO reports were read. The result is partial; other saved reports were retained.' : 'The refresh result could not be verified. Reload saved reports.' : 'Saved.'); await refreshed(); } }
    catch (error) { if (alive.current) setNotice(error.status === 409 ? 'The mapping changed. Reload saved reports before trying again.' : 'The update could not be confirmed. Reload saved reports to check its status.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <details className="mt-3 rounded-lg border border-border p-3"><summary className="min-h-11 cursor-pointer">Manage saved reports</summary>
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save(() => api.updateClientServiceMapping(clientId, mapping.id, { revision: mapping.revision, displayLabel: label.trim(), enabled, ...(credentialId !== (mapping.credentialId ?? '') ? { credentialId: credentialId || null } : {}) })); }}>
      <label className="block">Mapping label<Input required maxLength={100} value={label} disabled={busy} onChange={(event) => setLabel(event.target.value)} /></label>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} />Show this mapping to staff</label>
      <label className="block">OpenSEO public proxy Basic credential<select className={inputStyles()} value={credentialId} disabled={busy || credentials.isError} onChange={event => setCredentialId(event.target.value)}><option value="">Not configured</option>{(credentials.data?.credentials ?? []).map(credential => <option key={credential.id} value={credential.id}>{credential.label}</option>)}</select></label>
      <p className="text-sm text-muted-foreground">Select a client-owned vault login for the public OpenSEO proxy. Its declared URL must be on https://openseo.ashbi.ca. Passwords and usernames are never shown here.</p>
      {credentials.isError && <p role="alert">Credential choices are unavailable. Reload before changing the binding.</p>}
      {credentials.isError && <Button type="button" variant="outline" disabled={credentials.isFetching} onClick={() => credentials.refetch()}>Reload credential choices</Button>}
      {credentials.data?.truncated && <p role="status">Credential choices are limited to the first 100 client entries.</p>}
      <Button type="submit" disabled={busy || !label.trim()}>Save mapping</Button>
    </form>
    {mapping.enabled && <div className="mt-4 space-y-2"><Button type="button" disabled={busy || !mapping.refreshConfigured} onClick={() => save(() => api.refreshClientServiceReports(clientId, mapping.id, { mappingRevision: mapping.revision }), true)}>Refresh saved reports from OpenSEO</Button><p className="text-sm text-muted-foreground">Explicitly reads one bounded page of existing reports only. It does not run research or remove saved reports. A client-owned public proxy credential must be bound first.</p></div>}
    {mapping.enabled && <form className="mt-4 space-y-3" onSubmit={(event) => {
      event.preventDefault();
      save(() => api.publishClientServiceSnapshot(clientId, mapping.id, { mappingRevision: mapping.revision, providerProjectIdMatch: mapping.providerProjectId, outcome: 'OK', complete: false, failureCode: null, reports: [{ providerReportId: reportId.trim(), title: title.trim(), summary: summary.trim(), sourceReportedAt: sourceReportedAt ? new Date(`${sourceReportedAt}Z`).toISOString() : null }] }));
    }}>
      <p className="text-sm text-muted-foreground">Publish one report snapshot into Hub. This adds or updates its report identifier and keeps other saved reports. This manual publication does not fetch OpenSEO or run paid research.</p>
      <p className="text-sm">Destination: {mapping.displayLabel}  -  OpenSEO project {mapping.providerProjectId}</p>
      <label className="block">Source report identifier<Input required pattern="[a-zA-Z0-9_-]+" maxLength={100} value={reportId} disabled={busy} onChange={(event) => setReportId(event.target.value)} /></label>
      <label className="block">Report title<Input required maxLength={200} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="block">Report summary<textarea className={inputStyles('min-h-28')} required maxLength={4000} value={summary} disabled={busy} onChange={(event) => setSummary(event.target.value)} /></label>
      <label className="block">Source reported time (UTC)<input className={inputStyles()} type="datetime-local" value={sourceReportedAt} disabled={busy} onChange={(event) => setSourceReportedAt(event.target.value ? `${event.target.value}` : '')} /></label>
      <Button type="submit" disabled={busy || !reportId.trim() || !title.trim() || !summary.trim()}>Publish saved report</Button>
    </form>}
    {notice && <p role={notice === 'Saved.' ? 'status' : 'alert'}>{notice}</p>}
  </details>;
}

function NewMapping({ clientId, refreshed }) {
  const [displayLabel, setLabel] = useState('');
  const [providerProjectId, setProject] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return <details className="rounded-lg border border-border p-3"><summary className="min-h-11 cursor-pointer">Add OpenSEO mapping</summary>
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault(); if (pending.current) return;
      pending.current = true; setBusy(true); setNotice('');
      try { await api.createClientServiceMapping(clientId, { provider: 'OPENSEO', providerProjectId: providerProjectId.trim(), displayLabel: displayLabel.trim() }); if (alive.current) { setLabel(''); setProject(''); setNotice('Mapping saved.'); await refreshed(); } }
      catch { if (alive.current) setNotice('The mapping could not be confirmed. Reload saved reports before adding it again.'); }
      finally { pending.current = false; if (alive.current) setBusy(false); }
    }}>
      <p className="text-sm text-muted-foreground">Match this client to an existing OpenSEO project identifier. Adding a mapping does not fetch reports.</p>
      <label className="block">New mapping label<Input value={displayLabel} required maxLength={100} disabled={busy} onChange={(event) => setLabel(event.target.value)} /></label>
      <label className="block">OpenSEO project identifier<Input value={providerProjectId} required pattern="[a-zA-Z0-9_-]+" maxLength={100} disabled={busy} onChange={(event) => setProject(event.target.value)} /></label>
      <Button type="submit" disabled={busy || !displayLabel.trim() || !providerProjectId.trim()}>Save new mapping</Button>
    </form>
    {notice && <p role={notice === 'Mapping saved.' ? 'status' : 'alert'}>{notice}</p>}
  </details>;
}

export default function ClientServiceReports({ clientId, user }) {
  const query = useQuery({ queryKey: ['client-service-panels', user.organizationId, user.id, user.role, clientId], queryFn: () => api.getClientServicePanels(clientId), retry: false, refetchOnWindowFocus: false });
  const data = !query.isError && query.data?.clientId === clientId ? query.data : null;
  return <div className="mt-3 space-y-4">
    <p className="text-sm text-muted-foreground">Saved reports stored in Hub, from staff publication or an explicit admin refresh. Loading this view does not fetch external reports.</p>
    <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}>Reload saved reports</Button>
    {query.isPending && <p role="status">Loading saved reports - </p>}
    {query.isError && <p role="alert">Saved reports are unavailable. Reload to try again.</p>}
    {data?.projects.length === 0 && <p role="status">No service project mappings have been saved for this client.</p>}
    {data?.hasMoreProjects && <p role="status">Only the first 50 mappings are shown. Additional mappings are omitted.</p>}
    {data?.projects.map((mapping) => <section key={mapping.id} className="rounded-lg border border-border p-3" aria-label={mapping.displayLabel}>
      <h3 className="font-medium">{mapping.displayLabel}</h3>
      <p className="text-sm">OpenSEO project {mapping.providerProjectId}{!mapping.enabled ? '  -  Hidden from staff' : ''}</p>
      {mapping.status === 'never-fetched' && <p role="status">No snapshot has been published for this mapping.</p>}
      {mapping.status === 'empty' && <p role="status">{mapping.refreshOutcome === 'EMPTY' && mapping.lastRefreshedAt === mapping.lastAttemptAt ? 'No saved reports are available; the last bounded provider read returned none.' : 'The last complete snapshot contained no reports.'}</p>}
      {mapping.status === 'unavailable' && <p role="status">The latest report attempt was unavailable.{mapping.reports.length ? ' Showing retained last-good reports.' : ' No saved reports are available.'}</p>}
      {mapping.stale && mapping.lastSuccessAt && <p role="status">Saved reports are stale: the last successful snapshot was stored more than {data.staleAfterHours} hours ago.</p>}
      {mapping.sourceFreshness === 'unknown' && <p className="text-sm text-muted-foreground">{mapping.hasMoreReports ? 'Additional reports are omitted, so the newest source date and mapping freshness cannot be verified from this selection.' : 'The source report date is unknown; freshness cannot be verified.'}</p>}
      {mapping.sourceFreshness === 'stale' && <p role="status">The source report date is older than {data.staleAfterHours} hours. A recent Hub save does not make the source report current.</p>}
      <p className="text-xs text-muted-foreground">Last Hub attempt: <DateValue value={mapping.lastAttemptAt} />  -  Last successful Hub save/read: <DateValue value={mapping.lastSuccessAt} /></p>
      {mapping.lastRefreshedAt && <p role="status">Last OpenSEO read: <DateValue value={mapping.lastRefreshedAt} /> - {mapping.refreshOutcome === 'UNAVAILABLE' ? 'Unavailable; saved reports retained.' : mapping.refreshOutcome === 'EMPTY' ? 'No reports returned; saved reports retained.' : 'Reports read.'} This bounded read cannot establish a complete source snapshot.</p>}
      {mapping.hasMoreReports && <p role="status">Showing a limited selection of saved reports. Additional reports are omitted.</p>}
      <ul className="space-y-3">{mapping.reports.map((report) => <li key={report.id} className="mt-3 space-y-1"><h4 className="font-medium">{report.title}</h4><p className="whitespace-pre-wrap break-words">{report.summary}</p><p className="text-xs text-muted-foreground">{report.provenance === 'OPENSEO_SAVED_REPORT_PULL' ? <>OpenSEO saved report. Provider edited: <DateValue value={report.providerEditedAt} /> - Metric observation time unknown. </> : 'Staff-published snapshot. '}Source reported: <DateValue value={report.sourceReportedAt} />  -  Hub stored: <DateValue value={report.hubStoredAt} /></p></li>)}</ul>
      {user.role === 'ADMIN' && <MappingControls key={`${mapping.id}:${mapping.revision}`} clientId={clientId} mapping={mapping} user={user} refreshed={query.refetch} />}
    </section>)}
    {data && user.role === 'ADMIN' && <NewMapping clientId={clientId} refreshed={query.refetch} />}
  </div>;
}
