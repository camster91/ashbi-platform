// Helpers, brand tokens, icons and chat primitives shared by the client
// portal route and its lazily loaded sections.
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Badge, Button, Card, Input } from '../../components/ui';
import { inputStyles } from '../../components/ui/Input';
import SlowNotice, { SLOW_WRITE_INLINE as slowWrite } from '../../components/ui/SlowNotice';
import { cn } from '../../lib/utils';

export const API = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '') : '';
export const SOCKET_URL = import.meta.env.PROD ? window.location.origin : 'http://localhost:3000';


export function portalFetch(pathname, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${API}${pathname}`, { ...options, headers, credentials: 'include' });
}

export async function downloadPortalDocument(token, doc) {
  const response = await portalFetch(`/api/client-portal/documents/${doc.id}/download`, token);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blobUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = doc.originalName || 'download';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

export async function downloadPortalInvoice(token, invoice) {
  const response = await portalFetch(`/api/client-portal/invoices/${invoice.id}/pdf`, token);
  if (!response.ok) throw new Error(`Invoice download failed (${response.status})`);
  const blobUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = `invoice-${invoice.invoiceNumber || invoice.id}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

export async function downloadPortalContract(token, contract) {
  const response = await portalFetch(`/api/client-portal/contracts/${contract.id}/pdf`, token);
  if (!response.ok) throw new Error(`Contract download failed (${response.status})`);
  const blobUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = `${(contract.title || 'contract').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

export async function deletePortalDocument(token, documentId) {
  const response = await portalFetch(`/api/client-portal/documents/${documentId}`, token, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(`Delete failed (${response.status}) — the file remains available.`);
}

// ── Theme ─────────────────────────────────────────────────────────────────────
// The client portal is a light-only, client-facing surface. main.jsx applies
// the visitor's stored or OS theme to <html> before React renders, which on
// a dark OS would flip every design token (primary becomes lime, cards turn
// indigo). While the portal is mounted it pins the light token set by
// removing `.dark`, and restores the previous theme when it unmounts. Every
// portal colour is a design token (`bg-primary`, `text-muted-foreground`,
// `border-border`, …), so this one switch keeps the whole route light.
export function usePortalLightTheme() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    root.classList.remove('dark');
    return () => {
      if (wasDark) root.classList.add('dark');
    };
  }, []);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function fmt(amount, currency) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency || 'USD' }).format(amount || 0);
}
export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function fmtRelative(d) {
  if (!d) return '';
  const now = new Date();
  const date = new Date(d);
  const diff = date - now;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 14) return `${days}d left`;
  return fmtDate(d);
}

// Status badges use the shared Badge primitive (subtle treatment). The
// label text always states the status, so colour is never the only signal.
function PortalBadge({ color, children }) {
  return <Badge variant="subtle" color={color} className="whitespace-nowrap font-semibold">{children}</Badge>;
}

export function statusBadge(status) {
  const s = (status || '').toUpperCase();
  if (s === 'PAID') return <PortalBadge color="success">PAID</PortalBadge>;
  if (s === 'OVERDUE') return <PortalBadge color="danger">OVERDUE</PortalBadge>;
  if (s === 'SENT' || s === 'PENDING' || s === 'DRAFT') return <PortalBadge color="warning">DUE</PortalBadge>;
  if (s === 'VOID') return <PortalBadge color="default">VOID</PortalBadge>;
  return <PortalBadge color="default">{s}</PortalBadge>;
}

export function StatusBadge({ color, children }) {
  return <PortalBadge color={color}>{children}</PortalBadge>;
}

export function projectStatusLabel(s) {
  const map = {
    STARTING_UP: 'Starting Up', DESIGN_DEV: 'Design & Dev', ADDING_CONTENT: 'Adding Content',
    FINALIZING: 'Finalizing', LAUNCHED: 'Launched', ON_HOLD: 'On Hold',
    CANCELLED: 'Cancelled', ACTIVE: 'Active',
  };
  return map[s] || s;
}

// Badge `color` for each status (see docs/ui-primitives.md, Badge).
export function projectStatusColor(s) {
  const map = {
    STARTING_UP: 'info', DESIGN_DEV: 'primary',
    ADDING_CONTENT: 'accent', FINALIZING: 'warning',
    LAUNCHED: 'success', ON_HOLD: 'default',
    CANCELLED: 'danger', ACTIVE: 'success',
  };
  return map[s] || 'default';
}

export function taskStatusLabel(s) {
  const map = { PENDING: 'To Do', UPCOMING: 'To Do', IMMEDIATE: 'To Do', IN_PROGRESS: 'In Progress', COMPLETED: 'Done', BLOCKED: 'Blocked' };
  return map[s] || s;
}

export function taskStatusColor(s) {
  const map = { PENDING: 'warning', UPCOMING: 'warning', IMMEDIATE: 'warning', IN_PROGRESS: 'accent', COMPLETED: 'success', BLOCKED: 'danger' };
  return map[s] || 'default';
}

export function priorityLabel(p) {
  const map = { CRITICAL: 'Critical', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
  return map[p] || p;
}

export function priorityColor(p) {
  const map = { CRITICAL: 'danger', HIGH: 'warning', NORMAL: 'default', LOW: 'default' };
  return map[p] || 'default';
}

// Portal form fields use the shared Input look. Text is 16px below the `sm`
// breakpoint so iOS Safari does not zoom the page on focus, and the white
// card fill keeps fields distinct from the cream page.
export const portalFieldClass = 'min-h-11 bg-card text-base text-foreground sm:text-sm';

// Buttons whose label changes while busy ("Sending…", "Preparing…") stay at
// full opacity when disabled. Button's default `disabled:opacity-50` would
// drop the busy label to ~2.9:1; the old portal kept disabled buttons opaque.
export const busyLabelButtonClass = 'disabled:opacity-100';

// The same look for <select> and <textarea> fields.
export const portalFieldStyles = (className) => inputStyles(cn(portalFieldClass, className));

// Portal typography on design tokens.
export const pageTitleClass = 'mb-4 text-xl font-bold text-foreground';
export const sectionTitleClass = 'mb-3 text-base font-semibold text-foreground';
export const labelClass = 'mb-1.5 block text-sm font-medium text-foreground';

// Progress track + fill. `tone` is a token background utility.
export function PortalProgress({ value, tone = 'bg-primary', className }) {
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-border', className)}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none', tone)}
        style={{ width: `${Math.max(0, Math.min(Number(value) || 0, 100))}%` }}
      />
    </div>
  );
}

// ── Icons (inline SVG — no dependency needed) ──────────────────────────────────
export const Icons = {
  logo: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" className="fill-accent"/><text x="4" y="18" fontSize="16" fontWeight="bold" className="fill-primary">A</text></svg>,
  overview: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  projects: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  invoices: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  documents: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
  chat: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  arrow: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  download: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  trash: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  upload: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  back: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  logout: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

// ── Chat Hook (Socket.IO) ─────────────────────────────────────────────────────
export function useProjectChat(projectId, token) {
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const socketRef = useRef(null);
  const sendInFlightRef = useRef(false);

  const reloadMessages = useCallback(async () => {
    if (!projectId) return;
    setLoadingMessages(true);
    setMessagesError('');
    try {
      const response = await portalFetch(`/api/client-portal/projects/${projectId}/messages`, token);
      if (!response.ok) throw new Error(`Chat messages could not be loaded (${response.status}).`);
      const data = await response.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessagesError(error?.message || 'Chat messages could not be loaded. Try again.');
    } finally {
      setLoadingMessages(false);
    }
  }, [projectId, token]);

  useEffect(() => {
    if (!projectId) return;
    setMessages([]);
    setMessagesError('');

    const socket = io(SOCKET_URL, {
      auth: token ? { token } : {},
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join-project', projectId);
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('chat:message', (msg) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    void reloadMessages();

    return () => {
      socket.emit('leave-project', projectId);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [projectId, token]);

  const sendMessage = useCallback(async (content) => {
    if (!content.trim()) return;
    if (sendInFlightRef.current) {
      throw new Error('A message is already sending. Wait for it to finish before retrying.');
    }
    sendInFlightRef.current = true;
    setSending(true);
    setSendError('');
    try {
      const res = await portalFetch(`/api/client-portal/projects/${projectId}/messages`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Message could not be sent (${res.status}).`);
      }
      const msg = await res.json();
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      return msg;
    } catch (error) {
      setSendError(error?.message || 'Message could not be sent. Your text is still in the composer.');
      throw error;
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  }, [projectId, reloadMessages, token]);

  return { messages, connected, sendMessage, sendError, sending, messagesError, loadingMessages, reloadMessages };
}

