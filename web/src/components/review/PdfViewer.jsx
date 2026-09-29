import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

// Inline PDF viewer for media review (docs/media-review.md "Inline PDF
// viewer"). Loaded on demand (React.lazy) only when a PDF is reviewed; the
// pdf.js library itself runs in a dedicated worker
// (./pdf-render.worker.js) that returns page bitmaps, so it is never part of
// a main-thread chunk. `children(page)` renders the markup overlay for the
// page on show; the parent owns the page number.

const buttonBase = 'min-h-11 inline-flex items-center justify-center gap-1 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function pdfViewerSupported() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

/** A small request/response client for the render worker. */
function createRenderer() {
  const worker = new Worker(new URL('./pdf-render.worker.js', import.meta.url), { type: 'module', name: 'pdf-render' });
  const pending = new Map();
  let nextId = 1;
  worker.onmessage = (event) => {
    const { id, type } = event.data || {};
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (type === 'error') entry.reject(new Error(event.data.message || 'The PDF could not be rendered'));
    else entry.resolve(event.data);
  };
  worker.onerror = () => {
    for (const entry of pending.values()) entry.reject(new Error('The PDF viewer stopped'));
    pending.clear();
  };
  const call = (message, transfer = []) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...message, id }, transfer);
  });
  return { call, terminate: () => worker.terminate() };
}

/**
 * @param {{
 *   url: string,
 *   fileName: string,
 *   page: number,
 *   onPageChange: (page: number) => void,
 *   onPageCount?: (count: number) => void,
 *   children?: (page: number) => import('react').ReactNode,
 * }} props
 */
export default function PdfViewer({ url, fileName, page, onPageChange, onPageCount, children }) {
  const id = useId();
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const rendererRef = useRef(null);
  const [pageCount, setPageCount] = useState(0);
  const [state, setState] = useState(pdfViewerSupported() ? 'loading' : 'unsupported');
  const [error, setError] = useState('');
  const [size, setSize] = useState(null);
  const [pageInput, setPageInput] = useState(String(page));

  useEffect(() => setPageInput(String(page)), [page]);

  // Open the document once per URL.
  useEffect(() => {
    if (!pdfViewerSupported()) return undefined;
    let cancelled = false;
    const renderer = createRenderer();
    rendererRef.current = renderer;
    setState('loading');
    (async () => {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`The PDF could not be loaded (${response.status}).`);
        const data = await response.arrayBuffer();
        const opened = await renderer.call({ type: 'open', data }, [data]);
        if (cancelled) return;
        setPageCount(opened.pageCount);
        onPageCount?.(opened.pageCount);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'The PDF could not be shown.');
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
      renderer.terminate();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Render the current page at the frame's width (device pixels).
  const renderPage = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || state !== 'ready') return;
    const cssWidth = frameRef.current?.getBoundingClientRect().width || 800;
    const width = Math.round(cssWidth * Math.min(2, window.devicePixelRatio || 1));
    try {
      const rendered = await renderer.call({ type: 'render', page, width });
      const canvas = canvasRef.current;
      if (!canvas) {
        rendered.bitmap.close?.();
        return;
      }
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      const bitmapContext = canvas.getContext('bitmaprenderer');
      if (bitmapContext) bitmapContext.transferFromImageBitmap(rendered.bitmap);
      else {
        canvas.getContext('2d')?.drawImage(rendered.bitmap, 0, 0);
        rendered.bitmap.close?.();
      }
      setSize({ width: rendered.width, height: rendered.height });
    } catch (err) {
      setError(err?.message || 'The page could not be shown.');
    }
  }, [page, state]);

  useEffect(() => { renderPage(); }, [renderPage]);

  const go = (next) => {
    const target = Math.min(Math.max(1, next), pageCount || 1);
    if (target !== page) onPageChange(target);
  };

  if (state === 'unsupported') {
    return <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">This browser cannot show the PDF inline. Download it to read it; comments can still name a page.</p>;
  }

  return (
    <div className="space-y-2">
      <nav aria-label="PDF pages" className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonBase} onClick={() => go(page - 1)} disabled={state !== 'ready' || page <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />Previous
        </button>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => { event.preventDefault(); const number = Number.parseInt(pageInput, 10); if (Number.isInteger(number)) go(number); }}
        >
          <label htmlFor={`${id}-page`} className="text-sm text-foreground">Page</label>
          <input
            id={`${id}-page`}
            type="number"
            min={1}
            max={pageCount || undefined}
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onBlur={() => { const number = Number.parseInt(pageInput, 10); if (Number.isInteger(number)) go(number); }}
            disabled={state !== 'ready'}
            className="min-h-11 w-20 rounded-lg border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="text-sm text-muted-foreground">of {pageCount || '…'}</span>
        </form>
        <button type="button" className={buttonBase} onClick={() => go(page + 1)} disabled={state !== 'ready' || page >= pageCount} aria-label="Next page">
          Next<ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </nav>
      <div ref={frameRef} className="relative overflow-hidden rounded-lg border border-border bg-muted">
        {state === 'loading' && <p role="status" className="p-6 text-sm text-muted-foreground">Loading the PDF…</p>}
        {state === 'error' && <p role="alert" className="p-6 text-sm text-destructive">{error} Download it to read it.</p>}
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Page ${page} of ${fileName}`}
          className={cn('block h-auto w-full bg-white', (state !== 'ready' || !size) && 'hidden')}
        />
        {state === 'ready' && size && children?.(page)}
      </div>
    </div>
  );
}
