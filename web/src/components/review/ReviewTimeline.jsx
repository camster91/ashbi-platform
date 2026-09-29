import { cn } from '../../lib/utils';
import { timelinePosition } from './markup';

// Comment markers under a video or audio player (docs/media-review.md
// "Tracking"): one labelled button per timestamped comment, placed at its
// time; activating one seeks the player to it. The comment list offers the
// same "Play from" action, so the markers are a shortcut, not the only path.

/** 65432 ms -> "1:05". */
function clock(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * @param {{
 *   markers: Array<{ id: string, number: number, timecodeMs: number, authorName: string, resolved?: boolean }>,
 *   durationMs: number,
 *   currentMs: number,
 *   selectedId?: string | null,
 *   onSeek: (marker: any) => void,
 * }} props
 */
export default function ReviewTimeline({ markers, durationMs, currentMs, selectedId, onSeek }) {
  if (!markers.length) return null;
  // Recorded WebM often reports no duration: fall back to the latest comment.
  const latest = Math.max(...markers.map((marker) => marker.timecodeMs));
  const span = Number.isFinite(durationMs) && durationMs > 0 ? Math.max(durationMs, latest) : Math.max(latest * 1.1, 1000);
  return (
    <div className="space-y-1">
      <div className="relative h-9 rounded-md border border-border bg-muted/60" data-testid="review-timeline">
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${timelinePosition(currentMs, span) * 100}%` }} />
        <ol aria-label="Comment markers on the timeline" className="absolute inset-0">
          {markers.map((marker) => (
            <li key={marker.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${timelinePosition(marker.timecodeMs, span) * 100}%` }}>
              <button
                type="button"
                onClick={() => onSeek(marker)}
                aria-label={`Comment ${marker.number} at ${clock(marker.timecodeMs)}, by ${marker.authorName}${marker.resolved ? ', resolved' : ''}`}
                aria-pressed={selectedId === marker.id}
                className={cn(
                  'flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-background px-1 text-[11px] font-bold shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selectedId === marker.id ? 'bg-foreground text-background' : marker.resolved ? 'bg-muted-foreground text-background' : 'bg-primary text-primary-foreground',
                )}
              >
                {marker.number}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-xs text-muted-foreground">Markers show where comments were left. Select one to jump there.</p>
    </div>
  );
}
