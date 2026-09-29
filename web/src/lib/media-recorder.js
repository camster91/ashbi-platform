// Shared MediaRecorder logic (docs/chat-media.md): used by the project
// "Record screen" panel (components/project/ProjectMedia.jsx) and the chat
// capture dialog (components/media/CaptureDialog.jsx).
//
// Uploads are capped at 50 MB and kept on local disk (owner decision), so a
// recording stops itself at the size cap (with headroom for the final chunk)
// or at the maximum duration, whichever comes first. Paused time does not
// count toward the duration.

import { MAX_RECORDING_DURATION_MS } from './call-resilience';
import { MAX_UPLOAD_BYTES } from './upload';

export { MAX_RECORDING_DURATION_MS, MAX_UPLOAD_BYTES };
// Stop a little before the cap: the recorder flushes one more chunk on stop.
export const RECORDING_SIZE_HEADROOM = 0.95;

const PREFERRED_MIME_TYPES = Object.freeze([
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  // Safari records MP4 (H.264/AAC).
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
]);

/**
 * The first container/codec this browser can record, or '' to let the
 * browser choose.
 * @param {any} [Recorder]
 */
export function pickRecorderMimeType(Recorder = globalThis.MediaRecorder) {
  if (!Recorder?.isTypeSupported) return '';
  return PREFERRED_MIME_TYPES.find((type) => {
    try { return Recorder.isTypeSupported(type); } catch { return false; }
  }) || '';
}

/** `video/webm;codecs=vp9` → `video/webm`. */
export function baseMimeType(mimeType) {
  return String(mimeType || '').split(';')[0].trim().toLowerCase();
}

/** File extension the upload policy accepts for a recorded MIME type. */
export function recordingExtension(mimeType) {
  return baseMimeType(mimeType) === 'video/mp4' ? '.mp4' : '.webm';
}

/** `screen-recording-2026-09-29T10-11-12-000Z.webm` */
export function recordingFileName(prefix, mimeType, date = new Date()) {
  return `${prefix}-${date.toISOString().replace(/[:.]/g, '-')}${recordingExtension(mimeType)}`;
}

/** Whether this browser can record at all. */
export function canRecord(scope = globalThis) {
  return typeof scope.MediaRecorder === 'function';
}

/**
 * What the capture tools can offer here. Safari on iOS and most mobile
 * browsers have no getDisplayMedia: the screen options are hidden and camera
 * recording and file attachments remain (docs/chat-media.md).
 */
export function captureSupport(scope = globalThis) {
  const devices = scope.navigator?.mediaDevices;
  const screen = typeof devices?.getDisplayMedia === 'function';
  const camera = typeof devices?.getUserMedia === 'function';
  const recorder = canRecord(scope);
  return {
    screenshot: screen,
    screen: screen && recorder,
    camera: camera && recorder,
    record: recorder && (screen || camera),
  };
}

/**
 * Start recording `stream` with the size and duration caps.
 *
 * @param {MediaStream} stream
 * @param {{
 *   maxBytes?: number,
 *   maxDurationMs?: number,
 *   mimeType?: string,
 *   timesliceMs?: number,
 *   bitsPerSecond?: { video?: number, audio?: number },
 *   onProgress?: (progress: { elapsedMs: number, remainingMs: number, bytes: number, state: string }) => void,
 *   onStop?: (result: { blob: Blob, reason: 'manual' | 'size' | 'duration' | 'ended', durationMs: number, overLimit: boolean, mimeType: string }) => void,
 *   Recorder?: any,
 *   now?: () => number,
 * }} [options]
 */
export function startCappedRecording(stream, {
  maxBytes = MAX_UPLOAD_BYTES,
  maxDurationMs = MAX_RECORDING_DURATION_MS,
  mimeType = pickRecorderMimeType(),
  timesliceMs = 1000,
  bitsPerSecond,
  onProgress = () => {},
  onStop = () => {},
  Recorder = globalThis.MediaRecorder,
  now = () => Date.now(),
} = {}) {
  const options = {};
  if (mimeType) options.mimeType = mimeType;
  if (bitsPerSecond?.video) options.videoBitsPerSecond = bitsPerSecond.video;
  if (bitsPerSecond?.audio) options.audioBitsPerSecond = bitsPerSecond.audio;
  const recorder = new Recorder(stream, Object.keys(options).length ? options : undefined);
  const chunks = [];
  let bytes = 0;
  let reason = 'manual';
  let pausedTotal = 0;
  let pausedAt = null;
  let limitTimer;
  let tickTimer;
  const startedAt = now();
  const type = baseMimeType(mimeType || recorder.mimeType) || 'video/webm';

  const elapsed = () => Math.max(0, (pausedAt ?? now()) - startedAt - pausedTotal);
  const report = () => onProgress({
    elapsedMs: elapsed(),
    remainingMs: Math.max(0, maxDurationMs - elapsed()),
    bytes,
    state: recorder.state,
  });
  const clearTimers = () => { clearTimeout(limitTimer); clearInterval(tickTimer); };
  const scheduleLimit = () => {
    clearTimeout(limitTimer);
    limitTimer = setTimeout(() => stop('duration'), Math.max(0, maxDurationMs - elapsed()));
  };

  function stop(why = 'manual') {
    if (recorder.state === 'inactive') return;
    reason = why;
    clearTimers();
    recorder.stop();
  }

  recorder.ondataavailable = ({ data }) => {
    if (!data?.size) return;
    chunks.push(data);
    bytes += data.size;
    report();
    if (bytes >= maxBytes * RECORDING_SIZE_HEADROOM) stop('size');
  };
  recorder.onstop = () => {
    clearTimers();
    const blob = new Blob(chunks, { type });
    onStop({ blob, reason, durationMs: elapsed(), overLimit: blob.size > maxBytes, mimeType: type });
  };

  recorder.start(timesliceMs);
  tickTimer = setInterval(report, 1000);
  scheduleLimit();
  report();

  return {
    recorder,
    mimeType: type,
    get state() { return recorder.state; },
    stop,
    pause() {
      if (recorder.state !== 'recording' || typeof recorder.pause !== 'function') return false;
      recorder.pause();
      pausedAt = now();
      clearTimeout(limitTimer);
      report();
      return true;
    },
    resume() {
      if (recorder.state !== 'paused' || typeof recorder.resume !== 'function') return false;
      pausedTotal += now() - pausedAt;
      pausedAt = null;
      recorder.resume();
      scheduleLimit();
      report();
      return true;
    },
  };
}
