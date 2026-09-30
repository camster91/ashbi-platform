// Colours that are stored as data (a calendar event's or milestone's `color`
// column), not UI theme. They are saved as hex so they render the same for
// every viewer and in exports, so they cannot be design tokens. Keep every
// such default here; the raw-colour guard allowlists only this file for them.

/** Default colour for new calendar events and milestones. */
export const DEFAULT_EVENT_COLOR = '#3B82F6';
