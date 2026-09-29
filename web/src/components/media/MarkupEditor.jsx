import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Pencil, Square, Type, Undo2 } from 'lucide-react';
import { MARKUP_COLORS, MARKUP_TOOLS, canvasPoint, isMeaningfulShape, renderMarkup, strokeWidthFor } from './markup';

const MAX_EXPORT_EDGE = 3840;
const TOOL_ICONS = { arrow: ArrowUpRight, rect: Square, pen: Pencil, text: Type };
const controlClass = 'inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-lg border px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Lightweight screenshot markup: arrow, rectangle, freehand pen, text, colour
 * and undo, exported as a PNG at the image's resolution (docs/chat-media.md).
 *
 * @param {{ image: CanvasImageSource & { width: number, height: number }, fileName?: string, onCancel: () => void, onDone: (file: File) => void, doneLabel?: string }} props
 */
export default function MarkupEditor({ image, fileName, onCancel, onDone, doneLabel = 'Attach screenshot' }) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const [tool, setTool] = useState('arrow');
  const [color, setColor] = useState(MARKUP_COLORS[0].id);
  const [shapes, setShapes] = useState([]);
  const [drawing, setDrawing] = useState(null);
  const [textEntry, setTextEntry] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const sourceWidth = image.naturalWidth || image.videoWidth || image.width;
  const sourceHeight = image.naturalHeight || image.videoHeight || image.height;
  const scale = Math.min(1, MAX_EXPORT_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const lineWidth = strokeWidthFor(width, height);

  useEffect(() => {
    const context = canvasRef.current?.getContext?.('2d');
    if (!context) return;
    renderMarkup(context, image, drawing ? [...shapes, drawing] : shapes);
  }, [image, shapes, drawing]);

  const undo = useCallback(() => setShapes((current) => current.slice(0, -1)), []);

  const onKeyDown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !textEntry) {
      event.preventDefault();
      undo();
    }
  };

  const onPointerDown = (event) => {
    const canvas = canvasRef.current;
    if (!canvas || event.button > 0) return;
    const point = canvasPoint(canvas, event);
    if (tool === 'text') {
      const rect = canvas.getBoundingClientRect();
      const wrapper = wrapperRef.current.getBoundingClientRect();
      setTextEntry({ point, left: event.clientX - wrapper.left, top: event.clientY - wrapper.top, value: '', cssScale: rect.width / canvas.width });
      return;
    }
    canvas.setPointerCapture?.(event.pointerId);
    setDrawing(tool === 'pen'
      ? { tool, color, width: lineWidth, points: [point] }
      : { tool, color, width: lineWidth, from: point, to: point });
  };

  const onPointerMove = (event) => {
    if (!drawing) return;
    const point = canvasPoint(canvasRef.current, event);
    setDrawing((current) => (current?.tool === 'pen'
      ? { ...current, points: [...current.points, point] }
      : current && { ...current, to: point }));
  };

  const onPointerUp = () => {
    if (!drawing) return;
    if (isMeaningfulShape(drawing)) setShapes((current) => [...current, drawing]);
    setDrawing(null);
  };

  const commitText = () => {
    if (textEntry?.value.trim()) {
      setShapes((current) => [...current, { tool: 'text', color, width: lineWidth, from: textEntry.point, text: textEntry.value.trim() }]);
    }
    setTextEntry(null);
  };

  const exportPng = async () => {
    setExporting(true);
    setError('');
    try {
      const canvas = canvasRef.current;
      renderMarkup(canvas.getContext('2d'), image, shapes);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The screenshot could not be exported.');
      const name = fileName || `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      onDone(new File([blob], name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' }));
    } catch (err) {
      setError(err?.message || 'The screenshot could not be exported.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Markup tool" className="flex flex-wrap gap-1">
          {MARKUP_TOOLS.map(({ id, label }) => {
            const Icon = TOOL_ICONS[id];
            return (
              <button key={id} type="button" aria-pressed={tool === id} onClick={() => setTool(id)} className={`${controlClass} ${tool === id ? 'border-foreground bg-muted font-semibold' : 'border-border'}`}>
                <Icon className="h-4 w-4" aria-hidden="true" /> {label}
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="Markup colour" className="flex flex-wrap gap-1">
          {MARKUP_COLORS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={color === id}
              aria-label={`${label} colour`}
              onClick={() => setColor(id)}
              className={`${controlClass} ${color === id ? 'border-foreground ring-2 ring-foreground/40' : 'border-border'}`}
            >
              <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: id }} aria-hidden="true" />
            </button>
          ))}
        </div>
        <button type="button" onClick={undo} disabled={!shapes.length} className={`${controlClass} border-border`} aria-keyshortcuts="Control+Z Meta+Z">
          <Undo2 className="h-4 w-4" aria-hidden="true" /> Undo
        </button>
      </div>
      <div ref={wrapperRef} className="relative overflow-auto rounded-md border border-border bg-muted">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          role="img"
          aria-label={`Screenshot to mark up (${shapes.length} mark${shapes.length === 1 ? '' : 's'})`}
          className="block h-auto max-h-[60vh] w-full touch-none object-contain"
          style={{ cursor: tool === 'text' ? 'text' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrawing(null)}
        />
        {textEntry && (
          <input
            autoFocus
            aria-label="Text to place on the screenshot"
            value={textEntry.value}
            onChange={(event) => setTextEntry({ ...textEntry, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commitText(); }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setTextEntry(null); }
            }}
            onBlur={commitText}
            className="absolute min-w-32 rounded border border-border bg-background px-1 text-sm text-foreground"
            style={{ left: textEntry.left, top: textEntry.top }}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">Drag on the screenshot to draw. Choose Text, then click where the text goes and press Enter.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={`${controlClass} border-border px-3`}>Cancel</button>
        <button type="button" onClick={exportPng} disabled={exporting} aria-busy={exporting || undefined} className={`${controlClass} border-transparent bg-primary px-3 font-medium text-primary-foreground`}>
          {exporting ? 'Preparing…' : doneLabel}
        </button>
      </div>
    </div>
  );
}
