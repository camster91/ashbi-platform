import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, Plus, ChevronLeft, ChevronRight, Trash2, X, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const EVENT_TYPES = ['blog_post', 'social_post', 'email', 'video', 'design', 'meeting', 'other'];
const STATUS_COLORS = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export default function ContentCalendar() {
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [newEvent, setNewEvent] = useState({
    title: '', description: '', type: 'blog_post', publishDate: '', channels: '', clientId: '', assignedTo: ''
  });

  const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['content-events', startOfMonth.toISOString(), endOfMonth.toISOString()],
    queryFn: () => api.getContentEvents({
      startDate: startOfMonth.toISOString(),
      endDate: endOfMonth.toISOString(),
    }),
  });

  const { data: upcoming = [] } = useQuery({
    queryKey: ['content-upcoming'],
    queryFn: () => api.getUpcomingContent(10),
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createContentEvent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-events'] });
      setShowAdd(false);
      setNewEvent({ title: '', description: '', type: 'blog_post', publishDate: '', channels: '', clientId: '', assignedTo: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteContentEvent(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['content-events'] }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => api.updateContentEventStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['content-events'] }),
  });

  // Calendar grid
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const days = [];

    // Previous month padding
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ date: new Date(year, month - 1, daysInPrevMonth - i), isCurrentMonth: false });
    }
    // Current month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }
    // Next month padding
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
    return days;
  }, [currentMonth]);

  const getEventsForDay = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    return events.filter(e => (e.publishDate || e.publish_date || '').startsWith(dateStr));
  };

  const handleCreate = (e) => {
    e.preventDefault();
    createMutation.mutate({
      ...newEvent,
      channels: newEvent.channels ? newEvent.channels.split(',').map(c => c.trim()) : [],
      clientId: newEvent.clientId || undefined,
      assignedTo: newEvent.assignedTo || undefined,
    });
  };

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  const today = new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary" />
            Content Calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Plan and schedule your content</p>
        </div>
        <Button onClick={() => setShowAdd(true)} leftIcon={<Plus className="w-4 h-4" />}>
          Add Event
        </Button>
      </div>

      {/* Calendar */}
      <Card className="overflow-hidden">
        {/* Month navigation */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button onClick={prevMonth} className="p-1.5 rounded hover:bg-muted transition-colors"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold">{MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}</h2>
          <button onClick={nextMonth} className="p-1.5 rounded hover:bg-muted transition-colors"><ChevronRight className="w-5 h-5" /></button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {DAYS.map(day => (
            <div key={day} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground uppercase">{day}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {calendarDays.map(({ date, isCurrentMonth }, i) => {
            const dayEvents = getEventsForDay(date);
            const isToday = date.toDateString() === today.toDateString();
            return (
              <div key={i} className={`min-h-[80px] p-1 border-b border-r border-border last:border-r-0 ${!isCurrentMonth ? 'bg-muted/30' : ''} ${isToday ? 'bg-primary/5' : ''}`}>
                <span className={`text-xs font-medium ${isToday ? 'text-primary' : isCurrentMonth ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {date.getDate()}
                </span>
                <div className="mt-0.5 space-y-0.5">
                  {dayEvents.slice(0, 2).map(event => (
                    <button key={event.id} onClick={() => setSelectedEvent(event)}
                      className="w-full text-left text-[10px] px-1 py-0.5 rounded truncate bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                      {event.title}
                    </button>
                  ))}
                  {dayEvents.length > 2 && (
                    <span className="text-[10px] text-muted-foreground">+{dayEvents.length - 2} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Upcoming deadlines */}
      {upcoming.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Upcoming
          </h2>
          <div className="space-y-2">
            {upcoming.map(event => (
              <Card key={event.id} className="p-3 flex items-center justify-between cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => setSelectedEvent(event)}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.publishDate || event.publish_date).toLocaleDateString()} &middot; {event.type}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[event.status] || STATUS_COLORS.draft}`}>
                  {event.status}
                </span>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Add Event Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAdd(false)}>
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Add Content Event</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input type="text" value={newEvent.title} onChange={e => setNewEvent({ ...newEvent, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea value={newEvent.description} onChange={e => setNewEvent({ ...newEvent, description: e.target.value })}
                  rows={3} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Type</label>
                  <select value={newEvent.type} onChange={e => setNewEvent({ ...newEvent, type: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                    {EVENT_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Publish Date</label>
                  <input type="datetime-local" value={newEvent.publishDate} onChange={e => setNewEvent({ ...newEvent, publishDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Channels (comma-separated)</label>
                <input type="text" value={newEvent.channels} onChange={e => setNewEvent({ ...newEvent, channels: e.target.value })}
                  placeholder="blog, instagram, email"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button type="submit" loading={createMutation.isPending}>Create Event</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedEvent(null)}>
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{selectedEvent.title}</h3>
              <button onClick={() => setSelectedEvent(null)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[selectedEvent.status] || STATUS_COLORS.draft}`}>
                  {selectedEvent.status}
                </span>
                <span className="text-xs text-muted-foreground">{selectedEvent.type}</span>
              </div>
              {selectedEvent.description && <p className="text-sm text-muted-foreground">{selectedEvent.description}</p>}
              <p className="text-xs text-muted-foreground">
                {new Date(selectedEvent.publishDate || selectedEvent.publish_date).toLocaleString()}
              </p>
              {selectedEvent.channels && (
                <div className="flex flex-wrap gap-1">
                  {(Array.isArray(selectedEvent.channels) ? selectedEvent.channels : [selectedEvent.channels]).map((ch, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{ch}</span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 pt-2">
                {selectedEvent.status === 'draft' && (
                  <Button size="sm" onClick={() => { statusMutation.mutate({ id: selectedEvent.id, status: 'scheduled' }); setSelectedEvent(null); }}>
                    Schedule
                  </Button>
                )}
                {selectedEvent.status === 'scheduled' && (
                  <Button size="sm" onClick={() => { statusMutation.mutate({ id: selectedEvent.id, status: 'published' }); setSelectedEvent(null); }}>
                    Mark Published
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => { if (confirm('Delete this event?')) { deleteMutation.mutate(selectedEvent.id); setSelectedEvent(null); } }}
                  className="text-red-500 hover:text-red-600">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}