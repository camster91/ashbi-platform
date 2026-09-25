// Helpers, brand tokens, icons and chat primitives shared by the client
// portal route and its lazily loaded sections.
import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import SlowNotice, { SLOW_WRITE_INLINE as slowWrite } from '../../components/ui/SlowNotice';

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

// ── Ashbi Design Brand ────────────────────────────────────────────────────────
export const BRAND = {
  primary: '#2e2958',
  accent: '#e6f354',
  bg: '#faf9f2',
  white: '#ffffff',
  text: '#2e2958',
  textMuted: '#6b667f',
  danger: '#b91c1c',
  border: '#918c9f',
  cardBg: '#ffffff',
  hoverBg: '#f5f3ea',
};

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

export function statusBadge(status) {
  const s = (status || '').toUpperCase();
  if (s === 'PAID') return <span className="cp-badge cp-badge--green">PAID</span>;
  if (s === 'OVERDUE') return <span className="cp-badge cp-badge--red">OVERDUE</span>;
  if (s === 'SENT' || s === 'PENDING' || s === 'DRAFT') return <span className="cp-badge cp-badge--orange">DUE</span>;
  if (s === 'VOID') return <span className="cp-badge cp-badge--muted">VOID</span>;
  return <span className="cp-badge cp-badge--muted">{s}</span>;
}

export function projectStatusLabel(s) {
  const map = {
    STARTING_UP: 'Starting Up', DESIGN_DEV: 'Design & Dev', ADDING_CONTENT: 'Adding Content',
    FINALIZING: 'Finalizing', LAUNCHED: 'Launched', ON_HOLD: 'On Hold',
    CANCELLED: 'Cancelled', ACTIVE: 'Active',
  };
  return map[s] || s;
}

export function projectStatusColor(s) {
  const map = {
    STARTING_UP: 'cp-badge--blue', DESIGN_DEV: 'cp-badge--purple',
    ADDING_CONTENT: 'cp-badge--lime', FINALIZING: 'cp-badge--orange',
    LAUNCHED: 'cp-badge--green', ON_HOLD: 'cp-badge--muted',
    CANCELLED: 'cp-badge--red', ACTIVE: 'cp-badge--green',
  };
  return map[s] || 'cp-badge--muted';
}

export function taskStatusLabel(s) {
  const map = { PENDING: 'To Do', UPCOMING: 'To Do', IMMEDIATE: 'To Do', IN_PROGRESS: 'In Progress', COMPLETED: 'Done', BLOCKED: 'Blocked' };
  return map[s] || s;
}

export function taskStatusColor(s) {
  const map = { PENDING: 'cp-badge--orange', UPCOMING: 'cp-badge--orange', IMMEDIATE: 'cp-badge--orange', IN_PROGRESS: 'cp-badge--lime', COMPLETED: 'cp-badge--green', BLOCKED: 'cp-badge--red' };
  return map[s] || 'cp-badge--muted';
}

export function priorityLabel(p) {
  const map = { CRITICAL: 'Critical', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
  return map[p] || p;
}

export function priorityColor(p) {
  const map = { CRITICAL: 'cp-badge--red', HIGH: 'cp-badge--orange', NORMAL: 'cp-badge--muted', LOW: 'cp-badge--muted' };
  return map[p] || 'cp-badge--muted';
}

// ── Icons (inline SVG — no dependency needed) ──────────────────────────────────
export const Icons = {
  logo: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill={BRAND.accent}/><text x="4" y="18" fontSize="16" fontWeight="bold" fill={BRAND.primary}>A</text></svg>,
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
    <form onSubmit={onSubmit} className="cp-chat-input-bar">
      <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: connected ? '#15803d' : '#b91c1c' }}>
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#15803d' : '#b91c1c', display: 'inline-block' }} />
        {connected ? 'Connected' : 'Reconnecting...'}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input type="text" value={value} onChange={onChange} placeholder="Type a message..." aria-label="Message to project team" className="cp-input" style={{ flex: 1 }} />
        <button type="submit" className="cp-btn-primary" style={{ padding: '0.5rem 1rem' }} disabled={!value.trim() || sending} aria-busy={sending || undefined} aria-label="Send message">
          {sending ? 'Sending…' : Icons.send}
        </button>
      </div>
      <SlowNotice active={sending} {...slowWrite} />
      {sendError && <p role="alert" className="cp-error" style={{ fontSize: '0.8rem' }}>{sendError} Your text is still in the composer.</p>}
    </form>
  );
}
