import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateInZone } from '@shared/task-recurrence.js';

function RecurrenceEditor({ task, onClose }) {
  const queryClient = useQueryClient();
  const [rule, setRule] = useState(() => task.recurrenceRule?.frequency ? task.recurrenceRule : {
    frequency: 'WEEKLY', interval: 1, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    startDate: dateInZone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone),
  });
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: next => api.saveTaskRecurrence(task.id, { revision: task.recurrenceRevision ?? 0, rule: next }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
    onError: err => setError(err.data?.message || err.message || 'Recurrence could not be saved.'),
  });
  const change = (key, value) => { setRule(current => ({ ...current, [key]: value })); setError(''); };
  return <form aria-label="Recurring task settings" className="space-y-3" onSubmit={event => { event.preventDefault(); mutation.mutate(rule); }}>
    <p className="text-sm text-muted-foreground">Each repeat creates a new task in this project. Previous work stays intact. New tasks start in To do without a stage or dependency.</p>
    <fieldset disabled={mutation.isPending} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Repeat trigger<select aria-label="Repeat trigger" value={rule.trigger ?? 'CALENDAR'} onChange={event => change('trigger', event.target.value)} className="block min-h-11 rounded border border-border bg-background px-2">
        <option value="CALENDAR">Calendar schedule</option><option value="AFTER_COMPLETION">After completion</option>
      </select></label>
      <label className="text-sm">Repeat every<input aria-label="Repeat interval" type="number" min={1} max={365} required value={rule.interval}
        onChange={event => change('interval', Number(event.target.value))} className="block w-24 min-h-11 rounded border border-border bg-background px-2" /></label>
      <label className="text-sm">Frequency<select aria-label="Repeat frequency" value={rule.frequency} onChange={event => change('frequency', event.target.value)} className="block min-h-11 rounded border border-border bg-background px-2">
        <option value="DAILY">Days</option><option value="WEEKLY">Weeks</option><option value="MONTHLY">Months</option>
      </select></label>
      {rule.trigger !== 'AFTER_COMPLETION' && <label className="text-sm">First due date<input aria-label="First repeat due date" type="date" required value={rule.startDate}
        onChange={event => change('startDate', event.target.value)} className="block min-h-11 rounded border border-border bg-background px-2" /></label>
      }
      <label className="text-sm">Timezone<input aria-label="Recurrence timezone" required value={rule.timeZone} maxLength={100}
        onChange={event => change('timeZone', event.target.value)} className="block min-h-11 rounded border border-border bg-background px-2" /></label>
      <button type="submit" className="min-h-11 rounded bg-primary px-3 text-primary-foreground">{mutation.isPending ? 'Saving…' : 'Save recurrence'}</button>
      {task.recurrenceRule?.frequency && <button type="button" className="min-h-11 rounded border border-border px-3" onClick={() => mutation.mutate(null)}>Stop repeating</button>}
      <button type="button" className="min-h-11 px-3" onClick={onClose}>Cancel</button>
    </fieldset>
    {rule.trigger === 'AFTER_COMPLETION' && <p className="text-sm text-muted-foreground">The first completion of each task schedules one new copy. Its due date is this interval after completion. Reopening the same task does not create another copy. Enabling this setting does not replay completed history.</p>}
    {error && <div role="alert" className="text-sm text-destructive">{error} <button type="button" className="min-h-11 underline" onClick={async () => { await queryClient.invalidateQueries({ queryKey: ['task', task.id] }); onClose(); }}>Reload settings</button></div>}
  </form>;
}

export default function TaskRecurrence({ task }) {
  const [editing, setEditing] = useState(false);
  const buttonRef = useRef(null);
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' }[task.recurrenceRule?.frequency];
  const close = () => { setEditing(false); buttonRef.current?.focus(); };
  if (task.recurrenceSourceId) return <p className="text-sm text-muted-foreground mb-6">Created from <Link className="underline" to={`/task/${task.recurrenceSourceId}`}>a recurring task</Link>. Manage its schedule on the original task.</p>;
  return <section className="rounded-lg border border-border p-4 mb-6 space-y-3" aria-label="Task recurrence">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-medium">Recurrence</h2><p className="text-sm text-muted-foreground">{task.recurrenceRule?.frequency ? task.recurrenceRule.trigger === 'AFTER_COMPLETION' ? `Repeats ${task.recurrenceRule.interval} ${unit}${task.recurrenceRule.interval === 1 ? '' : 's'} after each task’s first completion in ${task.recurrenceRule.timeZone}.` : `Repeats every ${task.recurrenceRule.interval} ${unit}${task.recurrenceRule.interval === 1 ? '' : 's'} in ${task.recurrenceRule.timeZone}. Next due ${task.recurrenceNextDate?.slice(0, 10) || 'pending'}.` : 'Does not repeat'}</p></div>
      <button ref={buttonRef} type="button" aria-expanded={editing} className="min-h-11 rounded border border-border px-3" onClick={() => setEditing(current => !current)}>Configure recurrence</button>
    </div>
    {editing && <RecurrenceEditor task={task} onClose={close} />}
  </section>;
}
