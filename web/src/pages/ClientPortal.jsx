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

function projectStatusLabel(s) {
  const map = {
    STARTING_UP: 'Starting Up', DESIGN_DEV: 'Design & Dev', ADDING_CONTENT: 'Adding Content',
    FINALIZING: 'Finalizing', LAUNCHED: 'Launched', ON_HOLD: 'On Hold',
    CANCELLED: 'Cancelled', ACTIVE: 'Active',
  };
  return map[s] || s;
}

function projectStatusColor(s) {
  const map = {
    STARTING_UP: 'bg-blue-900 text-blue-300', DESIGN_DEV: 'bg-purple-900 text-purple-300',
    ADDING_CONTENT: 'bg-cyan-900 text-cyan-300', FINALIZING: 'bg-amber-900 text-amber-300',
    LAUNCHED: 'bg-green-900 text-green-300', ON_HOLD: 'bg-slate-700 text-slate-400',
    CANCELLED: 'bg-red-900 text-red-300', ACTIVE: 'bg-emerald-900 text-emerald-300',
  };
  return map[s] || 'bg-slate-700 text-slate-300';
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

// ── Portal Dashboard ─────────────────────────────────────────────────────────
function PortalDashboard({ token }) {
  const [me, setMe] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [projects, setProjects] = useState([]);
  const [retainer, setRetainer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    async function load() {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [meRes, invRes, projRes, retRes] = await Promise.all([
          fetch(`${API}/api/client-portal/me`, { headers }),
          fetch(`${API}/api/client-portal/invoices`, { headers }),
          fetch(`${API}/api/client-portal/projects`, { headers }),
          fetch(`${API}/api/client-portal/retainer`, { headers }),
        ]);
        if (meRes.status === 401) {
          setError('Your session has expired. Please request a new login link.');
          setLoading(false);
          return;
        }
        const [meData, invData, projData, retData] = await Promise.all([
          meRes.json(), invRes.json(), projRes.json(), retRes.json()
        ]);
        setMe(meData);
        setInvoices(Array.isArray(invData) ? invData : []);
        setProjects(Array.isArray(projData) ? projData : []);
        setRetainer(retData || null);
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

  function downloadPdf(invoiceId) {
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

  const overdueInvoices = invoices.filter(i => i.status?.toUpperCase() === 'OVERDUE');
  const unpaidTotal = invoices
    .filter(i => ['SENT', 'OVERDUE', 'PENDING'].includes(i.status?.toUpperCase()))
    .reduce((s, i) => s + (i.total || 0), 0);
  const activeProjects = projects.filter(p => !['LAUNCHED', 'CANCELLED', 'ON_HOLD'].includes(p.status));

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'projects', label: `Projects (${projects.length})` },
    { id: 'invoices', label: `Invoices (${invoices.length})` },
    ...(retainer ? [{ id: 'retainer', label: 'Retainer' }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-700 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div>
          <span className="text-white font-bold">Ashbi Design</span>
          <span className="text-slate-500 mx-2">—</span>
          <span className="text-slate-300 text-sm font-medium">{clientName}</span>
        </div>
        <div className="flex items-center gap-4">
          {contactName && <span className="text-slate-400 text-sm hidden sm:block">Hi, {contactName}</span>}
          <button
            onClick={handleLogout}
            className="text-xs border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 px-3 py-1.5 rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-slate-900/50 border-b border-slate-800 px-6">
        <div className="max-w-4xl mx-auto flex gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-[#3b82f6] text-[#3b82f6]'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Urgents */}
            {overdueInvoices.length > 0 && (
              <div className="bg-red-950/50 border border-red-800 rounded-xl p-4">
                <p className="text-red-400 font-semibold text-sm mb-2">
                  ⚠ {overdueInvoices.length} overdue invoice{overdueInvoices.length > 1 ? 's' : ''}
                </p>
                <p className="text-red-300 text-xs">
                  Please review your invoices and make payment at your earliest convenience.
                </p>
                <button
                  onClick={() => setActiveTab('invoices')}
                  className="mt-3 text-xs text-red-400 underline hover:text-red-300"
                >
                  View invoices →
                </button>
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Active Projects</p>
                <p className="text-2xl font-bold text-white">{activeProjects.length}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Outstanding</p>
                <p className={`text-2xl font-bold ${unpaidTotal > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                  {fmt(unpaidTotal, 'USD')}
                </p>
              </div>
              {retainer && (
                <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                  <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Retainer Hours</p>
                  <p className={`text-2xl font-bold ${retainer.percentUsed >= 90 ? 'text-red-400' : retainer.percentUsed >= 70 ? 'text-amber-400' : 'text-green-400'}`}>
                    {retainer.hoursUsed}/{retainer.hoursPerMonth}h
                  </p>
                </div>
              )}
            </div>

            {/* Active projects preview */}
            {activeProjects.length > 0 && (
              <div>
                <h3 className="text-slate-300 font-semibold mb-3">Active Projects</h3>
                <div className="space-y-3">
                  {activeProjects.slice(0, 3).map(p => (
                    <div key={p.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-white">{p.name}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${projectStatusColor(p.status)}`}>
                          {projectStatusLabel(p.status)}
                        </span>
                      </div>
                      {p.aiSummary && (
                        <p className="text-slate-400 text-sm mb-3 line-clamp-2">{p.aiSummary}</p>
                      )}
                      <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                        <span>Progress</span>
                        <span>{p.progressPct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-1.5 bg-[#3b82f6] rounded-full transition-all"
                          style={{ width: `${p.progressPct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {activeProjects.length > 3 && (
                    <button onClick={() => setActiveTab('projects')} className="text-xs text-[#3b82f6] underline">
                      View all projects →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Recent invoices */}
            {invoices.slice(0, 3).length > 0 && (
              <div>
                <h3 className="text-slate-300 font-semibold mb-3">Recent Invoices</h3>
                <div className="space-y-2">
                  {invoices.slice(0, 3).map(inv => (
                    <div key={inv.id} className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[#3b82f6] text-sm font-semibold">{inv.invoiceNumber}</span>
                          {statusBadge(inv.status)}
                        </div>
                        {inv.dueDate && inv.status !== 'PAID' && (
                          <p className="text-slate-500 text-xs mt-0.5">Due {fmtDate(inv.dueDate)}</p>
                        )}
                      </div>
                      <span className="text-white font-bold">{fmt(inv.total, inv.currency)}</span>
                    </div>
                  ))}
                  {invoices.length > 3 && (
                    <button onClick={() => setActiveTab('invoices')} className="text-xs text-[#3b82f6] underline">
                      View all invoices →
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* PROJECTS TAB */}
        {activeTab === 'projects' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Your Projects</h2>
            {projects.length === 0 ? (
              <div className="bg-slate-800 rounded-xl p-8 text-center border border-slate-700">
                <p className="text-slate-500">No projects found.</p>
              </div>
            ) : (
              projects.map(p => (
                <div key={p.id} className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-white">{p.name}</h3>
                      <p className="text-slate-500 text-xs mt-0.5">
                        Last updated {fmtDate(p.updatedAt)}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ml-2 ${projectStatusColor(p.status)}`}>
                      {projectStatusLabel(p.status)}
                    </span>
                  </div>
                  {p.aiSummary && (
                    <p className="text-slate-400 text-sm mb-3">{p.aiSummary}</p>
                  )}
                  {p.totalTasks > 0 && (
                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                        <span>{p.completedTasks} of {p.totalTasks} tasks complete</span>
                        <span className="font-medium">{p.progressPct}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            p.progressPct >= 80 ? 'bg-green-500' : p.progressPct >= 40 ? 'bg-[#3b82f6]' : 'bg-slate-500'
                          }`}
                          style={{ width: `${p.progressPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* INVOICES TAB */}
        {activeTab === 'invoices' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Invoices</h2>
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
                        <div className="text-right">
                          <span className="text-white font-bold text-lg">{fmt(inv.total, inv.currency)}</span>
                          <span className="text-slate-500 text-xs ml-1">{inv.currency}</span>
                        </div>
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
                            onClick={() => downloadPdf(inv.id)}
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
          </div>
        )}

        {/* RETAINER TAB */}
        {activeTab === 'retainer' && retainer && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Monthly Retainer</h2>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Hours Included</p>
                  <p className="text-2xl font-bold text-white">{retainer.hoursPerMonth}h</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Hours Used</p>
                  <p className={`text-2xl font-bold ${retainer.percentUsed >= 90 ? 'text-red-400' : retainer.percentUsed >= 70 ? 'text-amber-400' : 'text-green-400'}`}>
                    {retainer.hoursUsed}h
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Hours Remaining</p>
                  <p className={`text-2xl font-bold ${retainer.hoursRemaining <= 0 ? 'text-red-400' : 'text-slate-200'}`}>
                    {retainer.hoursRemaining >= 0 ? `${retainer.hoursRemaining}h` : `${Math.abs(retainer.hoursRemaining)}h over`}
                  </p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                  <span>Monthly usage</span>
                  <span className="font-semibold">{retainer.percentUsed}%</span>
                </div>
                <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-3 rounded-full transition-all ${
                      retainer.percentUsed >= 100 ? 'bg-red-500' :
                      retainer.percentUsed >= 80 ? 'bg-amber-500' :
                      retainer.percentUsed >= 60 ? 'bg-yellow-400' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(retainer.percentUsed, 100)}%` }}
                  />
                </div>
              </div>

              {(retainer.monthlyAmountUsd || retainer.monthlyAmountCad) && (
                <div className="border-t border-slate-700 pt-4 flex gap-6">
                  {retainer.monthlyAmountUsd && (
                    <div>
                      <p className="text-slate-400 text-xs mb-0.5">Monthly Rate</p>
                      <p className="text-white font-semibold">{fmt(retainer.monthlyAmountUsd, 'USD')} USD</p>
                    </div>
                  )}
                  {retainer.monthlyAmountCad && (
                    <div>
                      <p className="text-slate-400 text-xs mb-0.5">Monthly Rate (CAD)</p>
                      <p className="text-white font-semibold">{fmt(retainer.monthlyAmountCad, 'CAD')} CAD</p>
                    </div>
                  )}
                </div>
              )}

              <p className="text-slate-600 text-xs">
                Cycle resets on the 1st of each month. Hours shown are for the current billing period.
              </p>
            </div>
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
  return <PortalDashboard token={token} />;
}
