// Markup geometry for media review (docs/media-review.md "Markup"). Every
// shape is normalized to the unit square of the reviewed surface (image, PDF
// page or video frame), the same rules the API enforces
// (src/services/media-review.service.js):
//   pin   region { x, y, w: 0, h: 0 }
//   rect  region { x, y, w > 0, h > 0 }
//   arrow points [[x1, y1], [x2, y2]] (tail, head)
//   pen   points, 2..500 pairs

export const SHAPE_POINTS_MAX = 500;

export const MARKUP_TOOLS = Object.freeze([
  { id: 'pin', label: 'Pin' },
  { id: 'rect', label: 'Area' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'pen', label: 'Pen' },
]);

// The palette the API accepts, with colours that keep 3:1 contrast against
// both light and dark media edges (an outline is drawn under every stroke).
export const MARKUP_COLORS = Object.freeze([
  { id: 'red', label: 'Red', hex: '#dc2626' },
  { id: 'orange', label: 'Orange', hex: '#ea580c' },
  { id: 'yellow', label: 'Yellow', hex: '#ca8a04' },
  { id: 'green', label: 'Green', hex: '#16a34a' },
  { id: 'blue', label: 'Blue', hex: '#2563eb' },
  { id: 'purple', label: 'Purple', hex: '#9333ea' },
]);

export const DEFAULT_COLOR = 'red';

export function colorHex(color) {
  return (MARKUP_COLORS.find((entry) => entry.id === color) ?? MARKUP_COLORS[0]).hex;
}

const clampUnit = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
// Four decimals: sub-pixel on any realistic display, and short payloads.
const round = (value) => Math.round(clampUnit(value) * 10_000) / 10_000;

/** A pointer position as a normalized [x, y] inside `rect` (a DOMRect). */
export function pointFromEvent(event, rect) {
  if (!rect?.width || !rect?.height) return null;
  return [round((event.clientX - rect.left) / rect.width), round((event.clientY - rect.top) / rect.height)];
}

/**
 * Reduce a stroke to at most `max` points, keeping the first and last and an
 * even spread between them, and dropping consecutive duplicates.
 */
export function simplifyStroke(points, max = SHAPE_POINTS_MAX) {
  const unique = points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
  if (unique.length <= max) return unique;
  const step = (unique.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => unique[Math.round(index * step)]);
}

/**
 * The draft shape for a completed pointer gesture with `tool`, or null when
 * the gesture does not make one (e.g. a zero-size drag for an area).
 * @param {'pin' | 'rect' | 'arrow' | 'pen'} tool
 * @param {Array<[number, number]>} points the gesture's points, in order
 */
export function shapeFromGesture(tool, points) {
  if (!points.length) return null;
  const [start] = points;
  const end = points[points.length - 1];
  if (tool === 'pin') return { shape: 'pin', region: { x: start[0], y: start[1], w: 0, h: 0 } };
  if (tool === 'rect') {
    const x = Math.min(start[0], end[0]);
    const y = Math.min(start[1], end[1]);
    const w = round(Math.abs(end[0] - start[0]));
    const h = round(Math.abs(end[1] - start[1]));
    if (w < 0.005 || h < 0.005) return { shape: 'pin', region: { x: start[0], y: start[1], w: 0, h: 0 } };
    return { shape: 'rect', region: { x: round(x), y: round(y), w: Math.min(w, round(1 - x)), h: Math.min(h, round(1 - y)) } };
  }
  if (tool === 'arrow') {
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.01) return null;
    return { shape: 'arrow', points: [start, end] };
  }
  const stroke = simplifyStroke(points);
  return stroke.length >= 2 ? { shape: 'pen', points: stroke } : null;
}

/** The shape an annotation shows: explicit, or pin/area from a bare region. */
export function shapeOf(annotation) {
  if (annotation?.shape) return annotation.shape;
  if (!annotation?.region) return null;
  return annotation.region.w === 0 && annotation.region.h === 0 ? 'pin' : 'rect';
}

/** Where a shape's numbered badge sits: the pin, the area's corner, the arrow head, the stroke start. */
export function badgePoint(annotation) {
  const shape = shapeOf(annotation);
  if (shape === 'arrow' && annotation.points?.length === 2) return annotation.points[1];
  if (shape === 'pen' && annotation.points?.length) return annotation.points[0];
  if (annotation.region) return [annotation.region.x, annotation.region.y];
  return null;
}

const percent = (value) => Math.round(value * 100);

/** Plain words for a shape, for the comment list and pin labels. */
export function describeShape(annotation) {
  const shape = shapeOf(annotation);
  const region = annotation.region;
  if (shape === 'pin' && region) return `pinned at ${percent(region.x)}% across, ${percent(region.y)}% down`;
  if (shape === 'rect' && region) return `area from ${percent(region.x)}% across, ${percent(region.y)}% down, ${percent(region.w)}% wide and ${percent(region.h)}% tall`;
  if (shape === 'arrow' && annotation.points?.length === 2) {
    const [, head] = annotation.points;
    return `arrow pointing to ${percent(head[0])}% across, ${percent(head[1])}% down`;
  }
  if (shape === 'pen' && region) return `drawing around ${percent(region.x + region.w / 2)}% across, ${percent(region.y + region.h / 2)}% down`;
  return null;
}

/**
 * Whether a shape belongs on the surface being shown: its PDF page, or the
 * video frame near its timecode (within `windowMs`).
 */
export function isOnSurface(annotation, { kind, page, timeMs, windowMs = 1500 }) {
  if (!shapeOf(annotation)) return false;
  if (kind === 'pdf') return annotation.pageNumber === page;
  if (kind === 'video') {
    if (annotation.timecodeMs === null || annotation.timecodeMs === undefined) return false;
    return Math.abs(annotation.timecodeMs - timeMs) <= windowMs;
  }
  return true;
}

/** The API payload fields for a draft shape. */
export function shapePayload(draft) {
  if (!draft) return {};
  // A pin is sent as a bare point region (the API derives the shape), the
  // same payload the keyboard position fields have always produced.
  const payload = draft.shape === 'pin' ? {} : { shape: draft.shape };
  if (draft.region) payload.region = draft.region;
  if (draft.points) payload.points = draft.points;
  if (draft.color && draft.color !== DEFAULT_COLOR) payload.color = draft.color;
  return payload;
}

/** Numbers for the ruler under a player: `ms` as a fraction of `durationMs`. */
export function timelinePosition(ms, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, ms / durationMs));
}

/** Text a comment mentions: `@Name` for each teammate still named in the body. */
export function mentionedIds(body, candidates) {
  return candidates.filter((user) => user?.name && body.includes(`@${user.name}`)).map((user) => user.id);
}
