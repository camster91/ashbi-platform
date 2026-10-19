import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button } from '../ui';
import { describeElapsed } from '../LiveTimer';

function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function elapsedSince(startTime) {
  const start = new Date(startTime).getTime();
  return Number.isFinite(start) ? Math.max(0, (Date.now() - start) / 1000) : 0;
}

/**
 * The indigo "running timer" band (Time mockup). It reads the same
 * ['running-time-session'] query as the header's LiveTimer, so Stop here also
 * clears the header timer once that query refetches.
 */
export default function RunningTimer({ session }) {
  const queryClient = useQueryClient();
  const [elapsed, setElapsed] = useState(() => elapsedSince(session.startTime));

  useEffect(() => {
    setElapsed(elapsedSince(session.startTime));
    const id = setInterval(() => setElapsed(elapsedSince(session.startTime)), 1000);
    return () => clearInterval(id);
  }, [session.startTime]);

  const stop = useMutation({
    mutationFn: () => api.stopTimeSession(session.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['running-time-session'] });
      queryClient.invalidateQueries({ queryKey: ['weekly-timesheet'] });
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
    },
  });

  const title = session.task?.title || session.description || 'Timer running';
  const context = [session.project?.name, session.task?.title && session.description ? session.description : null].filter(Boolean).join(' · ');

  return (
    <section aria-label="Running timer" className="flex flex-wrap items-center gap-4 rounded-lg bg-primary px-5 py-4 text-primary-foreground">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
      <div className="min-w-0 flex-[1_1_16rem]">
        <p className="font-semibold break-words">{title}</p>
        {context && <p className="text-sm text-primary-foreground/80 break-words">{context}</p>}
      </div>
      <p className="figure text-3xl font-medium tracking-tight">
        <span aria-hidden="true">{clock(elapsed)}</span>
        <span className="sr-only">Running for {describeElapsed(elapsed)}</span>
      </p>
      <Button type="button" onClick={() => stop.mutate()} loading={stop.isPending} className="focus:ring-primary-foreground/80">
        Stop
      </Button>
      {stop.isError && (
        <p role="alert" className="basis-full text-sm font-semibold">
          {stop.error?.message || 'The timer could not be stopped. Try again.'}
        </p>
      )}
    </section>
  );
}
