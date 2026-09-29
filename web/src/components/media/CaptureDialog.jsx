import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Circle, Mic, MicOff, Monitor, Pause, Play, RotateCcw, Square, Video } from 'lucide-react';
import Modal from '../Modal';
import MarkupEditor from './MarkupEditor';
import { acquireRecordingStream, captureScreenFrame, loadImage } from './capture-streams';
import { MAX_RECORDING_DURATION_MS, MAX_UPLOAD_BYTES, recordingFileName, startCappedRecording } from '../../lib/media-recorder';
import { formatDuration } from '../../lib/call-resilience';
import { formatBytes } from '../../lib/upload';

export const COUNTDOWN_SECONDS = 3;
// Chat recordings aim for about 1.2 Mbit/s so a 50 MB clip lasts several
// minutes (screen content compresses well at this rate).
const CHAT_RECORDING_BITRATE = { video: 1_200_000, audio: 96_000 };

const SOURCES = [
  { id: 'screen', label: 'Screen', description: 'A tab, window or your whole screen', needs: 'screen', Icon: Monitor },
  { id: 'screen-camera', label: 'Screen + camera', description: 'Your camera in a bubble over the screen', needs: 'screen-camera', Icon: Monitor },
  { id: 'camera', label: 'Camera only', description: 'Just you, from your camera', needs: 'camera', Icon: Video },
];

const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const primaryClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function captureErrorMessage(error, fallback) {
  if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') return '';
  if (error?.name === 'NotFoundError') return 'No camera or microphone was found.';
  if (error?.name === 'NotReadableError') return 'Your camera or microphone is in use by another app.';
  return fallback;
}

/**
 * Capture tools for chat composers (docs/chat-media.md): a screenshot with a
 * markup step, markup of an attached image, and Loom-style recording (screen,
 * screen + camera bubble, or camera only) with countdown, pause/resume, a
 * timer and size meter, preview and re-record. Loaded lazily.
 *
 * @param {{ mode: 'screenshot' | 'record' | 'markup', file?: File, support: ReturnType<typeof import('../../lib/media-recorder').captureSupport>, onClose: () => void, onAttach: (file: File) => void }} props
 */
export default function CaptureDialog({ mode, file, support, onClose, onAttach }) {
  const title = mode === 'record' ? 'Record a video' : mode === 'markup' ? 'Mark up image' : 'Take a screenshot';
  const recorderApi = useRef({});
  const [recordingActive, setRecordingActive] = useState(false);

  // Escape or the close button while recording stops the recording and shows
  // the preview instead of throwing the take away.
  const requestClose = useCallback(() => {
    if (recordingActive && recorderApi.current.stop) recorderApi.current.stop();
    else onClose();
  }, [recordingActive, onClose]);

  return (
    <Modal isOpen onClose={requestClose} title={title} size="xl">
      {mode === 'record'
        ? <RecordPanel support={support} onAttach={onAttach} onCancel={onClose} controlRef={recorderApi} onActiveChange={setRecordingActive} />
        : mode === 'markup'
          ? <MarkupFilePanel file={file} onAttach={onAttach} onCancel={onClose} />
          : <ScreenshotPanel onAttach={onAttach} onCancel={onClose} />}
    </Modal>
  );
}

function ScreenshotPanel({ onAttach, onCancel }) {
  const [frame, setFrame] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choose = async () => {
    setBusy(true);
    setError('');
    try {
      setFrame(await captureScreenFrame());
    } catch (err) {
      setError(captureErrorMessage(err, 'The screenshot could not be taken. Try again, or attach an image file instead.'));
    } finally {
      setBusy(false);
    }
  };
  if (frame) return <MarkupEditor image={frame} onCancel={onCancel} onDone={onAttach} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Choose a tab, window or screen. You can draw arrows, boxes and notes on the screenshot before you attach it.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={buttonClass}>Cancel</button>
        <button type="button" onClick={choose} disabled={busy} aria-busy={busy || undefined} className={primaryClass}>
          <Monitor className="h-4 w-4" aria-hidden="true" /> {busy ? 'Waiting for your choice…' : 'Choose screen, window or tab'}
        </button>
      </div>
    </div>
  );
}

function MarkupFilePanel({ file, onAttach, onCancel }) {
  const [image, setImage] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    loadImage(file).then((loaded) => { if (!cancelled) setImage(loaded); }, (err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [file]);
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!image) return <p role="status" className="text-sm text-muted-foreground">Opening image…</p>;
  return <MarkupEditor image={image} fileName={file.name} onCancel={onCancel} onDone={onAttach} doneLabel="Use marked-up image" />;
}

