import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
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

function Toast({ id, type = 'info', title, message, onDismiss }) {
  const Icon = ICONS[type] || ICONS.info;
  const isError = type === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={cn(
        'flex items-start gap-3 w-80 px-4 py-3 rounded-xl border shadow-lg transition-all duration-300',
        STYLES[type] || STYLES.info
      )}
    >
      <Icon className={cn('w-5 h-5 mt-0.5 flex-shrink-0', ICON_STYLES[type])} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold text-sm">{title}</p>}
        {message && <p className={cn('text-sm', title ? 'opacity-80 mt-0.5' : '')}>{message}</p>}
      </div>
      <button
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
        className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [isMobile, setIsMobile] = useState(false);
  const timers = useRef({});

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    setIsMobile(mediaQuery.matches);

    const handleChange = (e) => setIsMobile(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((type, titleOrOptions, message, duration = 4000) => {
    const id = ++toastId;
    let title, msg;

    if (typeof titleOrOptions === 'object') {
      title = titleOrOptions.title;
      msg = titleOrOptions.message;
      duration = titleOrOptions.duration ?? duration;
    } else {
      title = titleOrOptions;
      msg = message;
    }

    setToasts(prev => [...prev.slice(-4), { id, type, title, message: msg }]);
    timers.current[id] = setTimeout(() => dismiss(id), duration);
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
          <div key={t.id} className="pointer-events-auto animate-in slide-in-from-bottom-2 fade-in duration-300">
            <Toast {...t} onDismiss={dismiss} />
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
