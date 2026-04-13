import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarDays,
  Clock,
  MapPin,
  Users,
  Trash2,
  Edit3,
  X,
  AlertCircle,
  Phone,
  Bell,
  Milestone,
} from 'lucide-react';
import { api } from '../lib/api';
import Modal from '../components/Modal';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { cn } from '../lib/utils';

// ── Constants ──────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // 8am – 7pm
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SLOT_HEIGHT = 64; // px per hour slot

const EVENT_TYPES = [
  { value: 'MEETING', label: 'Meeting', color: 'bg-indigo-500', border: 'border-indigo-400', text: 'text-indigo-300', bg: 'bg-indigo-500/20' },
  { value: 'CALL', label: 'Call', color: 'bg-emerald-500', border: 'border-emerald-400', text: 'text-emerald-300', bg: 'bg-emerald-500/20' },
  { value: 'DEADLINE', label: 'Deadline', color: 'bg-red-500', border: 'border-red-400', text: 'text-red-300', bg: 'bg-red-500/20' },
  { value: 'REMINDER', label: 'Reminder', color: 'bg-amber-500', border: 'border-amber-400', text: 'text-amber-300', bg: 'bg-amber-500/20' },
];

const TYPE_MAP = Object.fromEntries(EVENT_TYPES.map(t => [t.value, t]));

const TYPE_ICONS = {
  MEETING: CalendarDays,
  CALL: Phone,
  DEADLINE: Milestone,
  REMINDER: Bell,
};

