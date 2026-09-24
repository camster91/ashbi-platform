import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Circle,
  ExternalLink,
  ListChecks,
  LayoutDashboard,
  Inbox,
  Sparkles,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { api } from '../lib/api';
import Modal from './Modal';
import { Button } from './ui';

const QUERY_KEY = ['onboarding-progress'];

const FEATURE_INTRO_STEPS = [
  {
    id: 'command-center',
    icon: LayoutDashboard,
    title: 'Your agency command center',
    description:
      'Ashbi Hub brings clients, projects, proposals, and invoices into one calm workspace. Start each day on the dashboard to see what needs attention.',
  },
  {
    id: 'inbox',
    icon: Inbox,
    title: 'Never miss a client message',
    description:
      'The Smart Inbox surfaces urgent threads, sentiment, and AI summaries so you can triage in seconds—not scroll through email.',
  },
  {
    id: 'quick-create',
    icon: Sparkles,
    title: 'Create anything in seconds',
    description:
      'Press ⌘K (or Ctrl+K) to jump to clients, projects, invoices, and more. It is the fastest way to move work forward.',
  },
];

function taskStatus(task) {
  if (task.completed) return 'Completed';
  if (task.skipped) return 'Skipped';
  return 'Not completed';
}

export default function OnboardingTour() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const previousPath = useRef(location.pathname);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [introStep, setIntroStep] = useState(0);

  const progressQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: api.getOnboardingProgress,
    staleTime: 0,
    retry: false,
  });
  const progress = progressQuery.data;

  useEffect(() => {
    if (progress?.supported && ['eligible', 'in_progress'].includes(progress.state)) {
      const timer = window.setTimeout(() => setOpen(true), 700);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [progress?.supported, progress?.state]);

  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    if (progress?.supported && progress.startedAt) {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  }, [location.pathname, progress?.startedAt, progress?.supported, queryClient]);

  useEffect(() => {
    const handleRestart = () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setIntroStep(0);
      setOpen(true);
    };
    window.addEventListener('ashbi:onboarding-restart', handleRestart);
    return () => window.removeEventListener('ashbi:onboarding-restart', handleRestart);
  }, [queryClient]);

  const run = useMutation({
    mutationFn: action => {
      if (action.type === 'start') return api.startOnboarding();
      if (action.type === 'skip-task') return api.skipOnboardingTask(action.taskId);
      if (action.type === 'skip-all') return api.skipOnboarding();
      throw new Error('Unknown onboarding action');
    },
    onMutate: () => setError(''),
    onSuccess: data => {
      queryClient.setQueryData(QUERY_KEY, data);
      if (data.state === 'skipped') setOpen(false);
    },
    onError: failure => setError(failure.message || 'Progress could not be saved. Check your connection and try again.'),
  });

  if (!progress?.supported || progress.state === 'completed' || progress.state === 'skipped') return null;

  const resolvedCount = progress.completedCount || 0;
  const totalCount = progress.totalCount || 0;
  const isEligible = progress.state === 'eligible';
  const feature = FEATURE_INTRO_STEPS[introStep];
  const FeatureIcon = feature.icon;
  const isLastIntroStep = introStep === FEATURE_INTRO_STEPS.length - 1;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 left-4 z-30 inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-lg lg:bottom-5 lg:left-[19rem]"
          aria-label={`Resume getting started, ${resolvedCount} of ${totalCount} tasks resolved`}
        >
          <ListChecks className="h-4 w-4" aria-hidden="true" />
          Getting started {resolvedCount}/{totalCount}
        </button>
      )}

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={isEligible ? 'Welcome to Ashbi Hub' : 'Your getting-started checklist'}
        size="lg"
      >
        <div className="space-y-4">
          {isEligible ? (
            <>
              <div className="flex gap-1.5" aria-hidden="true">
                {FEATURE_INTRO_STEPS.map((step, idx) => (
                  <div
                    key={step.id}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      idx <= introStep ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                ))}
              </div>

              <div className="rounded-2xl border border-border bg-muted/30 p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                  <FeatureIcon className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Step {introStep + 1} of {FEATURE_INTRO_STEPS.length}
                </p>
                <h3 className="font-heading text-xl text-foreground">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {resolvedCount} of {totalCount} tasks resolved. A task completes only after Ashbi verifies the successful action.
              </p>

              <div
                role="progressbar"
                aria-label="Onboarding progress"
                aria-valuemin={0}
                aria-valuemax={totalCount}
                aria-valuenow={resolvedCount}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full bg-primary motion-reduce:transition-none"
                  style={{ width: `${totalCount ? (resolvedCount / totalCount) * 100 : 0}%` }}
                />
              </div>
            </>
          )}

          {!isEligible && (
            <ol className="max-h-[52vh] space-y-3 overflow-y-auto pr-1" aria-label="Getting-started tasks">
              {progress.tasks.map(task => {
                const resolved = task.completed || task.skipped;
                return (
                  <li key={task.id} className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-start gap-3">
                      {resolved
                        ? <Check className="mt-0.5 h-5 w-5 shrink-0 text-green-700 dark:text-green-300" aria-hidden="true" />
                        : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-foreground">{task.title}</h3>
                          <span className="text-xs font-medium text-muted-foreground">{taskStatus(task)}</span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                        {!resolved && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => {
                                setOpen(false);
                                navigate(task.href);
                              }}
                            >
                              Open task <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={run.isPending}
                              onClick={() => run.mutate({ type: 'skip-task', taskId: task.id })}
                            >
                              Skip this task
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
            <div className="flex flex-wrap gap-2">
              {isEligible && introStep > 0 && (
                <Button variant="outline" size="sm" onClick={() => setIntroStep((s) => s - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back
                </Button>
              )}
              <Button
                variant="outline"
                disabled={run.isPending}
                onClick={() => run.mutate({ type: 'skip-all' })}
              >
                {isEligible ? 'Skip tour' : 'Skip onboarding'}
              </Button>
              {isEligible ? (
                isLastIntroStep ? (
                  <Button disabled={run.isPending} onClick={() => run.mutate({ type: 'start' })}>
                    {run.isPending ? 'Saving…' : 'Start checklist'} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : (
                  <Button onClick={() => setIntroStep((s) => s + 1)}>
                    Next <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )
              ) : null}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
