import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  RECORDING_SIZE_HEADROOM,
  captureSupport,
  pickRecorderMimeType,
  recordingExtension,
  recordingFileName,
  startCappedRecording,
} from '../lib/media-recorder';
import { attachmentKind, formatBytes, prepareUploadFile } from '../lib/upload';

class FakeRecorder {
  static isTypeSupported(type) { return type === 'video/webm;codecs=vp8,opus'; }
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
    FakeRecorder.last = this;
  }
  start(timeslice) { this.state = 'recording'; this.timeslice = timeslice; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.onstop();
  }
  emit(size) { this.ondataavailable({ data: new Blob([new Uint8Array(size)]) }); }
}

describe('shared capped recorder (docs/chat-media.md)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stops itself just before the 50 MB upload cap', () => {
    const onStop = vi.fn();
    const maxBytes = 1000;
    startCappedRecording({}, { Recorder: FakeRecorder, maxBytes, onStop, mimeType: 'video/webm;codecs=vp8,opus' });
    const recorder = FakeRecorder.last;
    expect(recorder.options).toEqual({ mimeType: 'video/webm;codecs=vp8,opus' });
    expect(recorder.timeslice).toBe(1000);
    recorder.emit(500);
    expect(onStop).not.toHaveBeenCalled();
    recorder.emit(maxBytes * RECORDING_SIZE_HEADROOM - 500);
    expect(onStop).toHaveBeenCalledTimes(1);
    const result = onStop.mock.calls[0][0];
    expect(result.reason).toBe('size');
    expect(result.overLimit).toBe(false);
    expect(result.mimeType).toBe('video/webm');
    expect(result.blob.size).toBe(maxBytes * RECORDING_SIZE_HEADROOM);
  });

  it('stops at the maximum duration, not counting paused time, and reports progress', () => {
    const onStop = vi.fn();
    const onProgress = vi.fn();
    const controller = startCappedRecording({}, { Recorder: FakeRecorder, maxDurationMs: 10_000, onStop, onProgress });
    vi.advanceTimersByTime(4_000);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ elapsedMs: 4_000, remainingMs: 6_000 }));
    expect(controller.pause()).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(onStop).not.toHaveBeenCalled();
    expect(controller.resume()).toBe(true);
    vi.advanceTimersByTime(5_999);
    expect(onStop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop.mock.calls[0][0]).toMatchObject({ reason: 'duration', durationMs: 10_000 });
  });

  it('stops once, with the reason the caller gives', () => {
    const onStop = vi.fn();
    const controller = startCappedRecording({}, { Recorder: FakeRecorder, onStop });
    controller.stop('ended');
    controller.stop('manual');
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop.mock.calls[0][0].reason).toBe('ended');
  });

  it('picks a supported recording format and names files the upload policy accepts', () => {
    expect(pickRecorderMimeType(FakeRecorder)).toBe('video/webm;codecs=vp8,opus');
    expect(pickRecorderMimeType({ isTypeSupported: (type) => type === 'video/mp4' })).toBe('video/mp4');
    expect(pickRecorderMimeType(undefined)).toBe('');
    expect(recordingExtension('video/mp4;codecs=avc1')).toBe('.mp4');
    expect(recordingExtension('video/webm')).toBe('.webm');
    const name = recordingFileName('screen-recording', 'video/webm', new Date('2026-09-29T10:11:12.000Z'));
    expect(name).toBe('screen-recording-2026-09-29T10-11-12-000Z.webm');
    expect(name.split('.')).toHaveLength(2);
  });

  it('degrades gracefully: no screen options without getDisplayMedia, nothing without MediaRecorder', () => {
    const desktop = { navigator: { mediaDevices: { getDisplayMedia() {}, getUserMedia() {} } }, MediaRecorder: FakeRecorder };
    expect(captureSupport(desktop)).toEqual({ screenshot: true, screen: true, camera: true, record: true });
    const iphone = { navigator: { mediaDevices: { getUserMedia() {} } }, MediaRecorder: FakeRecorder };
    expect(captureSupport(iphone)).toEqual({ screenshot: false, screen: false, camera: true, record: true });
    const noRecorder = { navigator: { mediaDevices: { getDisplayMedia() {}, getUserMedia() {} } } };
    expect(captureSupport(noRecorder)).toEqual({ screenshot: true, screen: false, camera: false, record: false });
    expect(captureSupport({ navigator: {} })).toEqual({ screenshot: false, screen: false, camera: false, record: false });
  });
});

describe('upload preparation', () => {
  it('gives clipboard images a name and one extension, and refuses what the server would refuse', () => {
    const pasted = prepareUploadFile(new File(['x'], '', { type: 'image/png' }), { fallbackBase: 'pasted' });
    expect(pasted.file.name).toBe('pasted.png');
    expect(pasted.file.type).toBe('image/png');
    const dotted = prepareUploadFile(new File(['x'], 'Screen Shot 2026.09.29 at 10.00.png', { type: 'image/png' }));
    expect(dotted.file.name).toBe('Screen Shot 2026-09-29 at 10-00.png');
    const untyped = prepareUploadFile(new File(['x'], 'notes.txt'));
    expect(untyped.file.type).toBe('text/plain');
    expect(prepareUploadFile(new File(['x'], 'movie.mov', { type: 'video/quicktime' })).error).toMatch(/not a supported file type/);
    expect(prepareUploadFile(new File([], 'empty.png', { type: 'image/png' })).error).toMatch(/empty/);
    const big = new File(['x'], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    expect(prepareUploadFile(big).error).toMatch(/50 MB/);
  });

  it('classifies attachments for inline rendering', () => {
    expect(attachmentKind('image/png')).toBe('image');
    expect(attachmentKind('video/webm')).toBe('video');
    expect(attachmentKind('audio/mpeg')).toBe('audio');
    expect(attachmentKind('application/pdf')).toBe('file');
    expect(attachmentKind('image/svg+xml')).toBe('file');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
