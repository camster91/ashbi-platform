import { useState, useEffect } from 'react';
import { api } from '../lib/api';

function LandingPage() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showIntake, setShowIntake] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    companyName: '', industry: '', stage: '', needs: [],
    budgetRange: '', timeline: '', name: '', email: '', phone: '', notes: ''
  });

  useEffect(() => {
    api.request('/client-acquisition/config')
      .then(d => { setConfig(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const needsOptions = ['Branding', 'Packaging Design', ' Shopify Development', 'Graphic Design', 'Full Rebrand'];
  const industryOptions = ['Beverages', 'Food & Snacks', 'Health & Wellness', 'Beauty & Personal Care', 'Supplements', 'Pet Products', 'Home & Cleaning', 'Other CPG'];
  const stageOptions = ['Idea / Pre-launch', 'Early Stage (0-12 months)', 'Growth Stage (1-5 years)', 'Established Brand'];
  const budgetOptions = ['Under $2,500', '$2,500 - $5,000', '$5,000 - $10,000', '$10,000 - $25,000', '$25,000+', 'Not sure yet'];
  const timelineOptions = ['ASAP (within 2 weeks)', '1-2 months', '3-6 months', 'Just exploring'];

  const toggleNeed = (need) => {
    setForm(f => ({
      ...f,
      needs: f.needs.includes(need) ? f.needs.filter(n => n !== need) : [...f.needs, need]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/client-acquisition/intake', form);
      setSubmitted(true);
    } catch (err) {
      alert('Something went wrong. Please email us at hello@ashbi.ca');
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#c9a84c]"></div>
    </div>
  );

  const brand = config?.brand || {};
  const services = config?.services || [];
  const portfolio = config?.portfolio || [];
  const primary = brand.primaryColor || '#c9a84c';
  const accent = brand.accentColor || '#1e293b';

  if (submitted) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="max-w-lg text-center">
        <div className="text-6xl mb-6">🎉</div>
        <h1 className="text-3xl font-bold text-white mb-4">You're on the list!</h1>
        <p className="text-slate-400 text-lg mb-8">
          We'll review your project and reach out within 24 hours. 
          In the meantime, check out our <a href="/client-acquisition/portfolio" className="underline" style={{ color: primary }}>portfolio</a>.
        </p>
        <a href="/" className="inline-block px-8 py-3 rounded-lg text-white font-semibold transition" style={{ backgroundColor: primary }}>
          Back to Home
        </a>
      </div>
    </div>
  );

  if (showIntake) return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <button onClick={() => setShowIntake(false)} className="text-slate-400 hover:text-white flex items-center gap-2">
            <span>←</span> Back
          </button>
          <span className="text-white font-bold">{brand.companyName || 'Ashbi Design'}</span>
        </div>
      </header>

      {/* Intake Form */}
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-2">Let's Build Your Brand</h1>
        <p className="text-slate-400 mb-8">Tell us about your project and we'll put together a custom proposal.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Company Info */}
          <div className="bg-slate-900 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">About Your Brand</h2>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Company / Brand Name *</label>
              <input required value={form.companyName} onChange={e => setForm(f => ({...f, companyName: e.target.value}))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-[#c9a84c]" placeholder="e.g. Sparkling Co." />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Industry</label>
              <select value={form.industry} onChange={e => setForm(f => ({...f, industry: e.target.value}))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#c9a84c]">
                <option value="">Select industry</option>
                {industryOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Brand Stage</label>
              <select value={form.stage} onChange={e => setForm(f => ({...f, stage: e.target.value}))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#c9a84c]">
                <option value="">Select stage</option>
                {stageOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          {/* Services Needed */}
          <div className="bg-slate-900 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-3">What do you need?</h2>
            <div className="grid grid-cols-2 gap-3">
              {needsOptions.map(n => (
                <button key={n} type="button" onClick={() => toggleNeed(n)}
                  className={`px-4 py-3 rounded-lg border text-sm font-medium transition text-left ${
                    form.needs.includes(n)
                      ? 'bg-[#c9a84c]/20 border-[#c9a84c] text-[#c9a84c]'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Budget & Timeline */}
          <div className="bg-slate-900 rounded-xl p-6 grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Budget Range</label>
              <select value={form.budgetRange} onChange={e => setForm(f => ({...f, budgetRange: e.target.value}))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#c9a84c]">
                <option value="">Select budget</option>
                {budgetOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Timeline</label>
              <select value={form.timeline} onChange={e => setForm(f => ({...f, timeline: e.target.value}))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#c9a84c]">
                <option value="">Select timeline</option>
                {timelineOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          {/* Contact Info */}
          <div className="bg-slate-900 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Your Contact Info</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Your Name *</label>
                <input required value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-[#c9a84c]" />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Email *</label>
                <input required type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-[#c9a84c]" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Phone (optional)</label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-[#c9a84c]" />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Anything else?</label>
              <textarea rows={3} value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-[#c9a84c]"
                placeholder="Tell us about your project, goals, or any specific requirements..." />
            </div>
          </div>

          <button type="submit"
            className="w-full py-3.5 rounded-xl text-white font-semibold text-lg transition hover:opacity-90"
            style={{ backgroundColor: primary }}>
            Send My Project Brief
          </button>
          <p className="text-center text-slate-500 text-sm">We'll respond within 24 hours with a custom proposal.</p>
        </form>
      </div>
    </div>
  );

  // ─── LANDING PAGE ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Navigation */}
      <nav className="border-b border-slate-800/50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <span className="text-xl font-bold">{brand.companyName || 'Ashbi Design'}</span>
          <div className="flex items-center gap-6">
            <a href="#services" className="text-slate-400 hover:text-white text-sm">Services</a>
            <a href="#work" className="text-slate-400 hover:text-white text-sm">Our Work</a>
            <button onClick={() => setShowIntake(true)}
              className="px-5 py-2 rounded-lg text-white text-sm font-semibold transition hover:opacity-90"
              style={{ backgroundColor: primary }}>
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 py-20 md:py-32">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
            {brand.tagline || 'We Build Brands That Sell'}
          </h1>
          <p className="text-lg md:text-xl text-slate-400 mb-8 leading-relaxed">
            {brand.description || 'Ashbi Design is a Toronto-based creative studio helping CPG DTC brands look established and sell more. Packaging, branding, and Shopify — all under one roof.'}
          </p>
          <div className="flex flex-wrap gap-4">
            <button onClick={() => setShowIntake(true)}
              className="px-8 py-3.5 rounded-xl text-white font-semibold text-lg transition hover:opacity-90"
              style={{ backgroundColor: primary }}>
              Start Your Project
            </button>
            <a href="#services"
              className="px-8 py-3.5 rounded-xl border border-slate-700 text-slate-300 font-semibold text-lg hover:border-slate-500 transition">
              See Our Work ↓
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-t border-slate-800/50">
        <div className="max-w-6xl mx-auto px-4 py-12 grid grid-cols-3 gap-8">
          {[
            ['50+', 'Brands Launched'],
            ['200+', 'Projects Delivered'],
            ['98%', 'Client Satisfaction'],
          ].map(([stat, label]) => (
            <div key={label} className="text-center">
              <div className="text-3xl md:text-4xl font-bold mb-1" style={{ color: primary }}>{stat}</div>
              <div className="text-sm text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Services */}
      <section id="services" className="max-w-6xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold mb-4">What We Do</h2>
        <p className="text-slate-400 mb-12 max-w-2xl">
          Full-service creative for CPG DTC brands. From concept to shelf — and the website to sell it.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {services.map(s => (
            <div key={s.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 hover:border-slate-700 transition">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: `${primary}20` }}>
                <span className="text-lg" style={{ color: primary }}>◆</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
              <p className="text-sm text-slate-400 mb-4">{s.description}</p>
              <ul className="space-y-1.5">
                {s.features.map(f => (
                  <li key={f} className="text-xs text-slate-500 flex items-center gap-2">
                    <span style={{ color: primary }}>✓</span> {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Portfolio */}
      <section id="work" className="max-w-6xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold mb-12">Recent Work</h2>
        {portfolio.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {portfolio.map(p => (
              <div key={p.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <div className="w-full h-32 bg-slate-800 rounded-lg mb-4 flex items-center justify-center text-slate-600">
                  {p.logoUrl ? <img src={p.logoUrl} alt={p.name} className="max-h-16 max-w-32" /> : <span className="text-2xl">◻</span>}
                </div>
                <h3 className="font-semibold">{p.name}</h3>
                <p className="text-xs text-slate-500 mt-1">{p.industry || 'CPG Brand'}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-slate-600">
            <p>Portfolio coming soon. In the meantime, <button onClick={() => setShowIntake(true)} className="underline" style={{ color: primary }}>tell us about your project</button>.</p>
          </div>
        )}
      </section>

      {/* CTA */}
      <section className="border-t border-slate-800/50">
        <div className="max-w-3xl mx-auto px-4 py-20 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Build Your Brand?</h2>
          <p className="text-slate-400 mb-8">
            Tell us about your project and we'll get back to you within 24 hours with a custom proposal and timeline.
          </p>
          <button onClick={() => setShowIntake(true)}
            className="px-10 py-4 rounded-xl text-white font-semibold text-lg transition hover:opacity-90"
            style={{ backgroundColor: primary }}>
            Get Started Free
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="text-sm text-slate-500">© {new Date().getFullYear()} {brand.companyName || 'Ashbi Design'}. All rights reserved.</span>
          <div className="flex gap-6 text-sm text-slate-500">
            <a href="mailto:hello@ashbi.ca" className="hover:text-white">hello@ashbi.ca</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
