import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock, Play, Square, Plus, DollarSign, Timer, Trash2, RefreshCw, ArrowLeft
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function durationToHours(duration) {
  // duration is in minutes in the DB
  if (!duration) return 0;
  return (duration / 60).toFixed(2);
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TimeTracking() {
  const { projectId } = useParams();
  const queryClient = useQueryClient();

  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerDesc, setTimerDesc] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({
    description: '', hours: '', minutes: '', billable: true
  });

  // Timer interval
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setTimerSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  const { data: entries = [], isLoading, refetch } = useQuery({
    queryKey: ['time-entries', projectId],
    queryFn: () => api.getTimeEntries(projectId),
  });

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.createTimeEntry(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteTimeEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries', projectId] });
    },
  });

  const stopTimer = () => {
    if (!timerRunning) return;
    const totalMinutes = Math.round(timerSeconds / 60);
    if (totalMinutes < 1) {
      setTimerRunning(false);
      setTimerSeconds(0);
      return;
    }
    createMutation.mutate({
      projectId,
      description: timerDesc || 'Timer session',
      duration: totalMinutes,
      billable: true,
    });
    setTimerRunning(false);
    setTimerSeconds(0);
    setTimerDesc('');
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const totalMinutes = (parseInt(manualForm.hours) || 0) * 60 + (parseInt(manualForm.minutes) || 0);
    if (totalMinutes < 1) return;
    createMutation.mutate({
      projectId,
      description: manualForm.description || 'Manual entry',
      duration: totalMinutes,
      billable: manualForm.billable,
    });
    setManualForm({ description: '', hours: '', minutes: '', billable: true });
    setShowManual(false);
  };

  // Compute totals
  const totalMinutes = entries.reduce((s, e) => s + (e.duration || 0), 0);
  const billableMinutes = entries.filter(e => e.billable).reduce((s, e) => s + (e.duration || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const billableHours = (billableMinutes / 60).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {project && (
            <Link to={`/project/${projectId}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1">
              <ArrowLeft className="w-3.5 h-3.5" /> {project.name}
            </Link>
          )}
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Clock className="w-6 h-6 text-primary" />
            Time Tracking
          </h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} leftIcon={<RefreshCw className="w-4 h-4" />}>
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Hours</p>
          <p className="text-2xl font-bold mt-1">{totalHours}h</p>
          <p className="text-xs text-muted-foreground mt-0.5">{entries.length} entries</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Billable</p>
          <p className="text-2xl font-bold mt-1 text-green-600">{billableHours}h</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Non-Billable</p>
          <p className="text-2xl font-bold mt-1 text-muted-foreground">
            {((totalMinutes - billableMinutes) / 60).toFixed(1)}h
          </p>
        </Card>
      </div>

      {/* Timer */}
      <Card className="p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${timerRunning ? 'bg-red-100 dark:bg-red-900/30' : 'bg-muted'}`}>
              <Timer className={`w-6 h-6 ${timerRunning ? 'text-red-500' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <p className={`text-3xl font-mono font-bold ${timerRunning ? 'text-foreground' : 'text-muted-foreground'}`}>
                {formatDuration(timerSeconds)}
              </p>
              {timerRunning && <p className="text-xs text-muted-foreground">{timerDesc || 'Running…'}</p>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!timerRunning ? (
              <>
                <input
                  type="text"
                  value={timerDesc}
                  onChange={e => setTimerDesc(e.target.value)}
                  placeholder="What are you working on?"
                  className="px-3 py-2 rounded-lg border border-border bg-background text-sm w-52"
                  onKeyDown={e => e.key === 'Enter' && setTimerRunning(true)}
                />
                <Button onClick={() => setTimerRunning(true)} leftIcon={<Play className="w-4 h-4" />}>
                  Start
                </Button>
              </>
            ) : (
              <Button variant="destructive" onClick={stopTimer} leftIcon={<Square className="w-4 h-4" />}>
                Stop & Save
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Manual entry */}
      {showManual ? (
        <Card className="p-5">
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <input
                type="text"
                value={manualForm.description}
                onChange={e => setManualForm({ ...manualForm, description: e.target.value })}
                placeholder="What did you work on?"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Hours</label>
                <input
                  type="number" min="0" max="24"
                  value={manualForm.hours}
                  onChange={e => setManualForm({ ...manualForm, hours: e.target.value })}
                  className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Minutes</label>
                <input
                  type="number" min="0" max="59"
                  value={manualForm.minutes}
                  onChange={e => setManualForm({ ...manualForm, minutes: e.target.value })}
                  className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualForm.billable}
                    onChange={e => setManualForm({ ...manualForm, billable: e.target.checked })}
                    className="rounded"
                  />
                  Billable
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={createMutation.isPending}>Add Entry</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowManual(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      ) : (
        <button
          onClick={() => setShowManual(true)}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <Plus className="w-4 h-4" /> Add manual entry
        </button>
      )}

      {/* Entries list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : entries.length === 0 ? (
        <Card className="p-12 text-center">
          <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">No time entries yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Start the timer or add a manual entry.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-sm text-foreground">Time Entries</h2>
          </div>
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Duration</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Date</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map(entry => (
                <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3 text-sm text-foreground">{entry.description || '—'}</td>
                  <td className="px-5 py-3 text-sm font-medium text-foreground tabular-nums">
                    {durationToHours(entry.duration)}h
                  </td>
                  <td className="px-5 py-3 text-sm text-muted-foreground hidden sm:table-cell">
                    {fmtDate(entry.createdAt)}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium ${
                      entry.billable
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {entry.billable ? <><DollarSign className="w-2.5 h-2.5" /> Billable</> : 'Non-Billable'}
                    </span>
                  </td>
                  <td className="px-2 py-3">
                    <button
                      onClick={() => {
                        if (confirm('Delete this time entry?')) deleteMutation.mutate(entry.id);
                      }}
                      className="p-1 text-muted-foreground hover:text-red-500 rounded transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
