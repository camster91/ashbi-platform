import { cn } from '../../lib/utils';
import { formatHours, spokenHours } from './timesheetWeek';

// Built by concatenation: cn()/twMerge would drop `text-eyebrow` as a text colour.
const headCell = 'px-2 py-2 text-eyebrow font-normal text-muted-foreground';

function Dash() {
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">–</span>
      <span className="sr-only">No time</span>
    </>
  );
}

/**
 * The week as a table: one row per project, one column per day, with row and
 * day totals. A cell with time is a button that opens that day's entries
 * below the table (`aria-controls` → `panelId`).
 */
export default function TimesheetGrid({ rows, days, totalsByDay, total, selected, onSelect, panelId }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Hours per project and day</caption>
        <thead>
          <tr className="text-right">
            <th scope="col" className={`${headCell} pl-0 text-left`}>Project</th>
            {days.map((day) => (
              <th key={day.key} scope="col" className={headCell}>
                {day.name} <span className="figure">{day.day}</span>
              </th>
            ))}
            <th scope="col" className={`${headCell} pr-0`}>Total</th>
          </tr>
        </thead>
        <tbody className="text-right">
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border/40">
              <th scope="row" className="py-2.5 pl-0 pr-2 text-left font-normal">
                <span className="block font-semibold text-foreground break-words">{row.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {row.billable === 0 ? 'Not billable' : row.billable === row.total ? 'Billable' : `${formatHours(row.billable)} h billable`}
                </span>
              </th>
              {days.map((day) => {
                const minutes = row.byDay[day.key] || 0;
                if (!minutes) return <td key={day.key} className="px-2 py-2.5"><Dash /></td>;
                const isOpen = selected?.projectId === row.id && selected?.dayKey === day.key;
                return (
                  <td key={day.key} className="px-0.5 py-1">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? panelId : undefined}
                      aria-label={`${row.name}, ${day.name} ${day.day}: ${spokenHours(minutes)}`}
                      onClick={() => onSelect(isOpen ? null : { projectId: row.id, dayKey: day.key })}
                      className={cn(
                        'figure inline-flex min-h-11 w-full items-center justify-end rounded-md px-2 text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                        isOpen && 'bg-secondary text-secondary-foreground',
                      )}
                    >
                      {formatHours(minutes)}
                    </button>
                  </td>
                );
              })}
              <td className="py-2.5 pl-2 pr-0 figure font-semibold text-foreground">{formatHours(row.total)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border">
            <th scope="row" className="py-2.5 pl-0 pr-2 text-left font-bold text-foreground">Total</th>
            {days.map((day) => (
              <td key={day.key} className="px-2 py-2.5 figure text-foreground">
                {totalsByDay[day.key] ? formatHours(totalsByDay[day.key]) : <Dash />}
              </td>
            ))}
            <td className="py-2.5 pl-2 pr-0 figure font-bold text-foreground">{formatHours(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
