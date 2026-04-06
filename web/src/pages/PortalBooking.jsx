import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Sparkles,
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
import { cn } from '../lib/utils';

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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => setViewMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setViewMonth(new Date(year, month + 1, 1));

  const monthLabel = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const cells = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} />);
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
        disabled={isPast}
        onClick={() => onSelect(dateStr)}
        className={cn(
          'w-10 h-10 rounded-lg text-sm font-medium transition-all',
          isPast && 'text-slate-300 cursor-not-allowed',
          !isPast && !isSelected && 'text-slate-700 hover:bg-slate-100',
          isSelected && 'bg-slate-800 text-white shadow-sm',
          isToday && !isSelected && 'ring-1 ring-amber-400'
        )}
      >
        {d}
      </button>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={prevMonth}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-slate-800">{monthLabel}</span>
        <button
          type="button"
          onClick={nextMonth}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center mb-2">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
          <div key={day} className="text-xs font-medium text-slate-400 py-1">{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 place-items-center">
        {cells}
      </div>
    </div>
  );
}

export default function PortalBooking() {
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

  const bookMutation = useMutation({
    mutationFn: (data) => api.createPortalBooking(data),
    onSuccess: (data) => {
      setBooked(true);
      setBookingDetails(data);
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
      topic: topic.trim(),
    });
  };

  const slots = slotsData?.slots || slotsData || [];

  if (booked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <header className="bg-white border-b border-slate-200 shadow-sm">
          <div className="max-w-3xl mx-auto px-6 py-6">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-amber-400" />
              </div>
              <span className="text-sm font-medium text-slate-500">Ashbi Design</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mt-3">Book a Call</h1>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-6 py-8">
          <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
            <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-green-800 mb-2">Booking Confirmed</h2>
            <p className="text-green-600 mb-4">
              Your call has been scheduled. We will send a confirmation to your email.
            </p>
            <div className="inline-flex flex-col items-center gap-2 bg-white rounded-lg border border-green-200 px-6 py-4 mt-2">
              <div className="flex items-center gap-2 text-slate-700">
                <Calendar className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium">
                  {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <Clock className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium">{selectedSlot}</span>
              </div>
            </div>
          </div>
          <div className="text-center py-6">
            <p className="text-xs text-slate-400">Powered by Ashbi Design</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <span className="text-sm font-medium text-slate-500">Ashbi Design</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mt-3">Book a Call</h1>
          <p className="text-slate-500 mt-1">Schedule a consultation with our team</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Calendar */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Select a Date
            </h3>
            <MiniCalendar selectedDate={selectedDate} onSelect={(d) => { setSelectedDate(d); setSelectedSlot(null); }} />
          </div>

          {/* Time Slots */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Available Times
            </h3>

            {!selectedDate ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                <Calendar className="w-8 h-8 mb-2 text-slate-300" />
                <p className="text-sm">Pick a date to see available times</p>
              </div>
            ) : slotsLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : slots.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                <Clock className="w-8 h-8 mb-2 text-slate-300" />
                <p className="text-sm">No available slots for this date</p>
                <p className="text-xs mt-1">Try a different day</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                {slots.map((slot) => {
                  const time = typeof slot === 'string' ? slot : slot.time;
                  const available = typeof slot === 'string' ? true : slot.available !== false;
                  return (
                    <button
                      key={time}
                      type="button"
                      disabled={!available}
                      onClick={() => setSelectedSlot(time)}
                      className={cn(
                        'px-3 py-2.5 rounded-lg text-sm font-medium border transition-all',
                        !available && 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-100 text-slate-400',
                        available && selectedSlot !== time && 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                        selectedSlot === time && 'bg-slate-800 border-slate-800 text-white shadow-sm'
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
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Your Details</h3>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="booking-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                  <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> Name</span>
                </label>
                <input
                  id="booking-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>
              <div>
                <label htmlFor="booking-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                  <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> Email</span>
                </label>
                <input
                  id="booking-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="booking-topic" className="block text-sm font-medium text-slate-700 mb-1.5">
                <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> What would you like to discuss?</span>
              </label>
              <textarea
                id="booking-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Brief description of what you need help with (optional)"
                rows={3}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-none"
              />
            </div>

            {/* Selected summary */}
            <div className="flex items-center gap-4 px-4 py-3 rounded-lg bg-slate-50 border border-slate-100 text-sm text-slate-600">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-slate-400" />
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-slate-400" />
                {selectedSlot}
              </div>
            </div>

            <button
              type="submit"
              disabled={!name.trim() || !email.trim() || bookMutation.isPending}
              className="w-full px-6 py-3 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              {bookMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              Confirm Booking
            </button>

            {bookMutation.isError && (
              <p className="text-sm text-red-600 text-center">Something went wrong. Please try again.</p>
            )}
          </form>
        )}

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-slate-400">Powered by Ashbi Design</p>
        </div>
      </main>
    </div>
  );
}
