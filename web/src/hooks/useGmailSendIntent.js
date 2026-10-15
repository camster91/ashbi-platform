import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const STATUSES = new Set(['PREPARED', 'UNKNOWN', 'DISPATCHING', 'ACCEPTED_PENDING_RECORD', 'COMPLETED', 'REJECTED']);
const TERMINAL = new Set(['COMPLETED', 'REJECTED']);
const valid = (value) => value && typeof value.key === 'string' && /^[a-zA-Z0-9-]{16,100}$/.test(value.key) && STATUSES.has(value.status);
const scopeKey = ({ userId, organizationId, threadId }) => [userId, organizationId, threadId].every((part) => typeof part === 'string' && part)
  ? `ashbi:gmail-send-intent:${[organizationId, userId, threadId].map(encodeURIComponent).join(':')}` : null;
const storageFailure = () => new Error('Send intent could not be retained. Sending is blocked until browser storage is available.');

/** Stores only an opaque key and delivery state, never message content. */
export default function useGmailSendIntent(identity) {
  const scope = scopeKey(identity);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const [state, setState] = useState({ scope: null, intent: null, storageError: false });
  const [operation, setOperation] = useState(null);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const current = state.scope === scope ? state : { intent: null, storageError: false };

  function read() {
    if (!scope) throw storageFailure();
    const raw = localStorage.getItem(scope);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!valid(parsed)) throw storageFailure();
    return { key: parsed.key, status: parsed.status };
  }

  useEffect(() => {
    function load() {
      try { setState({ scope, intent: read(), storageError: false }); }
      catch { setState({ scope, intent: null, storageError: true }); }
    }
    load(); setError(''); setOperation(null); busy.current = false;
    const listener = (event) => { if (event.key === scope || event.key === null) load(); };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
    // Each scope gets an isolated state and storage listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  function retain(intent) {
    if (!scope) throw storageFailure();
    const serialized = JSON.stringify({ key: intent.key, status: intent.status });
    try {
      localStorage.setItem(scope, serialized);
      if (localStorage.getItem(scope) !== serialized) throw storageFailure();
      if (activeScope.current === scope) setState({ scope, intent, storageError: false });
    } catch {
      if (activeScope.current === scope) setState((previous) => ({ scope, intent: previous.scope === scope ? previous.intent : null, storageError: true }));
      throw storageFailure();
    }
  }

  function prepareIntent() {
    try {
      const existing = read();
      const intent = existing || { key: crypto.randomUUID(), status: 'PREPARED' };
      // Verify persistence even for a retry before allowing a POST.
      retain(intent); setError(''); return intent.key;
    } catch {
      setState((previous) => ({ scope, intent: previous.scope === scope ? previous.intent : null, storageError: true }));
      throw storageFailure();
    }
  }

  function recordResult(data) {
    const intent = read();
    if (!intent) throw storageFailure();
    const status = STATUSES.has(data?.status) && data.status !== 'PREPARED' ? data.status : 'UNKNOWN';
    retain({ key: intent.key, status });
    return { key: intent.key, status };
  }

  async function receiptOperation(reconcile = false) {
    if (busy.current) return null;
    let intent;
    try { intent = read(); }
    catch { setState((previous) => ({ scope, intent: previous.scope === scope ? previous.intent : null, storageError: true })); return null; }
    if (!intent || (reconcile && intent.status !== 'ACCEPTED_PENDING_RECORD')) return null;
    busy.current = true; setOperation({ scope, kind: reconcile ? 'reconcile' : 'check' }); setError('');
    try {
      const data = reconcile ? await api.reconcileGmailSendReceipt(intent.key) : await api.getGmailSendReceipt(intent.key);
      if (activeScope.current === scope && read()?.key === intent.key) recordResult(data);
      return data;
    } catch (failure) {
      if (activeScope.current === scope) {
        // A timed-out POST can still be preparing its mailbox before claiming.
        // Even confirmed receipt absence cannot release this saved send key.
        setError(reconcile ? 'The sent email record could not be saved yet. Check its status again.'
          : failure?.data?.code === 'GMAIL_SEND_NOT_FOUND'
            ? 'No receipt exists yet, but the send may still be preparing. Keep this attempt and check again.'
            : 'Delivery status could not be checked. Keep this intent and try checking again.');
      }
      return null;
    } finally {
      if (activeScope.current === scope) { busy.current = false; setOperation(null); }
    }
  }

  function clearConfirmedIntent() {
    try {
      const intent = read();
      if (!intent || !TERMINAL.has(intent.status)) return false;
      localStorage.removeItem(scope);
      if (localStorage.getItem(scope) !== null) throw storageFailure();
      setState({ scope, intent: null, storageError: false }); setError(''); return true;
    } catch {
      setState((previous) => ({ scope, intent: previous.scope === scope ? previous.intent : null, storageError: true })); return false;
    }
  }

  return {
    intent: current.intent,
    status: current.intent?.status || null,
    unresolved: Boolean(current.storageError || (current.intent && !TERMINAL.has(current.intent.status))),
    checking: operation?.scope === scope && operation.kind === 'check',
    reconciling: operation?.scope === scope && operation.kind === 'reconcile',
    storageError: current.storageError,
    error,
    prepareIntent, recordResult,
    checkReceipt: () => receiptOperation(false),
    reconcileReceipt: () => receiptOperation(true),
    clearConfirmedIntent,
  };
}
