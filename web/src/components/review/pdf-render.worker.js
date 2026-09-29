// PDF page renderer for inline review (docs/media-review.md "Inline PDF
// viewer"). Runs all of pdf.js in this dedicated worker: the parser in the
// same thread (pdf.js' "fake worker", enabled by providing
// globalThis.pdfjsWorker) and the page renderer on an OffscreenCanvas. The
// main thread only receives finished page bitmaps, so pdf.js never enters a
// main-thread JavaScript chunk and never blocks the UI.
//
// This file is loaded with `new Worker(new URL(..., import.meta.url), {
// type: 'module' })`, served from the app's own origin (CSP worker-src
// 'self' blob:). pdf.js runs with eval disabled and without WebAssembly
// decoders (CSP script-src has no 'unsafe-eval' / 'wasm-unsafe-eval').
//
// Protocol (all messages carry `id`, echoed in the reply):
//   { type: 'open', data: ArrayBuffer }            -> { type: 'opened', pageCount }
//   { type: 'render', page, width }               -> { type: 'rendered', page, bitmap, width, height }
//   any failure                                   -> { type: 'error', message }
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs';
import { getDocument } from 'pdfjs-dist/build/pdf.min.mjs';

globalThis.pdfjsWorker = pdfjsWorker;

const MAX_RENDER_WIDTH = 2400;

class OffscreenCanvasFactory {
  constructor() {}
  create(width, height) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

// SVG filters need a DOM; without one, colour-transfer filters are skipped
// (the same as pdf.js' own non-DOM fallback).
class NoFilterFactory {
  constructor() {}
  addFilter() { return 'none'; }
  addHCMFilter() { return 'none'; }
  addAlphaFilter() { return 'none'; }
  addLuminosityFilter() { return 'none'; }
  addHighlightHCMFilter() { return 'none'; }
  destroy() {}
}

// Workers have a FontFaceSet (self.fonts) but no document: embedded fonts
// are registered there, which is what an OffscreenCanvas in this worker uses.
const workerDocument = { fonts: self.fonts };

let loaded = null;

async function open(data) {
  if (loaded) await loaded.destroy().catch(() => {});
  loaded = null;
  const task = getDocument({
    data: new Uint8Array(data),
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,
    ownerDocument: workerDocument,
    isEvalSupported: false,
    useWasm: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: true,
    disableFontFace: !self.fonts,
    enableXfa: false,
    verbosity: 0, // errors only (the in-thread parser is intended, not a fallback)
  });
  loaded = task;
  const document = await task.promise;
  return document;
}

let documentPromise = null;

self.onmessage = async (event) => {
  const { id, type } = event.data || {};
  try {
    if (type === 'open') {
      documentPromise = open(event.data.data);
      const pdf = await documentPromise;
      self.postMessage({ id, type: 'opened', pageCount: pdf.numPages });
      return;
    }
    if (type === 'render') {
      if (!documentPromise) throw new Error('No document is open');
      const pdf = await documentPromise;
      const pageNumber = Math.min(Math.max(1, Number(event.data.page) || 1), pdf.numPages);
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const targetWidth = Math.min(MAX_RENDER_WIDTH, Math.max(200, Math.round(Number(event.data.width) || base.width)));
      const viewport = page.getViewport({ scale: targetWidth / base.width });
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      const bitmap = canvas.transferToImageBitmap();
      page.cleanup();
      self.postMessage({ id, type: 'rendered', page: pageNumber, bitmap, width: canvas.width, height: canvas.height }, [bitmap]);
      return;
    }
    throw new Error(`Unknown request ${type}`);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err?.message || err) });
  }
};
