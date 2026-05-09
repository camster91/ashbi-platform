import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Phone, Calendar, Plus, Search, Clock, MapPin, Users, Sparkles,
  ChevronRight, Loader2, X, CheckCircle, ExternalLink, FileText,
  BarChart3, Ban, History, TrendingUp, PhoneCall, PhoneOff
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';

const STATUS_COLORS = {
  QUEUED: 'bg-blue-100 text-blue-700',
  SCRIPT_READY: 'bg-green-100 text-green-700',
  SCHEDULED: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-gray-100 text-gray-700',
};

const CALL_LOG_STATUS_COLORS = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  SCREENED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FOLLOW_UP_SENT: 'bg-purple-100 text-purple-700',
};

const AREA_CODES = [
  { code: '310', neighborhood: 'Los Angeles (West)' },
  { code: '323', neighborhood: 'Los Angeles (East)' },
  { code: '415', neighborhood: 'San Francisco' },
  { code: '212', neighborhood: 'New York City' },
  { code: '305', neighborhood: 'Miami' },
  { code: '512', neighborhood: 'Austin' },
];

function ScriptModal({ lead, script, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Call Script — {lead.name}</h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">{lead.businessType} · {lead.phone}</p>
        <div className="bg-muted/50 rounded-lg p-4 max-h-96 overflow-y-auto">
          <pre className="text-sm whitespace-pre-wrap font-sans text-foreground/90 leading-relaxed">{script || 'No script available yet. Click "Generate Script" to create one.'}</pre>
        </div>
        <div className="flex justify-end pt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-lg hover:bg-muted/80">Close</button>
        </div>
      </div>
    </div>
  );
}