export function PortalChatComposer({ value, onChange, onSubmit, connected, sending, sendError }) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-b-2xl border border-border bg-card px-4 py-3">
      <div role="status" aria-live="polite" className={cn('flex items-center gap-1 text-xs', connected ? 'text-success' : 'text-destructive')}>
        <span aria-hidden="true" className={cn('inline-block h-1.5 w-1.5 rounded-full', connected ? 'bg-success' : 'bg-destructive')} />
        {connected ? 'Connected' : 'Reconnecting...'}
      </div>
      <div className="flex gap-2">
        <Input type="text" value={value} onChange={onChange} placeholder="Type a message..." aria-label="Message to project team" className={cn(portalFieldClass, 'flex-1')} />
        <Button type="submit" className={cn('shrink-0', busyLabelButtonClass)} disabled={!value.trim() || sending} aria-busy={sending || undefined} aria-label="Send message" slowAfterMs={false}>
          {sending ? 'Sending…' : Icons.send}
        </Button>
      </div>
      <SlowNotice active={sending} {...slowWrite} />
      {sendError && <p role="alert" className="text-sm text-destructive">{sendError} Your text is still in the composer.</p>}
    </form>
  );
}

// ── Documents ─────────────────────────────────────────────────────────────────
// Upload drop zone shared by the Documents tab and the project Documents view.
// There is no shared dropzone primitive yet, so the zone keeps the
// portal-specific `.cp-upload-zone` layout (portal.css). It is a native
// <button> that opens a visually hidden, named file input kept out of the tab
// order so keyboard focus never lands on an invisible control.
export function PortalUploadZone({ inputRef, inputLabel, helpId, uploading, disabled, onFiles }) {
  const [dragging, setDragging] = useState(false);
  return (
    <>
      <input
        type="file"
        ref={inputRef}
        multiple
        className="sr-only"
        aria-label={inputLabel}
        tabIndex={-1}
        onChange={e => { if (e.target.files.length > 0) onFiles(e.target.files); }}
      />
      <button
        type="button"
        className="cp-upload-zone"
        data-dragging={dragging || undefined}
        aria-describedby={helpId}
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={e => {
          // Moving over the zone's own children fires dragleave; ignore it so
          // the highlight does not flicker.
          if (e.currentTarget.contains(e.relatedTarget)) return;
          setDragging(false);
        }}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
        }}
      >
        <span className="flex justify-center">{Icons.upload}</span>
        <p className="mt-2 font-semibold text-foreground">
          {uploading ? 'Uploading...' : 'Drop files here or click to upload'}
        </p>
        <p id={helpId} className="text-sm text-muted-foreground">PDF, images, documents — up to 50MB</p>
      </button>
    </>
  );
}

export function PortalDocumentList({ documents, onDownload, onDelete, deleting }) {
  if (documents.length === 0) {
    return (
      <Card padding="none" className="p-8 text-center">
        <p className="text-muted-foreground">No documents yet. Upload one above.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {documents.map(doc => (
        <Card key={doc.id} padding="none" className="flex items-center justify-between px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">{doc.originalName}</p>
            <p className="text-xs text-muted-foreground">
              {(doc.size / 1024).toFixed(1)} KB &middot; {fmtDate(doc.createdAt)} &middot; {doc.uploadedBy?.name || 'Unknown'}
            </p>
          </div>
          <div className="ml-3 flex gap-2">
            <Button type="button" variant="outline" size="xs" leftIcon={Icons.download} onClick={() => onDownload(doc)}>
              Download
            </Button>
            <Button type="button" variant="danger-outline" size="xs" className="min-w-11" onClick={() => onDelete(doc)} disabled={deleting} aria-label={`Delete ${doc.originalName}`}>
              {Icons.trash}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
