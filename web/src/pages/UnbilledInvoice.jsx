import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import useClients, { useClientSearch } from '../hooks/useClients';
import { Button, Card } from '../components/ui';
import { formatInvoiceMoney } from '../lib/format';

const field = 'block w-full rounded border border-border bg-background p-2 text-foreground';
export default function UnbilledInvoice() {
  const [params, setParams] = useSearchParams();
  const releaseId = params.get('release');
  const [form, setForm] = useState({ clientId: '', title: '', currency: 'CAD', taxRate: 0, taxType: 'NONE' });
  const [search, setSearch] = useState('');
  const clients = useClients();
  const searched = useClientSearch(search);
  const options = search.trim().length >= 2 ? searched.data : clients.data;
  const [pages, setPages] = useState({ TIME: { items: [], nextCursor: null }, EXPENSE: { items: [], nextCursor: null } });
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState({});
  const [prepared, setPrepared] = useState(null);
  const [receiptId, setReceiptId] = useState(params.get('action') || '');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async work => {
    setBusy(true); setError('');
    try { await work(); } catch (err) { setError(err.message || 'The operation failed. Recover the receipt before retrying.'); }
    finally { setBusy(false); }
  };
  const change = patch => { setForm(old => ({ ...old, ...patch })); setPrepared(null); setKey(crypto.randomUUID()); };
  const load = async (kind, after) => {
    const result = await api.billingTool('list_unbilled_candidates', { clientId: form.clientId, kind, limit: 50, ...(after && { after }) });
    setPages(old => ({ ...old, [kind]: { ...result.output, items: after ? [...old[kind].items, ...result.output.items] : result.output.items } }));
  };
  const prepare = async () => {
    let name, input;
    if (releaseId) {
      const result = await api.billingTool('preview_unbilled_release', { invoiceId: releaseId });
      name = 'release_unbilled_invoice_sources'; input = { invoiceId: releaseId, fingerprint: result.output.fingerprint };
    } else {
      const selected = { ...form, taxRate: Number(form.taxRate), times: [], expenses: [] };
      for (const kind of ['TIME', 'EXPENSE']) for (const row of pages[kind].items) if (selection[row.id]?.checked) {
        const source = { id: row.id, updatedAt: row.updatedAt };
        if (kind === 'TIME') selected.times.push({ ...source, hourlyRate: Number(selection[row.id].rate) });
        else selected.expenses.push(source);
      }
      const result = await api.billingTool('preview_unbilled_invoice', selected);
      name = 'create_unbilled_invoice_draft'; input = { selection: selected, fingerprint: result.output.fingerprint };
    }
    const result = await api.billingTool(name, { input, idempotencyKey: key });
    setPrepared(result.action); setReceiptId(result.action.id);
    const next = new URLSearchParams(params); next.set('action', result.action.id); setParams(next, { replace: true });
  };
  const recover = async () => {
    const result = await api.billingTool('get_action', { actionId: receiptId });
    setPrepared(result.action);
  };
  const confirm = async () => {
    const result = await api.billingTool('confirm_action', { actionId: prepared.id });
    setPrepared(result.action);
  };
  const preview = prepared?.preview;
  const pending = prepared?.status === 'PENDING_CONFIRMATION';
  const isRelease = preview?.kind === 'release_unbilled_invoice_sources';
  return <div className="space-y-5 max-w-3xl mx-auto [overflow-wrap:anywhere]">
    <Link to="/invoices" className="underline">Back to invoices</Link>
    <h1 className="text-2xl font-semibold">{releaseId ? 'Release voided invoice work' : 'Bill approved work'}</h1>
    <p>Create a reviewed draft from approved time and billable expenses. Original source history is retained. Sending and payment are separate actions.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!releaseId && <Card className="p-4 space-y-4">
      <fieldset disabled={busy || Boolean(pending)} className="space-y-3">
        <label className="block">Find client<input className={field} value={search} onChange={event => setSearch(event.target.value)} /></label>
        {(clients.isError || searched.isError) && <p role="alert">Clients could not be loaded. <Button onClick={() => { clients.refetch(); searched.refetch(); }}>Retry clients</Button></p>}
        <label className="block">Client<select className={field} value={form.clientId} onChange={event => { change({ clientId: event.target.value }); setLoaded(false); setSelection({}); setPages({ TIME: { items: [], nextCursor: null }, EXPENSE: { items: [], nextCursor: null } }); }}><option value="">Choose client</option>{options?.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className="block">Invoice title<input required maxLength={200} className={field} value={form.title} onChange={event => change({ title: event.target.value })} /></label>
        <label className="block">Currency<select className={field} value={form.currency} onChange={event => change({ currency: event.target.value })}>{['CAD', 'USD', 'EUR', 'GBP'].map(value => <option key={value}>{value}</option>)}</select></label>
        <p className="text-sm">Time rates below are declared in {form.currency}. Expense currencies must match; no conversion is inferred.</p>
        <label className="block">Tax treatment<select className={field} value={form.taxType} onChange={event => change({ taxType: event.target.value, ...(event.target.value === 'NONE' && { taxRate: 0 }) })}>{['NONE', 'HST', 'GST', 'PST', 'TAX'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="block">Tax percent<input type="number" min="0" max="50" step="0.01" disabled={form.taxType === 'NONE'} className={field} value={form.taxRate} onChange={event => change({ taxRate: event.target.value })} /></label>
        <Button disabled={!form.clientId} onClick={() => run(async () => { setLoaded(false); await load('TIME'); await load('EXPENSE'); setSelection({}); setPrepared(null); setKey(crypto.randomUUID()); setLoaded(true); })}>Load unbilled work</Button>
        {loaded && ['TIME', 'EXPENSE'].map(kind => <section key={kind} className="space-y-3"><h2 className="font-semibold">{kind === 'TIME' ? 'Approved time' : 'Billable expenses'}</h2>
          {!pages[kind].items.length && <p>No eligible work found.</p>}
          {pages[kind].items.map(row => <div key={row.id} className="border rounded p-3 space-y-2">
            <label className="flex gap-2 min-h-11 items-center"><input type="checkbox" checked={Boolean(selection[row.id]?.checked)} onChange={event => { setSelection(old => ({ ...old, [row.id]: { rate: old[row.id]?.rate ?? row.suggestedHourlyRate ?? 0, checked: event.target.checked } })); setKey(crypto.randomUUID()); setPrepared(null); }} />{row.description || row.id}</label>
            <p className="text-sm">{row.project?.name || 'Client expense'} · {new Date(row.date).toLocaleDateString()}{kind === 'TIME' ? ` · ${row.duration} minutes` : ` · ${formatInvoiceMoney(row.amount, row.currency)}`}</p>
            {kind === 'TIME' && <label className="block">Hourly rate for {row.description || row.id} ({form.currency})<input className={field} type="number" min="0" max="1000000" step="0.01" value={selection[row.id]?.rate ?? row.suggestedHourlyRate ?? 0} onChange={event => { setSelection(old => ({ ...old, [row.id]: { ...old[row.id], rate: event.target.value } })); setKey(crypto.randomUUID()); setPrepared(null); }} /></label>}
          </div>)}
          {pages[kind].nextCursor && <Button variant="outline" onClick={() => run(() => load(kind, pages[kind].nextCursor))}>Load more {kind === 'TIME' ? 'time' : 'expenses'}</Button>}
        </section>)}
      </fieldset>
    </Card>}
    {!pending && prepared?.status !== 'EXECUTED' && <Button disabled={busy || (!releaseId && (!loaded || !form.title.trim() || !Object.values(selection).some(row => row.checked)))} onClick={() => run(prepare)}>{releaseId ? 'Preview source release' : 'Preview draft invoice'}</Button>}
    {prepared && <Card className="p-4 space-y-3"><h2 className="font-semibold">Review before confirmation</h2><p>Status: {prepared.status}</p><p>Receipt: {prepared.id}</p>
      {preview?.lineItems?.map((line, index) => <p key={index}>{line.description} · {line.quantity} × {formatInvoiceMoney(line.unitPrice, preview.currency)} · {formatInvoiceMoney(line.total, preview.currency)}</p>)}
      {preview?.totals && <p>Total: {formatInvoiceMoney(preview.totals.total, preview.currency)} · Tax: {formatInvoiceMoney(preview.totals.tax, preview.currency)}</p>}
      {preview?.client && <p>Client: {preview.client.name} · {preview.title} · {preview.currency} · {preview.taxType} {preview.taxRate}%</p>}
      {preview?.lineItems?.map(line => <p key={line.source.id} className="text-sm">Source: {line.source.id} · {line.source.project?.name || 'Client expense'} · {line.source.user?.name || ''} · {new Date(line.source.date).toLocaleDateString()}</p>)}
      {isRelease && preview?.sourceCount && <p>Release {preview.sourceCount.time} time entries and {preview.sourceCount.expense} expenses. The original invoice stays voided and retains its history.</p>}
      {isRelease && <p>Invoice: {preview.invoiceNumber} · {formatInvoiceMoney(preview.total, preview.currency)}</p>}
      {isRelease && preview?.sources?.map(source => <p key={`${source.kind}:${source.id}`}>{source.kind}: {source.id} · {source.description} · {source.project?.name || 'Client expense'} · {source.user?.name || ''} · {new Date(source.date).toLocaleDateString()}</p>)}
      {pending && <><p>Preview expires: {new Date(prepared.expiresAt).toLocaleString()}</p><Button disabled={busy} onClick={() => run(confirm)}>{isRelease ? 'Confirm source release' : 'Confirm draft creation'}</Button><Button variant="outline" disabled={busy} onClick={() => run(async () => { const result = await api.billingTool('reject_action', { actionId: prepared.id }); setPrepared(result.action); setKey(crypto.randomUUID()); })}>Reject preview</Button></>}
      {prepared.errorCode && <p role="alert">Action failed: {prepared.errorCode}. Refresh the work and review a new preview.</p>}
      {prepared.status === 'EXECUTED' && <p role="status">{isRelease ? 'Sources released; original history retained.' : 'Draft created.'} {prepared.result?.id && <Link className="underline" to={`/invoices/${prepared.result.id}`}>Open invoice</Link>}</p>}
    </Card>}
    <Card className="p-4 space-y-3"><h2 className="font-semibold">Recover an existing action</h2><p>If a response was lost, retrieve the receipt before starting a new action.</p><label className="block">Action receipt ID<input className={field} value={receiptId} onChange={event => setReceiptId(event.target.value)} /></label><Button variant="outline" disabled={busy || !receiptId.trim()} onClick={() => run(recover)}>Retrieve receipt</Button></Card>
  </div>;
}
