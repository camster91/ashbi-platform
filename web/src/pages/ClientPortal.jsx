import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || '';

// ── Helpers ──────────────────────────────────────────────────────────────────
function statusBadge(status) {
  const s = (status || '').toUpperCase();
  if (s === 'PAID') return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-green-900 text-green-300">PAID ✓</span>;
  if (s === 'OVERDUE') return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-900 text-red-300">OVERDUE</span>;
  if (s === 'SENT' || s === 'PENDING') return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-yellow-900 text-yellow-300">DUE ⚠</span>;
  return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-700 text-slate-300">{s}</span>;
}

function fmt(amount, currency) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency || 'USD' }).format(amount || 0);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/client-portal/request-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (data.sent) {
        setSent(true);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-800 rounded-2xl shadow-xl p-8 border border-slate-700">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">ASHBI DESIGN</h1>
          <p className="text-[#3b82f6] font-medium mt-1">Client Portal</p>
        </div>

        {sent ? (
          <div className="text-center space-y-3">
            <div className="text-4xl">📬</div>
            <p className="text-slate-300 text-sm">
              If we found an account for <strong className="text-white">{email}</strong>, a login link is on its way.
            </p>
            <p className="text-slate-500 text-xs">Check your inbox — the link expires in 1 hour.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-slate-400 text-sm text-center mb-6">
              Enter your email to receive a secure login link.
            </p>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#3b82f6] placeholder-slate-500"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#3b82f6] hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-3 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Sending…' : 'Send Login Link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Invoice List ─────────────────────────────────────────────────────────────
function InvoiceList({ token }) {
  const [me, setMe] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [meRes, invRes] = await Promise.all([
          fetch(`${API}/api/client-portal/me`, { headers }),
          fetch(`${API}/api/client-portal/invoices`, { headers })
        ]);
        if (meRes.status === 401 || invRes.status === 401) {
          setError('Your session has expired. Please request a new login link.');
          setLoading(false);
          return;
        }
        const meData = await meRes.json();
        const invData = await invRes.json();
        setMe(meData);
        setInvoices(Array.isArray(invData) ? invData : []);
      } catch {
        setError('Failed to load your portal. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  function handleLogout() {
    window.location.href = '/client-portal';
  }

  function downloadPdf(invoiceId, invoiceNumber) {
    window.open(`${API}/api/client-portal/invoices/${invoiceId}/pdf?token=${token}`, '_blank');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="text-slate-400 animate-pulse">Loading your portal…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-2xl p-8 max-w-sm text-center border border-slate-700">
          <p className="text-red-400 mb-4">{error}</p>
          <a href="/client-portal" className="text-[#3b82f6] text-sm underline">Request a new link</a>
        </div>
      </div>
    );
  }

  const clientName = me?.client?.name || 'Client';
  const contactName = me?.contact?.name || '';

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
        <div>
          <span className="text-white font-bold">Ashbi Design</span>
          <span className="text-slate-500 mx-2">—</span>
          <span className="text-slate-400 text-sm">Client Portal</span>
        </div>
        <div className="flex items-center gap-4">
          {contactName && <span className="text-slate-400 text-sm hidden sm:block">Welcome, {contactName}</span>}
          <button
            onClick={handleLogout}
            className="text-xs border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 px-3 py-1.5 rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-4 py-10">
        <h2 className="text-xl font-semibold text-white mb-2">{clientName}</h2>
        <p className="text-slate-500 text-sm mb-8">Your invoices from Ashbi Design</p>

        {invoices.length === 0 ? (
          <div className="bg-slate-800 rounded-xl p-8 text-center border border-slate-700">
            <p className="text-slate-500">No invoices found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {invoices.map(inv => {
              const isPaid = inv.status?.toUpperCase() === 'PAID';
              const canPay = !isPaid && (inv.status?.toUpperCase() === 'SENT' || inv.status?.toUpperCase() === 'OVERDUE' || inv.status?.toUpperCase() === 'PENDING');
              return (
                <div key={inv.id} className="bg-slate-800 border border-slate-700 rounded-xl px-5 py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Invoice info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-mono text-[#3b82f6] font-semibold text-sm">{inv.invoiceNumber}</span>
                        {statusBadge(inv.status)}
                      </div>
                      {(inv.title || inv.notes) && (
                        <p className="text-slate-400 text-sm mt-1 truncate">{inv.title || inv.notes}</p>
                      )}
                      <div className="text-slate-500 text-xs mt-1.5 flex flex-wrap gap-3">
                        {inv.issueDate && <span>Issued: {fmtDate(inv.issueDate)}</span>}
                        {inv.dueDate && !isPaid && <span>Due: {fmtDate(inv.dueDate)}</span>}
                        {inv.paidAt && <span>Paid: {fmtDate(inv.paidAt)}</span>}
                      </div>
                    </div>

                    {/* Amount */}
                    <div className="text-right sm:text-right">
                      <span className="text-white font-bold text-lg">{fmt(inv.total, inv.currency)}</span>
                      <span className="text-slate-500 text-xs ml-1">{inv.currency}</span>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                      {canPay && inv.stripePaymentLink && (
                        <a
                          href={inv.stripePaymentLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-[#3b82f6] hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                        >
                          Pay Now
                        </a>
                      )}
                      <button
                        onClick={() => downloadPdf(inv.id, inv.invoiceNumber)}
                        className="px-3 py-1.5 border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                      >
                        Download PDF
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="text-center text-slate-600 text-xs py-8">
        © {new Date().getFullYear()} Ashbi Design — ashbi.ca
      </footer>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ClientPortal() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  if (!token) return <LoginScreen />;
  return <InvoiceList token={token} />;
}
