import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal, { ModalFooter } from '../Modal';
import { Button, Field, Input, Select, Textarea } from '../ui';
import { api } from '../../lib/api';

const MAX_HOURS = 24;

/**
 * "Add time": log a manual entry on any project for a day of the shown week.
 * The entry is saved at noon UTC of the chosen date, so it lands on that
 * calendar day in the weekly timesheet (which groups by UTC date).
 */
export default function AddTimeModal({ isOpen, onClose, days, defaultDay }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ projectId: '', date: defaultDay, hours: '', description: '', billable: true });
  const [error, setError] = useState('');
  const change = (patch) => setForm((old) => ({ ...old, ...patch }));

  // Shares the ['projects'] cache entry (an array) with the header timer.
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects().then((r) => (Array.isArray(r) ? r : r?.projects ?? [])),
    enabled: isOpen,
  });
  const options = (Array.isArray(projects) ? projects : [])
    .filter((project) => project.status !== 'CANCELLED')
    .map((project) => ({ value: project.id, label: project.client?.name ? `${project.name} — ${project.client.name}` : project.name }));

  const save = useMutation({
    mutationFn: (body) => api.createTimeEntry(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-timesheet'] });
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      setForm({ projectId: '', date: defaultDay, hours: '', description: '', billable: true });
      onClose();
    },
    onError: (err) => setError(err?.message || 'The time could not be saved. Try again.'),
  });

  const submit = (event) => {
    event.preventDefault();
    const minutes = Math.round(Number(form.hours) * 60);
    if (!form.projectId) return setError('Choose a project.');
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_HOURS * 60) return setError(`Enter between 0.1 and ${MAX_HOURS} hours.`);
    setError('');
    save.mutate({
      projectId: form.projectId,
      duration: minutes,
      date: `${form.date}T12:00:00.000Z`,
      billable: form.billable,
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    });
  };

  const close = () => { if (!save.isPending) { setError(''); onClose(); } };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Add time">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Project" required>
          <Select
            value={form.projectId}
            onChange={(event) => change({ projectId: event.target.value })}
            placeholder={projectsLoading ? 'Loading projects…' : 'Choose a project'}
            options={options}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Day" required>
            <Select value={form.date} onChange={(event) => change({ date: event.target.value })} options={days.map((day) => ({ value: day.key, label: `${day.name} ${day.day}` }))} />
          </Field>
          <Field label="Hours" hint="For example 1.5 for an hour and a half." required>
            <Input type="number" inputMode="decimal" min="0.1" max={MAX_HOURS} step="0.25" value={form.hours} onChange={(event) => change({ hours: event.target.value })} />
          </Field>
        </div>
        <Field label="What did you work on?">
          <Textarea rows={2} maxLength={2000} value={form.description} onChange={(event) => change({ description: event.target.value })} />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="h-4 w-4" checked={form.billable} onChange={(event) => change({ billable: event.target.checked })} />
          Billable
        </label>
        {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
        <ModalFooter>
          <Button type="button" variant="outline" onClick={close} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save time</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
