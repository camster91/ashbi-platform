import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import Modal from './Modal';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

export default function Calendar({ projectId }) {
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);

  // Get month start/end for query
  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

  // Fetch events
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['calendar', projectId, monthStart.toISOString()],
    queryFn: () => api.getCalendarEvents({
      startDate: monthStart.toISOString(),
      endDate: monthEnd.toISOString(),
      ...(projectId && { projectId })
    })
  });

  // Create event mutation
  const createMutation = useMutation({
    mutationFn: api.createCalendarEvent,
    onSuccess: () => {
      queryClient.invalidateQueries(['calendar']);
      setShowCreateModal(false);
    }
  });

  // Generate calendar grid
  const generateCalendarDays = () => {
    const days = [];
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    // Add empty cells for days before month starts
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push({ date: null, events: [] });
    }

    // Add days of the month
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
      const dayEvents = events.filter(e => {
        const eventDate = new Date(e.startTime);
        return eventDate.toDateString() === date.toDateString();
      });
      days.push({ date, events: dayEvents });
    }

    return days;
  };

  const calendarDays = generateCalendarDays();

  // Navigation
  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Handle day click
  const handleDayClick = (day) => {
    if (day.date) {
      setSelectedDate(day.date);
      setShowCreateModal(true);
    }
  };

  // Check if date is today
  const isToday = (date) => {
    if (!date) return false;
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  return (
    <div className="bg-white rounded-lg border">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold text-gray-900">
            {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
          </h2>
          <button
            onClick={goToToday}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={nextMonth}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={() => {
              setSelectedDate(new Date());
              setShowCreateModal(true);
            }}
            className="ml-4 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            + New Event
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="p-4">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {DAYS.map((day) => (
            <div key={day} className="text-center text-sm font-medium text-gray-500 py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar days */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, index) => (
            <div
              key={index}
              onClick={() => handleDayClick(day)}
              className={`min-h-[100px] border rounded-lg p-1 cursor-pointer hover:bg-gray-50 ${
                !day.date ? 'bg-gray-50' : ''
              } ${isToday(day.date) ? 'border-blue-500 border-2' : ''}`}
            >
              {day.date && (
                <>
                  <div className={`text-sm font-medium mb-1 ${
                    isToday(day.date) ? 'text-blue-600' : 'text-gray-700'
                  }`}>
                    {day.date.getDate()}
                  </div>
                  <div className="space-y-1">
                    {day.events.slice(0, 3).map((event) => (
                      <div
                        key={event.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEvent(event);
                        }}
                        className="text-xs p-1 rounded truncate"
                        style={{ backgroundColor: event.color + '20', color: event.color }}
                      >
                        {event.isAllDay ? '' : new Date(event.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' '}
                        {event.title}
                      </div>
                    ))}
                    {day.events.length > 3 && (
                      <div className="text-xs text-gray-500">
                        +{day.events.length - 3} more
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <Modal onClose={() => setSelectedEvent(null)} title={selectedEvent.title}>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-500">Date & Time</label>
              <p className="text-gray-900">
                {new Date(selectedEvent.startTime).toLocaleString()}
                {selectedEvent.endTime && ` - ${new Date(selectedEvent.endTime).toLocaleTimeString()}`}
              </p>
            </div>
            {selectedEvent.description && (
              <div>
                <label className="text-sm text-gray-500">Description</label>
                <p className="text-gray-900">{selectedEvent.description}</p>
              </div>
            )}
            {selectedEvent.location && (
              <div>
                <label className="text-sm text-gray-500">Location</label>
                <p className="text-gray-900">{selectedEvent.location}</p>
              </div>
            )}
            {selectedEvent.attendees?.length > 0 && (
              <div>
                <label className="text-sm text-gray-500">Attendees</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {selectedEvent.attendees.map((a) => (
                    <span key={a.id} className="text-sm bg-gray-100 px-2 py-1 rounded">
                      {a.user.name}
                      <span className="ml-1 text-xs text-gray-500">({a.status.toLowerCase()})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Create Event Modal */}
      {showCreateModal && (
        <CreateEventModal
          date={selectedDate}
          projectId={projectId}
          onClose={() => setShowCreateModal(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />
      )}
    </div>
  );
}

function CreateEventModal({ date, projectId, onClose, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startTime: date ? date.toISOString().slice(0, 16) : '',
    endTime: '',
    type: 'MEETING',
    location: '',
    isAllDay: false,
    color: '#3B82F6'
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      projectId
    });
  };

  return (
    <Modal onClose={onClose} title="Create Event">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
          >
            <option value="MEETING">Meeting</option>
            <option value="DEADLINE">Deadline</option>
            <option value="REMINDER">Reminder</option>
            <option value="MILESTONE">Milestone</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="allDay"
            checked={formData.isAllDay}
            onChange={(e) => setFormData({ ...formData, isAllDay: e.target.checked })}
          />
          <label htmlFor="allDay" className="text-sm text-gray-700">All day event</label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
            <input
              type={formData.isAllDay ? 'date' : 'datetime-local'}
              value={formData.startTime}
              onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
              className="w-full border rounded-lg px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
            <input
              type={formData.isAllDay ? 'date' : 'datetime-local'}
              value={formData.endTime}
              onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
          <input
            type="text"
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
            placeholder="Video call link or physical address"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
            rows={3}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
          <input
            type="color"
            value={formData.color}
            onChange={(e) => setFormData({ ...formData, color: e.target.value })}
            className="h-10 w-20 border rounded"
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Creating...' : 'Create Event'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