function ScheduleModal({ lead, onClose, onScheduled }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleSchedule = async () => {
    if (!date || !time) {
      toast.error('Please select both date and time');
      return;
    }
    setLoading(true);
    try {
      const scheduledAt = new Date(`${date}T${time}`).toISOString();
      const result = await api.request('/cold-call/schedule', {
        method: 'POST',
        body: { leadId: lead.id, scheduledAt, notes },
      });
      if (result.error) {
        toast.error(result.message || result.error);
      } else {
        toast.success(`Call scheduled for ${new Date(scheduledAt).toLocaleString()}`);
        onScheduled();
        onClose();
      }
    } catch (err) {
      toast.error('Failed to schedule: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Schedule Call — {lead.name}</h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">{lead.businessType} · {lead.phone}</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Time (9am–5pm ET)</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              placeholder="Call objectives, talking points..." />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={handleSchedule} disabled={loading}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Schedule Call
          </button>
        </div>
      </div>
    </div>
  );
}

function CallLogModal({ lead, onClose, onLogged }) {
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('COMPLETED');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleLog = async () => {
    setLoading(true);
    try {
      await api.request('/cold-call/log', {
        method: 'POST',
        body: {
          callerName: lead.name,
          callerNumber: lead.phone,
          callerCompany: lead.businessType,
          callSummary: outcome,
          callNotes: notes,
          status,
        },
      });
      toast.success('Call logged successfully');
      onLogged();
      onClose();
    } catch (err) {
      toast.error('Failed to log call: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Log Call — {lead.name}</h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Outcome *</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="COMPLETED">Connected — Completed</option>
              <option value="SCREENED">Connected — Screening</option>
              <option value="FOLLOW_UP_SENT">Follow-up Sent</option>
              <option value="PENDING">No Answer</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Summary</label>
            <textarea value={outcome} onChange={e => setOutcome(e.target.value)} rows={2}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              placeholder="What happened during the call? Interested? Meeting booked?" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              placeholder="Next steps, follow-up needed..." />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={handleLog} disabled={loading}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Log Call
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CallBlock() {
  const toast = useToast();
  const [selectedAreaCode, setSelectedAreaCode] = useState('all');
  const [scheduleLead, setScheduleLead] = useState(null);
  const [scriptLead, setScriptLead] = useState(null);
  const [scriptText, setScriptText] = useState(null);
  const [logLead, setLogLead] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('queue');
  const queryClient = useQueryClient();

  // Queue leads
  const { data: leads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ['call-block', 'leads', selectedAreaCode],
    queryFn: () => api.request(`/cold-call/queue${selectedAreaCode !== 'all' ? `?areaCode=${selectedAreaCode}` : ''}`, { silent: true })
      .catch(() => [
        { id: 1, name: 'Fresh Press Juicery', phone: '(310) 555-0142', businessType: 'CPG - Juice', areaCode: '310', status: 'QUEUED', neighborhood: 'Santa Monica' },
        { id: 2, name: 'Bold Bean Coffee', phone: '(310) 555-0187', businessType: 'CPG - Coffee', areaCode: '310', status: 'SCRIPT_READY', neighborhood: 'Venice' },
        { id: 3, name: 'Terra Home Goods', phone: '(415) 555-0234', businessType: 'E-Commerce', areaCode: '415', status: 'QUEUED', neighborhood: 'SOMA' },
        { id: 4, name: 'Coastal Pet Supply', phone: '(415) 555-0456', businessType: 'CPG - Pet', areaCode: '415', status: 'SCRIPT_READY', neighborhood: 'Marina' },
        { id: 5, name: 'Urban Garden Co', phone: '(212) 555-0678', businessType: 'E-Commerce', areaCode: '212', status: 'QUEUED', neighborhood: 'Brooklyn' },
        { id: 6, name: 'Summit Outdoor Gear', phone: '(512) 555-0890', businessType: 'E-Commerce', areaCode: '512', status: 'SCHEDULED', neighborhood: 'Downtown' },
        { id: 7, name: 'Nourish Organics', phone: '(305) 555-0123', businessType: 'CPG - Food', areaCode: '305', status: 'SCRIPT_READY', neighborhood: 'Wynwood' },
        { id: 8, name: 'Coastal Coffee Roasters', phone: '(323) 555-0456', businessType: 'CPG - Coffee', areaCode: '323', status: 'QUEUED', neighborhood: 'Silver Lake' },
      ]),
  });

  // Scheduled calls
  const { data: scheduledCalls = [] } = useQuery({
    queryKey: ['call-block', 'scheduled'],
    queryFn: () => api.request('/cold-call/scheduled', { silent: true })
      .catch(() => [
        { id: 1, lead: 'Summit Outdoor Gear', time: '2026-05-08T10:00', areaCode: '512' },
        { id: 2, lead: 'Terra Home Goods', time: '2026-05-08T14:30', areaCode: '415' },
        { id: 3, lead: 'Fresh Press Juicery', time: '2026-05-09T09:00', areaCode: '310' },
        { id: 4, lead: 'Bold Bean Coffee', time: '2026-05-09T11:00', areaCode: '310' },
      ]),
  });

  // Call logs
  const { data: callLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['call-block', 'logs'],
    queryFn: () => api.request('/cold-call/logs', { silent: true })
      .then(res => res.logs || [])
      .catch(() => []),
    enabled: activeTab === 'logs',
  });

  // Call stats
  const { data: stats } = useQuery({
    queryKey: ['call-block', 'stats'],
    queryFn: () => api.request('/cold-call/stats', { silent: true })
      .catch(() => ({ totalCalls: 0, completed: 0, screened: 0, pending: 0, followUpSent: 0, scheduledLeads: 0, connectRate: 0 })),
  });

  // DNC list
  const { data: dncList = [] } = useQuery({
    queryKey: ['call-block', 'dnc'],
    queryFn: () => api.request('/cold-call/dnc', { silent: true })
      .then(res => res.dnc || [])
      .catch(() => []),
    enabled: activeTab === 'dnc',
  });

  const generateScript = useMutation({
    mutationFn: (leadId) => api.request('/cold-call/generate-script', { method: 'POST', body: { leadId } }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['call-block'] });
      setScriptText(data.script);
      toast.success('Script generated successfully');
    },
    onError: () => toast.error('Failed to generate script'),
  });

  const addToDNC = useMutation({
    mutationFn: (leadId) => api.request('/cold-call/dnc', { method: 'POST', body: { leadId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['call-block'] });
      toast.success('Added to Do Not Call list');
    },
    onError: () => toast.error('Failed to add to DNC'),
  });

  const scheduleFollowUp = useMutation({
    mutationFn: (leadId) => api.request('/cold-call/follow-up', { method: 'POST', body: { leadId } }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['call-block'] });
      toast.success(`Follow-up scheduled for ${new Date(data.followUpAt).toLocaleDateString()}`);
    },
    onError: () => toast.error('Failed to schedule follow-up'),
  });

  const filteredLeads = leads.filter(l =>
    (selectedAreaCode === 'all' || l.areaCode === selectedAreaCode) &&
    (!searchQuery || l.name.toLowerCase().includes(searchQuery.toLowerCase()) || l.businessType.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Group scheduled calls by date
  const scheduledByDate = {};
  scheduledCalls.forEach(call => {
    const dateKey = call.time ? new Date(call.time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Unscheduled';
    if (!scheduledByDate[dateKey]) scheduledByDate[dateKey] = [];
    scheduledByDate[dateKey].push(call);
  });

  const tabs = [
    { id: 'queue', label: 'Call Queue', icon: Phone },
    { id: 'logs', label: 'Call Log', icon: History },
    { id: 'dnc', label: 'DNC List', icon: Ban },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Phone className="w-7 h-7 text-primary" /> Call Block
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Cold call queue, script generation, and scheduling</p>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-card rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Total Calls</p>
            <p className="text-xl font-bold">{stats.totalCalls || 0}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Connect Rate</p>
            <p className="text-xl font-bold text-green-600">{stats.connectRate || 0}%</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Completed</p>
            <p className="text-xl font-bold">{stats.completed || 0}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Scheduled</p>
            <p className="text-xl font-bold text-amber-600">{stats.scheduledLeads || 0}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Follow-ups</p>
            <p className="text-xl font-bold text-purple-600">{stats.followUpSent || 0}</p>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-muted/50 p-1 rounded-lg w-fit">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={cn('flex items-center gap-1.5 px-4 py-2 text-sm rounded-md transition-colors',
              activeTab === tab.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ───── Left: Main Content ───── */}
        <div className="lg:col-span-2 space-y-4">
          {activeTab === 'queue' && (
            <>
              {/* Area code filters */}
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setSelectedAreaCode('all')}
                  className={cn('px-3 py-1.5 text-sm rounded-lg transition-colors',
                    selectedAreaCode === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}>All Areas</button>
                {AREA_CODES.map(ac => (
                  <button key={ac.code} onClick={() => setSelectedAreaCode(ac.code)}
                    className={cn('px-3 py-1.5 text-sm rounded-lg transition-colors',
                      selectedAreaCode === ac.code ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    )}>
                    ({ac.code}) {ac.neighborhood}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search leads..."
                  className="w-full pl-9 pr-4 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>

              {leadsLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : filteredLeads.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Phone className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No leads in queue</p>
                  <p className="text-sm">Leads will appear here when added to your call block</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredLeads.map(lead => (
                    <div key={lead.id} className={cn('bg-card rounded-xl border border-border p-4 hover:shadow-md transition-shadow', lead.dnc && 'opacity-60')}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium truncate">{lead.name}</h3>
                            <span className={cn('px-1.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', STATUS_COLORS[lead.status] || 'bg-muted text-muted-foreground')}>
                              {lead.status === 'SCRIPT_READY' ? 'Script Ready' : lead.status === 'SCHEDULED' ? 'Scheduled' : 'Queued'}
                            </span>
                            {lead.dnc && <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">DNC</span>}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {lead.phone}</span>
                            <span>{lead.businessType}</span>
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {lead.neighborhood}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {lead.status !== 'SCRIPT_READY' && !lead.dnc && (
                            <button
                              onClick={() => { setScriptLead(lead); generateScript.mutate(lead.id); }}
                              disabled={generateScript.isPending}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 rounded-lg transition-colors"
                            >
                              {generateScript.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                              Script
                            </button>
                          )}
                          {lead.status === 'SCRIPT_READY' && !lead.dnc && (
                            <button
                              onClick={() => { setScriptLead(lead); setScriptText(lead.script || 'Script preview not available'); }}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 rounded-lg transition-colors"
                            >
                              <FileText className="w-3 h-3" /> View
                            </button>
                          )}
                          {!lead.dnc && (
                            <button
                              onClick={() => setScheduleLead(lead)}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                            >
                              <Calendar className="w-3 h-3" /> Schedule
                            </button>
                          )}
                          <button
                            onClick={() => setLogLead(lead)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 rounded-lg transition-colors"
                          >
                            <History className="w-3 h-3" /> Log
                          </button>
                          {!lead.dnc && (
                            <button
                              onClick={() => addToDNC.mutate(lead.id)}
                              disabled={addToDNC.isPending}
                              className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Add to Do Not Call list"
                            >
                              <Ban className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'logs' && (
            <>
              {logsLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : callLogs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No call logs yet</p>
                  <p className="text-sm">Logged calls will appear here</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {callLogs.map(log => (
                    <div key={log.id} className="bg-card rounded-xl border border-border p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium">{log.callerName}</h3>
                            <span className={cn('px-1.5 py-0.5 rounded-full text-xs font-medium', CALL_LOG_STATUS_COLORS[log.status] || 'bg-muted text-muted-foreground')}>
                              {log.status?.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            {log.callerNumber && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {log.callerNumber}</span>}
                            {log.callerCompany && <span>{log.callerCompany}</span>}
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(log.calledAt).toLocaleDateString()}</span>
                          </div>
                          {log.callSummary && <p className="text-sm mt-2 text-muted-foreground">{log.callSummary}</p>}
                          {log.callNotes && <p className="text-xs mt-1 text-muted-foreground/70 italic">{log.callNotes}</p>}
                        </div>
                        {log.status === 'COMPLETED' && (
                          <button
                            onClick={() => scheduleFollowUp.mutate(log.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 rounded-lg transition-colors"
                          >
                            <TrendingUp className="w-3 h-3" /> Follow-up
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'dnc' && (
            <>
              {dncList.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Ban className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">DNC list is empty</p>
                  <p className="text-sm">Leads marked "Do Not Call" will appear here</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {dncList.map(dnc => (
                    <div key={dnc.id} className="bg-card rounded-xl border border-border p-4 opacity-70">
                      <div className="flex items-center gap-2">
                        <Ban className="w-4 h-4 text-red-500" />
                        <h3 className="font-medium">{dnc.name}</h3>
                        <span className="text-xs text-muted-foreground">{dnc.company}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {dnc.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {dnc.phone}</span>}
                        <span>{dnc.industry}</span>
                        <span>DNC since {new Date(dnc.dncAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ───── Right: Calendar / Scheduled ───── */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-primary" /> Scheduled Call Blocks
          </h3>

          {Object.keys(scheduledByDate).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground bg-card rounded-xl border border-border">
              <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No calls scheduled</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(scheduledByDate).map(([dateKey, calls]) => (
                <div key={dateKey} className="bg-card rounded-xl border border-border p-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2">{dateKey}</p>
                  <div className="space-y-2">
                    {calls.map(call => (
                      <div key={call.id} className="flex items-center gap-2 text-sm">
                        <div className="w-14 text-xs text-muted-foreground font-medium">
                          {call.time ? new Date(call.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
                        </div>
                        <div className="flex-1 truncate font-medium">{call.lead}</div>
                        <div className="text-xs text-muted-foreground">({call.areaCode})</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Neighborhood grouping hint */}
          <div className="bg-muted/30 rounded-xl p-3 border border-border">
            <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2">
              <MapPin className="w-3 h-3" /> Batch Scheduling
            </h4>
            <p className="text-xs text-muted-foreground">
              Group calls by neighborhood to maximize efficiency. Schedule multiple calls in the same area code back-to-back.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {AREA_CODES.slice(0, 3).map(ac => (
                <button key={ac.code} onClick={() => { setSelectedAreaCode(ac.code); setActiveTab('queue'); }}
                  className="px-2 py-1 text-xs bg-muted rounded-lg hover:bg-muted/80 transition-colors">
                  ({ac.code}) {leads.filter(l => l.areaCode === ac.code).length} leads
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {scheduleLead && (
        <ScheduleModal
          lead={scheduleLead}
          onClose={() => setScheduleLead(null)}
          onScheduled={() => queryClient.invalidateQueries({ queryKey: ['call-block'] })}
        />
      )}
      {scriptLead && scriptText && (
        <ScriptModal
          lead={scriptLead}
          script={scriptText}
          onClose={() => { setScriptLead(null); setScriptText(null); }}
        />
      )}
      {logLead && (
        <CallLogModal
          lead={logLead}
          onClose={() => setLogLead(null)}
          onLogged={() => queryClient.invalidateQueries({ queryKey: ['call-block'] })}
        />
      )}
    </div>
  );
}
