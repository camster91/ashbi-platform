import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Clock, Play, Square, Loader2 } from 'lucide-react';

const TIMER_STORAGE_KEY = 'ashbi-live-timer';

/**
 * LiveTimer — global Start/Pause/Stop button shown in the app header.
 * Timer state survives reload via localStorage.
 * Starting a new timer automatically stops any previous one.
 * Every timer must belong to a project (TimeSession.projectId is required),
 * so Start opens a small picker; the last chosen project is remembered.
 * On Stop, POSTs to /api/time-sessions/:id/stop to create a TimeEntry.
 */
export default function LiveTimer({ socket }) {
  const queryClient = useQueryClient();
  const intervalRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const [projectId, setProjectId] = useState(() => {
    try {
      return localStorage.getItem(`${TIMER_STORAGE_KEY}-project`) || '';
    } catch {
      return '';
    }
  });

  // Restore state from localStorage
  const [timerState, setTimerState] = useState(() => {
    try {
      const saved = localStorage.getItem(TIMER_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // If the timer was running, calculate elapsed since the saved startTime
        if (parsed.isRunning && parsed.startTime) {
          const elapsed = Math.floor((Date.now() - parsed.startTime) / 1000);
          return { ...parsed, elapsed: Math.max(0, elapsed) };
        }
        return parsed;
      }
    } catch {}
    return { isRunning: false, sessionId: null, startTime: null, elapsed: 0, description: '' };
  });

  // Persist to localStorage
  const persistTimer = useCallback((state) => {
    try {
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state));
    } catch {}
    setTimerState(state);
  }, []);

  // Update elapsed every second when running
  useEffect(() => {
    if (timerState.isRunning) {
      intervalRef.current = setInterval(() => {
        setTimerState(prev => {
          if (!prev.startTime) return prev;
          const elapsed = Math.floor((Date.now() - prev.startTime) / 1000);
          return { ...prev, elapsed };
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [timerState.isRunning]);

  // Check for running timer on mount (server sync)
  const { data: runningSession } = useQuery({
    queryKey: ['running-time-session'],
    queryFn: () => api.getRunningTimeSession(),
    retry: false,
    staleTime: 30000,
  });

  // Sync with server on mount — if server has a running timer but local doesn't
  useEffect(() => {
    if (runningSession && runningSession.id) {
      persistTimer({
        isRunning: true,
        sessionId: runningSession.id,
        startTime: new Date(runningSession.startTime).getTime(),
        elapsed: Math.floor((Date.now() - new Date(runningSession.startTime).getTime()) / 1000),
        description: runningSession.description || '',
      });
    }
  }, [runningSession, persistTimer]);

  // Shares the ['projects'] cache entry (an array) with the app shell.
  const { data: projects = [], isLoading: projectsLoading, isSuccess: projectsLoaded } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects().then((r) => (Array.isArray(r) ? r : r?.projects ?? [])),
    enabled: pickerOpen,
  });
  const selectableProjects = (Array.isArray(projects) ? projects : []).filter(
    (p) => !['LAUNCHED', 'CANCELLED'].includes(p.status)
  );

  // The remembered project may since have been launched, cancelled, deleted
  // or belong to another workspace: once the list has loaded, forget it.
  const rememberedProjectMissing = pickerOpen && projectsLoaded && Boolean(projectId)
    && !selectableProjects.some((p) => p.id === projectId);
  useEffect(() => {
    if (!rememberedProjectMissing) return;
    setProjectId('');
    try {
      localStorage.removeItem(`${TIMER_STORAGE_KEY}-project`);
    } catch {}
  }, [rememberedProjectMissing]);

  // Mutations
  const startMutation = useMutation({
    mutationFn: (data) => api.startTimeSession(data),
    onSuccess: (session) => {
      persistTimer({
        isRunning: true,
        sessionId: session.id,
        startTime: new Date(session.startTime).getTime(),
        elapsed: 0,
        description: session.description || '',
      });
      setPickerOpen(false);
      setPickerError('');
      queryClient.invalidateQueries({ queryKey: ['running-time-session'] });
      // Notify via socket
      if (socket?.emit) {
        socket.emit('timer:started', { sessionId: session.id });
      }
    },
    onError: (err) => {
      setPickerError(err?.message || 'Could not start the timer');
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => api.stopTimeSession(timerState.sessionId),
    onSuccess: (session) => {
      const finalState = { isRunning: false, sessionId: null, startTime: null, elapsed: 0, description: '' };
      persistTimer(finalState);
      queryClient.invalidateQueries({ queryKey: ['running-time-session'] });
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      // Notify via socket
      if (socket?.emit) {
        socket.emit('timer:stopped', { sessionId: session?.id });
      }
    },
  });

  const formatElapsed = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Listen for socket timer events from other tabs/windows
  useEffect(() => {
    if (!socket) return;
    const handleTimerStarted = (data) => {
      // Another session was started — if we have a running timer, stop it
      if (timerState.isRunning && data.sessionId !== timerState.sessionId) {
        persistTimer({ isRunning: false, sessionId: null, startTime: null, elapsed: 0, description: '' });
      }
    };
    const handleTimerStopped = () => {
      queryClient.invalidateQueries({ queryKey: ['running-time-session'] });
    };
    socket.on('timer:started', handleTimerStarted);
    socket.on('timer:stopped', handleTimerStopped);
    return () => {
      socket.off('timer:started', handleTimerStarted);
      socket.off('timer:stopped', handleTimerStopped);
    };
  }, [socket, timerState.sessionId, timerState.isRunning, persistTimer, queryClient]);

  const handleStart = () => {
    if (!projectId) {
      setPickerError('Choose a project to start the timer.');
      return;
    }
    setPickerError('');
    try {
      localStorage.setItem(`${TIMER_STORAGE_KEY}-project`, projectId);
    } catch {}
    startMutation.mutate({ projectId, description: timerState.description || undefined });
  };

  const handleStop = () => {
    if (timerState.sessionId) {
      stopMutation.mutate();
    }
  };

  const isLoading = startMutation.isPending || stopMutation.isPending;

  return (
    // Opaque card backing: the top bar is translucent (bg-card/80 +
    // backdrop-blur), and the status tints below are translucent too, so
    // without it the text contrast depends on whatever scrolls underneath.
    <div className="relative flex items-center gap-1.5 rounded-lg bg-card">
      {/* Timer display */}
      {timerState.isRunning && (
        <span className={cn(
          'font-mono text-xs font-semibold tabular-nums',
          'text-success'
        )}>
          {formatElapsed(timerState.elapsed)}
        </span>
      )}

      {/* Start/Stop button */}
      <button
        onClick={timerState.isRunning ? handleStop : () => setPickerOpen((open) => !open)}
        disabled={isLoading}
        className={cn(
          'flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg transition-all',
          'hover:shadow-sm active:scale-95',
          timerState.isRunning
            ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
            : 'bg-success/10 text-success hover:bg-success/20',
          isLoading && 'opacity-50 cursor-not-allowed'
        )}
        title={timerState.isRunning ? 'Stop timer' : 'Start timer'}
        aria-expanded={timerState.isRunning ? undefined : pickerOpen}
      >
        {isLoading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : timerState.isRunning ? (
          <Square className="w-3 h-3 fill-current" />
        ) : (
          <Play className="w-3 h-3 fill-current" />
        )}
        <span className="hidden sm:inline">{timerState.isRunning ? 'Stop' : 'Timer'}</span>
      </button>

      {/* Project picker — a timer cannot start without a project */}
      {!timerState.isRunning && pickerOpen && (
        <div
          role="dialog"
          aria-label="Start timer"
          onKeyDown={(e) => { if (e.key === 'Escape') setPickerOpen(false); }}
          className="absolute right-0 top-full z-50 mt-2 w-64 space-y-2 rounded-lg border border-border bg-card p-3 shadow-lg"
        >
          <label htmlFor="live-timer-project" className="block text-xs font-medium text-foreground">
            Project
          </label>
          <select
            id="live-timer-project"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setPickerError('');
            }}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            <option value="">{projectsLoading ? 'Loading projects…' : 'Select a project'}</option>
            {selectableProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {!projectsLoading && selectableProjects.length === 0 && (
            <p className="text-xs text-muted-foreground">Create a project first — every timer is logged against one.</p>
          )}
          {pickerError && (
            <p role="alert" className="text-xs text-destructive">{pickerError}</p>
          )}
          <button
            type="button"
            onClick={handleStart}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-1 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success hover:bg-success/20 disabled:opacity-50"
          >
            <Play className="w-3 h-3 fill-current" />
            Start timer
          </button>
        </div>
      )}
    </div>
  );
}
