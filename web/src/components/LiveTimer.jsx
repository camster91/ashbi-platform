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
 * On Stop, POSTs to /api/time-sessions to create a TimeEntry.
 */
export default function LiveTimer({ socket }) {
  const queryClient = useQueryClient();
  const intervalRef = useRef(null);

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
  }, [runningSession]);

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
      queryClient.invalidateQueries({ queryKey: ['running-time-session'] });
      // Notify via socket
      if (socket?.emit) {
        socket.emit('timer:started', { sessionId: session.id });
      }
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
  }, [socket, timerState.sessionId, timerState.isRunning]);

  const handleStart = () => {
    startMutation.mutate({ description: timerState.description || undefined });
  };

  const handleStop = () => {
    if (timerState.sessionId) {
      stopMutation.mutate();
    }
  };

  const isLoading = startMutation.isPending || stopMutation.isPending;

  return (
    <div className="flex items-center gap-1.5">
      {/* Timer display */}
      {timerState.isRunning && (
        <span className={cn(
          'font-mono text-xs font-semibold tabular-nums',
          'text-green-600 dark:text-green-400'
        )}>
          {formatElapsed(timerState.elapsed)}
        </span>
      )}

      {/* Start/Stop button */}
      <button
        onClick={timerState.isRunning ? handleStop : handleStart}
        disabled={isLoading}
        className={cn(
          'flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg transition-all',
          'hover:shadow-sm active:scale-95',
          timerState.isRunning
            ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
            : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50',
          isLoading && 'opacity-50 cursor-not-allowed'
        )}
        title={timerState.isRunning ? 'Stop timer' : 'Start timer'}
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
    </div>
  );
}