function typeStyle(type) {
  return TYPE_MAP[type] ?? TYPE_MAP.MEETING;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d, n) {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtHour(h) {
  if (h === 0 || h === 24) return '12am';
  if (h === 12) return '12pm';
  return h > 12 ? `${h - 12}pm` : `${h}am`;
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtDateFull(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toLocalInput(date) {
  // Returns YYYY-MM-DDTHH:mm for <input type="datetime-local">
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function roundToNextHour(date) {
  const d = new Date(date);
  if (d.getMinutes() > 0) d.setHours(d.getHours() + 1);
  d.setMinutes(0, 0, 0);
  return d;
}

// ── Create / Edit Modal ────────────────────────────────────────────────────

function EventModal({ isOpen, onClose, initialDate, editEvent, projects = [], team = [] }) {
  const queryClient = useQueryClient();
  const isEdit = !!editEvent;

  const defaultStart = useMemo(() => {
    if (editEvent) return new Date(editEvent.startTime);
    if (initialDate) return roundToNextHour(initialDate);
    return roundToNextHour(new Date());
  }, [editEvent, initialDate]);

  const defaultEnd = useMemo(() => {
    if (editEvent) return new Date(editEvent.endTime);
    const d = new Date(defaultStart);
    d.setHours(d.getHours() + 1);
    return d;
  }, [editEvent, defaultStart]);

  const [form, setForm] = useState({
    title: editEvent?.title || '',
    description: editEvent?.description || '',
    type: editEvent?.type || 'MEETING',
    location: editEvent?.location || '',
    projectId: editEvent?.projectId || '',
    startTime: toLocalInput(defaultStart),
    endTime: toLocalInput(defaultEnd),
    allDay: editEvent?.allDay || false,
    attendeeIds: editEvent?.attendees?.map(a => a.id || a.userId || a) || [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createCalendarEvent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['upcoming-events'] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data) => api.updateCalendarEvent(editEvent.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['upcoming-events'] });
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteCalendarEvent(editEvent.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['upcoming-events'] });
      onClose();
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      startTime: new Date(form.startTime).toISOString(),
      endTime: form.allDay
        ? new Date(new Date(form.startTime).setHours(23, 59, 59)).toISOString()
        : new Date(form.endTime).toISOString(),
    };
    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const toggleAttendee = (id) => {
    setForm(prev => ({
      ...prev,
      attendeeIds: prev.attendeeIds.includes(id)
        ? prev.attendeeIds.filter(x => x !== id)
        : [...prev.attendeeIds, id],
    }));
  };

  const mutation = isEdit ? updateMutation : createMutation;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Edit Event' : 'New Event'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Title *</label>
          <input
            type="text"
            required
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Event title"
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Type</label>
          <div className="flex flex-wrap gap-2">
            {EVENT_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setForm(f => ({ ...f, type: t.value }))}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                  form.type === t.value
                    ? `${t.color} text-white ring-2 ring-offset-2 ring-offset-card ring-white/30`
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* All day toggle */}
        <div className="flex items-center gap-2">
          <input
            id="allDay"
            type="checkbox"
            checked={form.allDay}
            onChange={e => setForm(f => ({ ...f, allDay: e.target.checked }))}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <label htmlFor="allDay" className="text-sm text-foreground">All day</label>
        </div>

        {/* Times */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Start</label>
            <input
              type="datetime-local"
              value={form.startTime}
              onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">End</label>
            <input
              type="datetime-local"
              value={form.endTime}
              onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
              disabled={form.allDay}
              className={cn(
                'w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary',
                form.allDay && 'opacity-50 cursor-not-allowed'
              )}
            />
          </div>
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Location</label>
          <div className="relative">
            <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Add location or meeting link"
            />
          </div>
        </div>

        {/* Project */}
        {projects.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Project</label>
            <select
              value={form.projectId}
              onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">No project</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Attendees */}
        {team.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Attendees</label>
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-2 rounded-lg border border-border bg-card">
              {team.map(member => {
                const selected = form.attendeeIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleAttendee(member.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all',
                      selected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    )}
                  >
                    {member.name || member.email}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Description</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            placeholder="Add details..."
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <div>
            {isEdit && (
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg transition-colors"
            >
              Cancel
            </button>
            <Button
              type="submit"
              isLoading={mutation.isPending}
              disabled={mutation.isPending}
            >
              {isEdit ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>

        {mutation.error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {mutation.error.message || 'Failed to save event'}
          </div>
        )}
      </form>
    </Modal>
  );
}

// ── Event Detail Modal ─────────────────────────────────────────────────────

function EventDetailModal({ event, isOpen, onClose, onEdit }) {
  const queryClient = useQueryClient();
  const [rsvpStatus, setRsvpStatus] = useState(null);

  const style = typeStyle(event?.type);

  const rsvpMutation = useMutation({
    mutationFn: (status) => api.rsvpCalendarEvent(event.id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['upcoming-events'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteCalendarEvent(event.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['upcoming-events'] });
      onClose();
    },
  });

  if (!event) return null;

  const Icon = TYPE_ICONS[event.type] || CalendarDays;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="md">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', style.bg)}>
            <Icon className={cn('w-5 h-5', style.text)} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-foreground truncate">{event.title}</h3>
            <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', style.bg, style.text)}>
              {style.label}
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2 text-foreground">
            <Clock className="w-4 h-4 text-muted-foreground" />
            {event.allDay ? (
              <span>All day &middot; {new Date(event.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            ) : (
              <span>{fmtTime(event.startTime)} &ndash; {fmtTime(event.endTime)}</span>
            )}
          </div>

          {event.location && (
            <div className="flex items-center gap-2 text-foreground">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span>{event.location}</span>
            </div>
          )}

          {event.project?.name && (
            <div className="flex items-center gap-2 text-foreground">
              <Milestone className="w-4 h-4 text-muted-foreground" />
              <span>{event.project.name}</span>
            </div>
          )}

          {event.description && (
            <p className="text-muted-foreground mt-2 whitespace-pre-wrap">{event.description}</p>
          )}

          {event.attendees?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-foreground mb-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">Attendees</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {event.attendees.map((a, i) => (
                  <span key={a.id || i} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                    {a.name || a.email || a}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RSVP */}
        <div className="border-t border-border pt-3">
          <p className="text-sm font-medium text-foreground mb-2">Your RSVP</p>
          <div className="flex gap-2">
            {['ACCEPTED', 'TENTATIVE', 'DECLINED'].map(status => (
              <button
                key={status}
                onClick={() => { setRsvpStatus(status); rsvpMutation.mutate(status); }}
                disabled={rsvpMutation.isPending}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  rsvpStatus === status
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {status === 'ACCEPTED' ? 'Accept' : status === 'TENTATIVE' ? 'Maybe' : 'Decline'}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg transition-colors"
            >
              Close
            </button>
            <Button onClick={() => onEdit(event)}>
              <Edit3 className="w-4 h-4 mr-1.5" /> Edit
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Upcoming Sidebar ───────────────────────────────────────────────────────

function UpcomingSidebar({ onEventClick }) {
  const { data: upcoming = [], isLoading } = useQuery({
    queryKey: ['upcoming-events'],
    queryFn: () => api.getUpcomingEvents(10),
    refetchInterval: 60000,
  });

  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-heading font-semibold text-foreground">Upcoming</h3>
      </div>
      <div className="divide-y divide-border max-h-[calc(100vh-260px)] overflow-y-auto">
        {isLoading && (
          <div className="px-4 py-6 text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto" />
          </div>
        )}
        {!isLoading && upcoming.length === 0 && (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">
            No upcoming events
          </div>
        )}
        {upcoming.map(event => {
          const style = typeStyle(event.type);
          const Icon = TYPE_ICONS[event.type] || CalendarDays;
          return (
            <button
              key={event.id}
              onClick={() => onEventClick(event)}
              className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start gap-2.5">
                <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', style.color)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{event.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {event.allDay
                      ? new Date(event.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : fmtTime(event.startTime)}
                    {' '}
                    <span className={cn('ml-1', style.text)}>{style.label}</span>
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function Schedule() {
  const queryClient = useQueryClient();
  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date()));
  const [showCreate, setShowCreate] = useState(false);
  const [clickedSlot, setClickedSlot] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);

  // Week range for query
  const weekEnd = addDays(currentWeekStart, 7);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['calendar', currentWeekStart.toISOString()],
    queryFn: () => api.getCalendarEvents({
      startDate: currentWeekStart.toISOString(),
      endDate: weekEnd.toISOString(),
    }),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.getProjects({ status: 'ACTIVE' }),
  });

  const { data: team = [] } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.getTeam(),
  });

  // Separate all-day and timed events
  const allDayEvents = useMemo(() => events.filter(e => e.allDay), [events]);
  const timedEvents = useMemo(() => events.filter(e => !e.allDay), [events]);

  // Build days array
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  }, [currentWeekStart]);

  // Get events for a specific day
  const getTimedEventsForDay = useCallback((day) => {
    return timedEvents.filter(e => sameDay(new Date(e.startTime), day));
  }, [timedEvents]);

  const getAllDayEventsForDay = useCallback((day) => {
    return allDayEvents.filter(e => sameDay(new Date(e.startTime), day));
  }, [allDayEvents]);

  // Navigation
  const prevWeek = () => setCurrentWeekStart(prev => addDays(prev, -7));
  const nextWeek = () => setCurrentWeekStart(prev => addDays(prev, 7));
  const goToday = () => setCurrentWeekStart(startOfWeek(new Date()));

  // Slot click handler
  const handleSlotClick = (day, hour) => {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    setClickedSlot(start);
    setShowCreate(true);
  };

  // Event click handler
  const handleEventClick = (event) => {
    setSelectedEvent(event);
  };

  // Edit handler from detail modal
  const handleEditFromDetail = (event) => {
    setSelectedEvent(null);
    setEditingEvent(event);
    setShowCreate(true);
  };

  // Close create/edit modal
  const handleCloseCreate = () => {
    setShowCreate(false);
    setEditingEvent(null);
    setClickedSlot(null);
  };

  // Compute event positions (overlap-aware simple layout)
  const getEventPositions = useCallback((dayEvents) => {
    if (!dayEvents.length) return [];

    // Sort by start time, then by duration (longer first for stability)
    const sorted = [...dayEvents].sort((a, b) => {
      const aStart = new Date(a.startTime);
      const bStart = new Date(b.startTime);
      if (aStart < bStart) return -1;
      if (aStart > bStart) return 1;
      const aDur = new Date(a.endTime) - aStart;
      const bDur = new Date(b.endTime) - bStart;
      return bDur - aDur;
    });

    const columns = []; // columns[row] = endTime of last event in column
    const placements = [];

    for (const event of sorted) {
      const start = new Date(event.startTime);
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        if (start >= columns[col]) {
          columns[col] = new Date(event.endTime);
          placements.push({ event, col, totalCols: 0 });
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push(new Date(event.endTime));
        placements.push({ event, col: columns.length - 1, totalCols: 0 });
      }
    }

    // Set totalCols for all placements in the same group
    const totalCols = columns.length;
    placements.forEach(p => (p.totalCols = totalCols));

    return placements;
  }, []);

  const today = new Date();

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Schedule</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {weekDays[0].toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
            {' \u2013 '}
            {weekDays[6].toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday}>
            Today
          </Button>
          <button
            onClick={prevWeek}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={nextWeek}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Next week"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <Button size="sm" onClick={() => { setClickedSlot(new Date()); setShowCreate(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> New Event
          </Button>
        </div>
      </div>

      {/* Layout: Calendar + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Calendar */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* All-day row */}
          {allDayEvents.length > 0 && (
            <div className="border-b border-border">
              <div className="grid grid-cols-[56px_repeat(7,1fr)]">
                <div className="px-2 py-2 text-xs text-muted-foreground text-right border-r border-border">
                  all-day
                </div>
                {weekDays.map(day => {
                  const dayAllDay = getAllDayEventsForDay(day);
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        'px-1 py-1 border-r border-border last:border-r-0 min-h-[36px]',
                        sameDay(day, today) && 'bg-primary/5'
                      )}
                    >
                      {dayAllDay.map(event => {
                        const style = typeStyle(event.type);
                        return (
                          <button
                            key={event.id}
                            onClick={() => handleEventClick(event)}
                            className={cn(
                              'w-full text-left block text-xs font-medium px-1.5 py-0.5 rounded truncate mb-0.5',
                              style.bg, style.text, 'hover:opacity-80 transition-opacity'
                            )}
                          >
                            {event.title}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timed grid */}
          <div className="overflow-y-auto max-h-[calc(100vh-280px)]">
            <div className="grid grid-cols-[56px_repeat(7,1fr)]">
              {/* Time labels column */}
              <div className="border-r border-border">
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className="px-2 text-xs text-muted-foreground text-right pr-3 border-b border-border"
                    style={{ height: SLOT_HEIGHT }}
                  >
                    <span className="translate-y-[-6px] inline-block">{fmtHour(hour)}</span>
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {weekDays.map(day => {
                const dayEvents = getTimedEventsForDay(day);
                const positions = getEventPositions(dayEvents);
                const isToday = sameDay(day, today);

                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      'relative border-r border-border last:border-r-0',
                      isToday && 'bg-primary/[0.03]'
                    )}
                  >
                    {/* Hour slots (clickable) */}
                    {HOURS.map(hour => (
                      <div
                        key={hour}
                        className="border-b border-border cursor-pointer hover:bg-muted/30 transition-colors"
                        style={{ height: SLOT_HEIGHT }}
                        onClick={() => handleSlotClick(day, hour)}
                      />
                    ))}

                    {/* Current time indicator */}
                    {isToday && (() => {
                      const now = new Date();
                      const hour = now.getHours();
                      const min = now.getMinutes();
                      if (hour >= 8 && hour < 20) {
                        const top = ((hour - 8) * 60 + min) / 60 * SLOT_HEIGHT;
                        return (
                          <div
                            className="absolute left-0 right-0 h-0.5 bg-[#e6f354] z-20 pointer-events-none"
                            style={{ top }}
                          >
                            <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-[#e6f354]" />
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Events */}
                    {positions.map(({ event, col, totalCols }) => {
                      const start = new Date(event.startTime);
                      const end = new Date(event.endTime);
                      const startMinutes = (start.getHours() - 8) * 60 + start.getMinutes();
                      const endMinutes = (end.getHours() - 8) * 60 + end.getMinutes();
                      const durationMinutes = Math.max(endMinutes - startMinutes, 15);
                      const top = (startMinutes / 60) * SLOT_HEIGHT;
                      const height = (durationMinutes / 60) * SLOT_HEIGHT;
                      const width = 100 / totalCols;
                      const left = col * width;
                      const style = typeStyle(event.type);

                      return (
                        <button
                          key={event.id}
                          onClick={(e) => { e.stopPropagation(); handleEventClick(event); }}
                          className={cn(
                            'absolute left-0 rounded-lg text-left overflow-hidden cursor-pointer transition-all',
                            'hover:z-30 hover:shadow-lg hover:brightness-110',
                            'border-l-3',
                            style.bg, style.border,
                            'focus:outline-none focus:ring-2 focus:ring-primary/50'
                          )}
                          style={{
                            top: `${top}px`,
                            height: `${Math.max(height, 24)}px`,
                            width: `${width}%`,
                            left: `${left}%`,
                            paddingLeft: col === 0 ? '6px' : '4px',
                          }}
                          title={`${event.title}\n${fmtTime(event.startTime)} - ${fmtTime(event.endTime)}`}
                        >
                          <div className="px-1 py-0.5 h-full flex flex-col justify-start">
                            <p className={cn('text-xs font-semibold leading-tight truncate', style.text)}>
                              {event.title}
                            </p>
                            {height > 36 && (
                              <p className={cn('text-[10px] leading-tight truncate', style.text, 'opacity-75')}>
                                {fmtTime(event.startTime)}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <UpcomingSidebar onEventClick={handleEventClick} />

          {/* Mini legend */}
          <Card variant="default" padding="sm">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Event Types</h4>
            <div className="space-y-1.5">
              {EVENT_TYPES.map(t => (
                <div key={t.value} className="flex items-center gap-2 text-xs">
                  <span className={cn('w-2.5 h-2.5 rounded-full', t.color)} />
                  <span className="text-foreground">{t.label}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Create / Edit Modal */}
      <EventModal
        isOpen={showCreate}
        onClose={handleCloseCreate}
        initialDate={clickedSlot}
        editEvent={editingEvent}
        projects={projects}
        team={team}
      />

      {/* Detail Modal */}
      <EventDetailModal
        event={selectedEvent}
        isOpen={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onEdit={handleEditFromDetail}
      />
    </div>
  );
}