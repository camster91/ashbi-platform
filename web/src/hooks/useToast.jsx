import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, Pause, Play, X } from 'lucide-react';
import { cn } from '../lib/utils';

const ToastContext = createContext(null);

let toastId = 0;

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES = {
  success: 'border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 text-green-800 dark:text-green-300',
  error: 'border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 text-red-800 dark:text-red-300',
  warning: 'border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 text-amber-800 dark:text-amber-300',
  info: 'border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 text-blue-800 dark:text-blue-300',
};

const ICON_STYLES = {
  success: 'text-green-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

function Toast({ id, type = 'info', title, message, action, duration, timer, now, onDismiss, onPause, onResume }) {
  const Icon = ICONS[type] || ICONS.info;
  const isError = type === 'error';
  const actionPending = useRef(false);
  const [isActionPending, setIsActionPending] = useState(false);
  const isPaused = Boolean(timer && !timer.timeout);
  const elapsed = timer?.timeout ? now - timer.startedAt : 0;
  const remainingSeconds = timer
    ? Math.max(0, Math.ceil((timer.remaining - elapsed) / 1000))
    : 0;

  const runAction = () => {
    if (actionPending.current) return;
    actionPending.current = true;
    setIsActionPending(true);
    try {
      const result = action.onClick();
      if (result && typeof result.then === 'function') {
        result
          .then(() => {
            if (action.dismissOnClick !== false) onDismiss(id);
          })
          .catch(() => {})
          .finally(() => {
            actionPending.current = false;
            setIsActionPending(false);
          });
        return;
      }
      if (action.dismissOnClick !== false) onDismiss(id);
    } catch {
      // The originating workflow reports failures through its normal error state.
    }
    actionPending.current = false;
    setIsActionPending(false);
  };

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      onMouseEnter={() => onPause(id)}
      onMouseLeave={() => onResume(id)}
      onFocusCapture={() => onPause(id)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onResume(id);
      }}
      className={cn(
        'flex items-start gap-3 w-[calc(100vw-2rem)] max-w-80 px-4 py-3 rounded-xl border shadow-lg transition-all duration-300',
        STYLES[type] || STYLES.info
      )}
    >
      <Icon className={cn('w-5 h-5 mt-0.5 flex-shrink-0', ICON_STYLES[type])} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold text-sm">{title}</p>}
        {message && <p className={cn('text-sm', title ? 'opacity-80 mt-0.5' : '')}>{message}</p>}
        {timer && action?.label && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <span>Undo available for {remainingSeconds} {remainingSeconds === 1 ? 'second' : 'seconds'}</span>
            <button
              type="button"
              aria-label={isPaused ? 'Resume notification timer' : 'Pause notification timer'}
              onClick={() => (isPaused ? onResume(id) : onPause(id))}
              className="min-h-11 min-w-11 rounded p-1 inline-flex items-center justify-center hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current dark:hover:bg-white/10"
            >
              {isPaused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          </div>
        )}
        {action?.label && typeof action.onClick === 'function' && (
          <button
            type="button"
            onClick={runAction}
            disabled={isActionPending}
            className="mt-2 min-h-11 rounded-full border border-current px-3 py-1 text-left text-xs font-semibold whitespace-normal hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 dark:hover:bg-white/10"
          >
            {action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
        className="flex-shrink-0 min-h-11 min-w-11 inline-flex items-center justify-center rounded opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [isMobile, setIsMobile] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef({});

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    setIsMobile(mediaQuery.matches);

    const handleChange = (e) => setIsMobile(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]?.timeout);
    delete timers.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    if (!toasts.some(({ duration }) => duration > 0)) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [toasts]);

  const pause = useCallback((id) => {
    const timer = timers.current[id];
    if (!timer?.timeout) return;
    clearTimeout(timer.timeout);
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
    timer.timeout = null;
    setNow(Date.now());
  }, []);

  const resume = useCallback((id) => {
    const timer = timers.current[id];
    if (!timer || timer.timeout || timer.remaining <= 0) return;
    timer.startedAt = Date.now();
    timer.timeout = setTimeout(() => dismiss(id), timer.remaining);
    setNow(Date.now());
  }, [dismiss]);

  const toast = useCallback((type, titleOrOptions, message, duration = 4000) => {
    const id = ++toastId;
    let title, msg, action;

    if (typeof titleOrOptions === 'object') {
      title = titleOrOptions.title;
      msg = titleOrOptions.message;
      action = titleOrOptions.action;
      duration = titleOrOptions.duration ?? duration;
    } else {
      title = titleOrOptions;
      msg = message;
    }

    setToasts(prev => [...prev.slice(-4), { id, type, title, message: msg, action, duration }]);
    if (Number.isFinite(duration) && duration > 0) {
      timers.current[id] = {
        remaining: duration,
        startedAt: Date.now(),
        timeout: setTimeout(() => dismiss(id), duration),
      };
    }
    return id;
  }, [dismiss]);

  const api = {
    success: (title, message, duration) => toast('success', title, message, duration),
    error: (title, message, duration) => toast('error', title, message, duration),
    warning: (title, message, duration) => toast('warning', title, message, duration),
    info: (title, message, duration) => toast('info', title, message, duration),
    dismiss,
  };

  const visibleToasts = isMobile ? toasts.slice(-3) : toasts;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Toaster */}
      <div
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        aria-atomic="true"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      >
        {visibleToasts.map(t => (
          <div key={t.id} className="pointer-events-auto animate-in slide-in-from-bottom-2 fade-in duration-300 motion-reduce:animate-none">
            <Toast {...t} timer={timers.current[t.id]} now={now} onDismiss={dismiss} onPause={pause} onResume={resume} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
