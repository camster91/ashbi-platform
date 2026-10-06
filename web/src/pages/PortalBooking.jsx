import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  CheckCircle,
  Calendar,
  Clock,
  User,
  Mail,
  MessageSquare,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { api } from '../lib/api';
import PortalBrand, { PortalBrandFooter } from '../components/PortalBrand';
import { cn } from '../lib/utils';
import usePortalLightTheme from '../hooks/usePortalLightTheme';

/**
 * The booking slots are in the server's local time: GET
 * /portal/booking/availability returns each slot's wall-clock `time` ("HH:MM",
 * server-local) and its absolute `start` (ISO, UTC). There is no configured
 * booking timezone to name, but the two together give the server's UTC
 * offset for that day, so the page can say which time the slots are in.
 * Returns e.g. "UTC-4", "UTC+5:30" or "UTC", or null when it cannot tell.
 */
export function slotUtcOffsetLabel(date, slot) {
  if (!slot || typeof slot !== 'object' || !slot.start || !slot.time || !date) return null;
  const [y, m, d] = String(date).split('-').map(Number);
  const [hh, mm] = String(slot.time).split(':').map(Number);
  const start = Date.parse(slot.start);
  if ([y, m, d, hh, mm, start].some((n) => !Number.isFinite(n))) return null;
  const offsetMinutes = Math.round((Date.UTC(y, m - 1, d, hh, mm) - start) / 60000);
  if (offsetMinutes === 0) return 'UTC';
  const sign = offsetMinutes > 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
}

function getDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function MiniCalendar({ selectedDate, onSelect }) {
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // Ref + index for keyboard navigation (arrow keys move focus across days)
  const gridRef = useRef(null);
  // Tracks which day the user is focused on so PageUp/PageDown can
  // refocus the equivalent day in the new month (instead of leaving
  // focus on a now-hidden day).
  const [focusedDate, setFocusedDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

  // After viewMonth changes (PageUp/Down / month nav buttons), refocus the
  // cell that corresponds to focusedDate. Without this, focus stays on a
  // day in the now-hidden month and screen-reader / keyboard users lose
  // their place.
  useEffect(() => {
    if (!gridRef.current) return;
    const target = gridRef.current.querySelector(
      `[data-date="${focusedDate.toISOString().slice(0, 10)}"]`
    );
    if (target) target.focus();
  }, [viewMonth, focusedDate]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => setViewMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setViewMonth(new Date(year, month + 1, 1));

  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  // Keyboard navigation across the day grid. Arrow keys move focus by ±1 day
  // (left/right) or ±7 days (up/down). Home/End jump to start/end of week.
  // Enter/Space select the focused day. PageUp/PageDown change month.
  const handleGridKeyDown = (e) => {
    const focusable = Array.from(gridRef.current?.querySelectorAll('[role="gridcell"]:not([disabled])') ?? []);
    const currentIndex = focusable.indexOf(document.activeElement);
    if (currentIndex === -1 && !['PageUp','PageDown','Home','End'].includes(e.key)) return;
    const total = focusable.length;
    let nextIndex = currentIndex;
    switch (e.key) {
      case 'ArrowRight': nextIndex = Math.min(currentIndex + 1, total - 1); break;
      case 'ArrowLeft': nextIndex = Math.max(currentIndex - 1, 0); break;
      case 'ArrowDown': nextIndex = Math.min(currentIndex + 7, total - 1); break;
      case 'ArrowUp': nextIndex = Math.max(currentIndex - 7, 0); break;
      case 'Home': nextIndex = currentIndex - (currentIndex % 7); break;
      case 'End': nextIndex = Math.min(currentIndex + (6 - (currentIndex % 7)), total - 1); break;
      case 'PageUp':
        e.preventDefault();
        // Move focusedDate back by 1 month — the useEffect refocuses the
        // equivalent day in the new view once it renders.
        setFocusedDate(new Date(focusedDate.getFullYear(), focusedDate.getMonth() - 1, focusedDate.getDate()));
        prevMonth();
        return;
      case 'PageDown':
        e.preventDefault();
        setFocusedDate(new Date(focusedDate.getFullYear(), focusedDate.getMonth() + 1, focusedDate.getDate()));
        nextMonth();
        return;
      default: return;
    }
    e.preventDefault();
    focusable[nextIndex]?.focus();
    // Track focusedDate for the same-month arrow/Home/End keys so a later
    // PageUp/Down has a sane seed.
    const focused = focusable[nextIndex];
    if (focused?.dataset?.date) {
      const [y, m, d] = focused.dataset.date.split('-').map(Number);
      setFocusedDate(new Date(y, m - 1, d));
    }
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} role="gridcell" aria-hidden="true" />);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dateStr = getDateString(date);
    const isPast = date < today;
    const isSelected = selectedDate === dateStr;
    const isToday = getDateString(today) === dateStr;

    cells.push(
      <button
        key={d}
        type="button"
        role="gridcell"
        aria-selected={isSelected}
        aria-label={`${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${isToday ? ', today' : ''}${isSelected ? ', selected' : ''}`}
        aria-pressed={isSelected}
        disabled={isPast}
        tabIndex={isSelected || (!selectedDate && d === 1) ? 0 : -1}
        data-date={dateStr}
        onClick={() => onSelect(dateStr)}
        className={cn(
          'min-h-11 min-w-11 w-10 h-10 rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isPast && 'text-muted-foreground line-through cursor-not-allowed',
          !isPast && !isSelected && 'text-foreground hover:bg-muted',
          isSelected && 'bg-primary text-primary-foreground shadow-sm',
          isToday && !isSelected && 'ring-1 ring-warning'
        )}
      >
        {d}
      </button>
    );
  }

  return (
    <div role="group" aria-label={`Calendar, ${monthLabel}`}>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={prevMonth}
          aria-label={`Previous month, ${new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`}
          className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-foreground" aria-live="polite">{monthLabel}</span>
        <button
          type="button"
          onClick={nextMonth}
          aria-label={`Next month, ${new Date(year, month + 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`}
          className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center mb-2" role="row">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
          <div key={day} role="columnheader" className="text-xs font-medium text-muted-foreground py-1">{day}</div>
        ))}
      </div>
      <div
        ref={gridRef}
        role="grid"
        aria-label={`Days in ${monthLabel}`}
        onKeyDown={handleGridKeyDown}
        className="grid grid-cols-7 gap-1 place-items-center"
      >
        {/* A11Y (audit 2026-07-09): wrap each week in role="row" so screen
            readers using ARIA grid mode (JAWS table mode, NVDA browse
            mode) navigate week-by-week rather than flat-list. The outer
            grid still uses CSS grid for layout; the row wrappers are
            inline-block so the cells line up identically. */}
        {Array.from({ length: Math.ceil(cells.length / 7) }, (_, weekIdx) => (
          <div
            key={`week-${weekIdx}`}
            role="row"
            className="contents"
          >
            {cells.slice(weekIdx * 7, weekIdx * 7 + 7)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PortalBooking() {
  usePortalLightTheme();
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState('');
  const [booked, setBooked] = useState(false);
  const [bookingDetails, setBookingDetails] = useState(null);

  const { data: slotsData, isLoading: slotsLoading } = useQuery({
    queryKey: ['portal-booking-slots', selectedDate],
    queryFn: () => api.getPortalBookingSlots(selectedDate),
    enabled: !!selectedDate,
    retry: false,
  });

  const slots = slotsData?.slots || slotsData || [];
  // The booking organization's name and logo, sent with the availability.
  const brand = slotsData?.brand;
  const slotZone = slotUtcOffsetLabel(selectedDate, Array.isArray(slots) ? slots.find((slot) => slot?.start) : null);
  const zoneText = slotZone ? `our local time (${slotZone})` : 'our local time';

  const bookMutation = useMutation({
    mutationFn: (data) => api.createPortalBooking(data),
    onSuccess: (data) => {
      setBooked(true);
      // Keep the zone the slots were shown in for the confirmation screen.
      setBookingDetails({ ...data, zone: zoneText });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedSlot || !name.trim() || !email.trim()) return;
    bookMutation.mutate({
      date: selectedDate,
      time: selectedSlot,
      name: name.trim(),
      email: email.trim(),
      // POST /api/portal/booking reads the topic as `notes` (bookingSchema).
      notes: topic.trim() || undefined,
    });
  };

  const bookedZone = bookingDetails?.zone || zoneText;

  if (booked) {
    return (
      <div className="min-h-screen bg-background">
        <header className="bg-card border-b border-border/40 shadow-sm">
          <div className="max-w-3xl mx-auto px-6 py-6">
            <PortalBrand brand={brand} />
            <h1 className="text-2xl font-bold text-foreground mt-3">Book a Call</h1>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-6 py-8">
          <div role="status" aria-live="polite" className="rounded-xl border border-success/30 bg-success/5 p-8 text-center">
            <CheckCircle className="w-14 h-14 text-success mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-success mb-2">Booking Confirmed</h2>
            <p className="text-success mb-4">
              Your call is booked. This page is your confirmation: no confirmation email is sent, so please note the date and time below.
            </p>
            <div className="inline-flex flex-col items-center gap-2 bg-card rounded-lg border border-success/30 px-6 py-4 mt-2">
              <div className="flex items-center gap-2 text-foreground">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2 text-foreground">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{selectedSlot}, {bookedZone}</span>
              </div>
            </div>
          </div>
          <div className="text-center py-6">
            <PortalBrandFooter brand={brand} />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border/40 shadow-sm">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <PortalBrand brand={brand} />
          <h1 className="text-2xl font-bold text-foreground mt-3">Book a Call</h1>
          <p className="text-muted-foreground mt-1">Schedule a consultation with our team</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Calendar */}
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Select a Date
            </h3>
            <MiniCalendar selectedDate={selectedDate} onSelect={(d) => { setSelectedDate(d); setSelectedSlot(null); }} />
          </div>

          {/* Time Slots */}
          <div className="bg-card rounded-xl border border-border/40 p-6">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Available Times
            </h3>
            <p className="-mt-2 mb-4 text-xs text-muted-foreground">
              Times are in {zoneText}, not converted to your time zone.
            </p>

            {!selectedDate ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Calendar className="w-8 h-8 mb-2 text-muted-foreground" />
                <p className="text-sm">Pick a date to see available times</p>
              </div>
            ) : slotsLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : slots.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Clock className="w-8 h-8 mb-2 text-muted-foreground" />
                <p className="text-sm">No available slots for this date</p>
                <p className="text-xs mt-1">Try a different day</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                {slots.map((slot) => {
                  // slot.time is "HH:MM" in the server's local timezone (no
                  // booking timezone is configured), shown as-is, not
                  // converted to the visitor's timezone.
                  const time = typeof slot === 'string' ? slot : slot.time;
                  const available = typeof slot === 'string' ? true : slot.available !== false;
                  return (
                    <button
                      key={time}
                      type="button"
                      disabled={!available}
                      onClick={() => setSelectedSlot(time)}
                      className={cn(
                        'min-h-11 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        !available && 'cursor-not-allowed bg-muted/50 border-border/25 text-muted-foreground line-through',
                        available && selectedSlot !== time && 'bg-card border-border/40 text-foreground hover:border-border/60 hover:bg-muted/50',
                        selectedSlot === time && 'bg-primary border-primary text-primary-foreground shadow-sm'
                      )}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Booking Form */}
        {selectedSlot && (
          <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border/40 p-6 space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Your Details</h3>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="booking-name" className="block text-sm font-medium text-foreground mb-1.5">
                  <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> Name</span>
                </label>
                <input
                  id="booking-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full px-4 py-2.5 border border-border/40 rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-warning/20 focus:border-warning"
                />
              </div>
              <div>
                <label htmlFor="booking-email" className="block text-sm font-medium text-foreground mb-1.5">
                  <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> Email</span>
                </label>
                <input
                  id="booking-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-2.5 border border-border/40 rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-warning/20 focus:border-warning"
                />
              </div>
            </div>

            <div>
              <label htmlFor="booking-topic" className="block text-sm font-medium text-foreground mb-1.5">
                <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> What would you like to discuss?</span>
              </label>
              <textarea
                id="booking-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={1000}
                placeholder="Brief description of what you need help with (optional)"
                rows={3}
                className="w-full px-4 py-2.5 border border-border/40 rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-warning/20 focus:border-warning resize-none"
              />
            </div>

            {/* Selected summary */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 rounded-lg bg-muted/50 border border-border/25 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-muted-foreground" />
                {selectedSlot}{slotZone ? ` ${slotZone}` : ''}
              </div>
            </div>

            <button
              type="submit"
              disabled={!name.trim() || !email.trim() || bookMutation.isPending}
              aria-busy={bookMutation.isPending}
              className="min-h-11 w-full px-6 py-3 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {bookMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              Confirm Booking
            </button>

            {bookMutation.isError && (
              <p
                role="alert"
                aria-live="assertive"
                className="text-sm text-destructive text-center"
              >
                {bookMutation.error?.message || 'Something went wrong. Please try again.'}
              </p>
            )}
          </form>
        )}

        {/* Footer */}
        <div className="text-center py-6">
          <PortalBrandFooter brand={brand} />
        </div>
      </main>
    </div>
  );
}
