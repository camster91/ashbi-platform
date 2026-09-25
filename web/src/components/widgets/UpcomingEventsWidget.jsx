import { CalendarDays, MapPin, Video, Clock } from 'lucide-react';
import { Card } from '../ui';
import { formatRelativeTime, cn } from '../../lib/utils';

export default function UpcomingEventsWidget({ events = [] }) {
  if (!events?.length) return null;

  return (
    <Card>
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-purple-500" />
        <h2 className="font-semibold text-foreground">Upcoming Events</h2>
      </div>
      {/* Up to six events can overflow this scroll box, and the items hold no
          focusable content, so the list itself must be keyboard-scrollable. */}
      <ul
        tabIndex={0}
        aria-label="Upcoming events"
        className="divide-y divide-border max-h-[340px] overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {events.slice(0, 6).map(event => {
          const start = new Date(event.startTime);
          const isToday = new Date().toDateString() === start.toDateString();
          return (
            <li key={event.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex flex-col items-center justify-center flex-shrink-0 text-xs font-bold border"
                  style={{ borderColor: event.color || '#3B82F6', color: event.color || '#3B82F6' }}
                >
                  <span className="text-[10px] uppercase leading-none">{start.toLocaleDateString('en-CA', { month: 'short' })}</span>
                  <span className="text-sm leading-none">{start.getDate()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{event.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
                      event.type === 'DEADLINE' ? 'bg-red-100 text-red-700' :
                      event.type === 'MEETING' ? 'bg-blue-100 text-blue-700' :
                      event.type === 'MILESTONE' ? 'bg-purple-100 text-purple-700' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {event.type}
                    </span>
                    {isToday && <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Today</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {start.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}
                      {event.endTime && ` - ${new Date(event.endTime).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}`}
                    </span>
                    {event.location && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {event.location}
                      </span>
                    )}
                  </div>
                  {event.project && (
                    <p className="text-xs text-muted-foreground mt-0.5">{event.project}</p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