function RecordPanel({ support, onAttach, onCancel, controlRef, onActiveChange }) {
  const available = SOURCES.filter(({ needs }) => (needs === 'camera' ? support.camera : needs === 'screen' ? support.screen : support.screen && support.camera));
  const [source, setSource] = useState(available[0]?.id ?? 'camera');
  const [microphone, setMicrophone] = useState(true);
  const [phase, setPhase] = useState('setup'); // setup | starting | countdown | recording | paused | preview
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [progress, setProgress] = useState({ elapsedMs: 0, remainingMs: MAX_RECORDING_DURATION_MS, bytes: 0 });
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [micActive, setMicActive] = useState(false);
  const captureRef = useRef(null);
  const controllerRef = useRef(null);
  const countdownRef = useRef(null);
  const previewRef = useRef(null);
  const bubbleRef = useRef(null);
  const statusRef = useRef(null);
  const sourceGroupId = useId();

  const release = useCallback(() => {
    clearInterval(countdownRef.current);
    captureRef.current?.dispose();
    captureRef.current = null;
  }, []);

  const finish = useCallback(({ blob, reason, overLimit, mimeType, durationMs }) => {
    release();
    controllerRef.current = null;
    if (reason === 'size') setNotice('The recording reached the 50 MB upload limit, so it stopped.');
    else if (reason === 'duration') setNotice(`The recording reached the ${Math.round(MAX_RECORDING_DURATION_MS / 60000)}-minute limit, so it stopped.`);
    else if (reason === 'ended') setNotice('Screen sharing ended, so the recording stopped.');
    if (!blob.size) {
      setError('No recording data was captured. Try again.');
      setPhase('setup');
      return;
    }
    if (overLimit) {
      setError('This recording is over the 50 MB upload limit. Record a shorter clip.');
      setPhase('setup');
      return;
    }
    setResult({ blob, mimeType, durationMs, url: URL.createObjectURL(blob) });
    setPhase('preview');
  }, [release]);

  const beginRecording = useCallback(() => {
    const capture = captureRef.current;
    if (!capture) return;
    controllerRef.current = startCappedRecording(capture.stream, {
      maxBytes: MAX_UPLOAD_BYTES,
      maxDurationMs: MAX_RECORDING_DURATION_MS,
      bitsPerSecond: CHAT_RECORDING_BITRATE,
      onProgress: setProgress,
      onStop: finish,
    });
    capture.onSourceEnded(() => controllerRef.current?.stop('ended'));
    setPhase('recording');
  }, [finish]);

  const start = async () => {
    setError('');
    setNotice('');
    setPhase('starting');
    try {
      captureRef.current = await acquireRecordingStream({ source, microphone });
      setMicActive(captureRef.current.microphoneActive);
      if (microphone && !captureRef.current.microphoneActive) setNotice('Your microphone is not available, so this recording has no narration.');
      setCountdown(COUNTDOWN_SECONDS);
      setPhase('countdown');
      let remaining = COUNTDOWN_SECONDS;
      countdownRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(countdownRef.current);
          beginRecording();
        } else {
          setCountdown(remaining);
        }
      }, 1000);
    } catch (err) {
      release();
      setPhase('setup');
      setError(captureErrorMessage(err, 'Recording could not start. Check your browser permissions and try again.'));
    }
  };

  const stop = useCallback(() => {
    if (phase === 'countdown') {
      release();
      setPhase('setup');
      return;
    }
    controllerRef.current?.stop('manual');
  }, [phase, release]);

  const togglePause = () => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (phase === 'paused') { if (controller.resume()) setPhase('recording'); }
    else if (controller.pause()) setPhase('paused');
  };

  const discardTake = () => {
    if (result?.url) URL.revokeObjectURL(result.url);
    setResult(null);
    setProgress({ elapsedMs: 0, remainingMs: MAX_RECORDING_DURATION_MS, bytes: 0 });
    setNotice('');
    setPhase('setup');
  };

  const attach = () => {
    if (!result) return;
    const name = recordingFileName(source === 'camera' ? 'camera-recording' : 'screen-recording', result.mimeType);
    const recorded = new File([result.blob], name, { type: result.mimeType });
    URL.revokeObjectURL(result.url);
    onAttach(recorded);
  };

  const active = phase === 'countdown' || phase === 'recording' || phase === 'paused';
  useEffect(() => { onActiveChange(active); }, [active, onActiveChange]);
  useEffect(() => { controlRef.current = { stop }; }, [controlRef, stop]);
  useEffect(() => { if (phase === 'recording' || phase === 'preview') statusRef.current?.focus(); }, [phase]);
  useEffect(() => {
    if (bubbleRef.current) bubbleRef.current.srcObject = captureRef.current?.preview ?? (source === 'camera' ? captureRef.current?.stream : null) ?? null;
  }, [phase, source]);
  useEffect(() => () => {
    controllerRef.current?.stop('manual');
    release();
  }, [release]);
  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, [result]);

  if (!available.length) {
    return <p role="alert" className="text-sm text-destructive">This browser cannot record video. Attach a file instead.</p>;
  }

  if (phase === 'preview' && result) {
    return (
      <div className="space-y-3">
        <p ref={statusRef} tabIndex={-1} role="status" className="text-sm font-medium focus:outline-none">
          Preview · {formatDuration(result.durationMs)} · {formatBytes(result.blob.size)}
        </p>
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        <video ref={previewRef} src={result.url} controls playsInline className="max-h-[55vh] w-full rounded-md bg-black" aria-label="Recording preview" />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => { discardTake(); onCancel(); }} className={buttonClass}>Discard</button>
          <button type="button" onClick={discardTake} className={buttonClass}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Re-record</button>
          <button type="button" onClick={attach} className={primaryClass}>Attach recording</button>
        </div>
      </div>
    );
  }

  if (active) {
    const sizePercent = Math.min(100, Math.round((progress.bytes / MAX_UPLOAD_BYTES) * 100));
    return (
      <div className="space-y-4">
        {phase === 'countdown' ? (
          <p role="timer" aria-live="assertive" className="py-6 text-center text-5xl font-semibold tabular-nums">
            <span className="sr-only">Recording starts in </span>{countdown}
          </p>
        ) : (
          <div ref={statusRef} tabIndex={-1} className="space-y-2 focus:outline-none">
            <p className="flex items-center gap-2 text-sm font-medium" role="status">
              <Circle className={`h-3 w-3 ${phase === 'paused' ? 'fill-muted-foreground text-muted-foreground' : 'fill-destructive text-destructive motion-safe:animate-pulse'}`} aria-hidden="true" />
              {phase === 'paused' ? 'Paused' : 'Recording'}
            </p>
            <p role="timer" aria-label={`Recorded ${formatDuration(progress.elapsedMs)}, ${formatDuration(progress.remainingMs)} left`} className="text-2xl font-semibold tabular-nums">
              {formatDuration(progress.elapsedMs)} <span className="text-sm font-normal text-muted-foreground">/ {formatDuration(MAX_RECORDING_DURATION_MS)} max</span>
            </p>
            <div>
              <div role="progressbar" aria-label="Recording size" aria-valuemin={0} aria-valuemax={100} aria-valuenow={sizePercent} aria-valuetext={`${formatBytes(progress.bytes)} of 50 MB`} className="h-2 w-full overflow-hidden rounded bg-muted">
                <div className={`h-full ${sizePercent > 85 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${sizePercent}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{formatBytes(progress.bytes)} of 50 MB · {micActive ? <><Mic className="inline h-3 w-3" aria-hidden="true" /> microphone on</> : <><MicOff className="inline h-3 w-3" aria-hidden="true" /> no microphone</>}</p>
            </div>
          </div>
        )}
        {(source === 'screen-camera' || source === 'camera') && (
          <video ref={bubbleRef} muted autoPlay playsInline aria-label="Your camera" className={source === 'camera' ? 'max-h-64 w-full rounded-md bg-black object-cover' : 'h-24 w-24 rounded-full bg-black object-cover'} />
        )}
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {phase !== 'countdown' && (
            <button type="button" onClick={togglePause} className={buttonClass} disabled={typeof controllerRef.current?.recorder?.pause !== 'function'}>
              {phase === 'paused' ? <><Play className="h-4 w-4" aria-hidden="true" /> Resume</> : <><Pause className="h-4 w-4" aria-hidden="true" /> Pause</>}
            </button>
          )}
          <button type="button" onClick={stop} className={primaryClass}>
            <Square className="h-4 w-4" aria-hidden="true" /> {phase === 'countdown' ? 'Cancel' : 'Stop recording'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend id={sourceGroupId} className="text-sm font-medium">What to record</legend>
        {available.map(({ id, label, description, Icon }) => (
          <label key={id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${source === id ? 'border-foreground bg-muted' : 'border-border'}`}>
            <input type="radio" name={`${sourceGroupId}-source`} value={id} checked={source === id} onChange={() => setSource(id)} />
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{description}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={microphone} onChange={(event) => setMicrophone(event.target.checked)} />
        <Mic className="h-4 w-4" aria-hidden="true" /> Record my microphone
      </label>
      <p className="text-xs text-muted-foreground">
        Recordings stop automatically at {Math.round(MAX_RECORDING_DURATION_MS / 60000)} minutes or 50 MB. Tab or system audio is included when your browser offers it. You can preview before attaching.
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={buttonClass}>Cancel</button>
        <button type="button" onClick={start} disabled={phase === 'starting'} aria-busy={phase === 'starting' || undefined} className={primaryClass}>
          <Circle className="h-4 w-4 fill-current" aria-hidden="true" /> {phase === 'starting' ? 'Starting…' : 'Start recording'}
        </button>
      </div>
    </div>
  );
}
