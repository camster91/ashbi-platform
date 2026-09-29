import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { badgePoint, colorHex, pointFromEvent, shapeFromGesture, shapeOf } from './markup';

// The drawing surface over a reviewed image, PDF page or paused video frame
// (docs/media-review.md "Markup"). Shapes are stored normalized to 0..1 and
// drawn in an SVG sized in pixels to the media (so arrowheads and stroke
// widths do not stretch with the aspect ratio); it scales with the media.
//
// Accessibility: every shape has a numbered badge that is a labelled
// button (reachable by Tab, activating it selects the comment); the shapes
// themselves are decoration for pointer users (aria-hidden), and the
// comment list spells each one out in words.

const STROKE = 3;

function ShapeSvg({ annotation, width, height, selected, onSelect }) {
  const shape = shapeOf(annotation);
  const color = colorHex(annotation.color);
  const X = (value) => value * width;
  const Y = (value) => value * height;
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth: selected ? STROKE + 2 : STROKE,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    onClick: onSelect ? () => onSelect(annotation.id) : undefined,
    style: onSelect ? { pointerEvents: 'stroke', cursor: 'pointer' } : undefined,
  };
  // A light halo under every shape keeps it visible on dark and light media.
  const halo = { ...common, stroke: '#ffffff', strokeOpacity: selected ? 0.95 : 0.7, strokeWidth: (selected ? STROKE + 2 : STROKE) + 3, onClick: undefined, style: undefined };
  if (shape === 'rect' && annotation.region) {
    const { x, y, w, h } = annotation.region;
    const rect = { x: X(x), y: Y(y), width: X(w), height: Y(h), rx: 4 };
    return (
      <g data-shape="rect" data-selected={selected || undefined}>
        <rect {...rect} {...halo} />
        <rect {...rect} {...common} fill={selected ? color : 'none'} fillOpacity={selected ? 0.12 : 0} style={{ ...common.style, pointerEvents: onSelect ? 'visibleStroke' : 'none' }} />
      </g>
    );
  }
  if (shape === 'arrow' && annotation.points?.length === 2) {
    const [[x1, y1], [x2, y2]] = annotation.points;
    const ax = X(x1); const ay = Y(y1); const bx = X(x2); const by = Y(y2);
    const angle = Math.atan2(by - ay, bx - ax);
    const size = selected ? 16 : 13;
    const head = [
      [bx, by],
      [bx - size * Math.cos(angle - Math.PI / 7), by - size * Math.sin(angle - Math.PI / 7)],
      [bx - size * Math.cos(angle + Math.PI / 7), by - size * Math.sin(angle + Math.PI / 7)],
    ].map((point) => point.join(',')).join(' ');
    return (
      <g data-shape="arrow" data-selected={selected || undefined}>
        <line x1={ax} y1={ay} x2={bx} y2={by} {...halo} />
        <polygon points={head} {...halo} />
        <line x1={ax} y1={ay} x2={bx} y2={by} {...common} />
        <polygon points={head} {...common} fill={color} />
      </g>
    );
  }
  if (shape === 'pen' && annotation.points?.length >= 2) {
    const d = annotation.points.map(([x, y], index) => `${index ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join(' ');
    return (
      <g data-shape="pen" data-selected={selected || undefined}>
        <path d={d} {...halo} />
        <path d={d} {...common} />
      </g>
    );
  }
  return null;
}

/**
 * @param {{
 *   shapes: Array<any & { number: number }>,
 *   selectedId?: string | null,
 *   onSelect: (id: string) => void,
 *   describe: (annotation: any) => string,
 *   tool?: 'pin' | 'rect' | 'arrow' | 'pen' | null,
 *   color?: string,
 *   draft?: any,
 *   onDraft?: (draft: any) => void,
 *   className?: string,
 * }} props
 */
export default function AnnotationOverlay({ shapes, selectedId, onSelect, describe, tool = null, color = 'red', draft = null, onDraft, className }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [gesture, setGesture] = useState(null);
  const gestureRef = useRef(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setSize({ width: rect.width || 1, height: rect.height || 1 });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const drawing = Boolean(tool && onDraft);

  const begin = (event) => {
    // Badges are buttons of their own: selecting one never starts a drawing.
    if (!drawing || event.button > 0 || event.target.closest?.('button')) return;
    const point = pointFromEvent(event, containerRef.current.getBoundingClientRect());
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gestureRef.current = [point];
    setGesture([point]);
  };
  const move = (event) => {
    if (!gestureRef.current) return;
    const point = pointFromEvent(event, containerRef.current.getBoundingClientRect());
    if (!point) return;
    gestureRef.current = tool === 'pen' ? [...gestureRef.current, point] : [gestureRef.current[0], point];
    setGesture(gestureRef.current);
  };
  const end = () => {
    const points = gestureRef.current;
    gestureRef.current = null;
    setGesture(null);
    if (!points) return;
    const shape = shapeFromGesture(tool, points);
    if (shape) onDraft({ ...shape, color });
  };

  const preview = gesture ? shapeFromGesture(tool, gesture) : null;
  const drawn = shapes.filter((annotation) => shapeOf(annotation) !== 'pin');

  return (
    <div
      ref={containerRef}
      className={cn('absolute inset-0', drawing ? 'cursor-crosshair' : 'pointer-events-none', className)}
      style={drawing ? { touchAction: 'none' } : undefined}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      data-testid="annotation-overlay"
    >
      <svg
        aria-hidden="true"
        focusable="false"
        width="100%"
        height="100%"
        viewBox={`0 0 ${size.width} ${size.height}`}
        preserveAspectRatio="none"
        className={cn('absolute inset-0 h-full w-full overflow-visible', drawing && 'pointer-events-none')}
      >
        {drawn.map((annotation) => (
          <ShapeSvg key={annotation.id} annotation={annotation} width={size.width} height={size.height} selected={selectedId === annotation.id} onSelect={drawing ? null : onSelect} />
        ))}
        {draft && draft.shape !== 'pin' && <ShapeSvg annotation={{ id: 'draft', ...draft }} width={size.width} height={size.height} selected />}
        {preview && preview.shape !== 'pin' && <ShapeSvg annotation={{ id: 'preview', ...preview, color }} width={size.width} height={size.height} selected={false} />}
      </svg>
      {shapes.map((annotation) => {
        const point = badgePoint(annotation);
        if (!point) return null;
        const selected = selectedId === annotation.id;
        return (
          <button
            key={annotation.id}
            type="button"
            onClick={() => onSelect(annotation.id)}
            aria-label={`Comment ${annotation.number} by ${annotation.authorName}, ${describe(annotation)}`}
            aria-pressed={selected}
            className={cn(
              'pointer-events-auto absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background text-xs font-bold shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'bg-foreground text-background ring-2 ring-foreground' : 'bg-primary text-primary-foreground',
            )}
            style={{ left: `${point[0] * 100}%`, top: `${point[1] * 100}%` }}
          >
            {annotation.number}
          </button>
        );
      })}
      {draft && draft.shape === 'pin' && draft.region && (
        <span aria-hidden="true" className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-foreground bg-background/60" style={{ left: `${draft.region.x * 100}%`, top: `${draft.region.y * 100}%` }} />
      )}
    </div>
  );
}
