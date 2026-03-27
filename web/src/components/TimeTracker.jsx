import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export default function TimeTracker({ projectId, taskId }) {
  const queryClient = useQueryClient();
  const [isTracking, setIsTracking] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [showForm, setShowForm] = useState(false);

  // Timer logic
  const [timerInterval, setTimerInterval] = useState(null);

  const startTimer = () => {
    setIsTracking(true);
    setStartTime(new Date());
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    setTimerInterval(interval);
  };

  const stopTimer = () => {
    setIsTracking(false);
    clearInterval(timerInterval);
    const duration = Math.ceil(elapsed / 60); // Convert to minutes
    setElapsed(0);
    setShowForm(true);
    return duration;
  };

  // Create entry mutation
  const createMutation = useMutation({
    mutationFn: api.createTimeEntry,
    onSuccess: () => {
      queryClient.invalidateQueries(['time-entries']);
      setShowForm(false);
    }
  });

  // Format elapsed time
  const formatElapsed = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Format duration for display
  const formatDuration = (minutes) => {
    if (minutes < 60) return `${minutes}m`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  };

  return (
    <div className="bg-white rounded-lg border p-4">
      {/* Timer Display */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-medium text-gray-900">Time Tracker</h3>
          <p className="text-3xl font-mono text-gray-700 mt-2">
            {formatElapsed(elapsed)}
          </p>
        </div>
        <div className="flex gap-2">
          {!isTracking ? (
            <button
              onClick={startTimer}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              Start
            </button>
          ) : (
            <button
              onClick={stopTimer}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
              </svg>
              Stop
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200"
          >
            + Manual Entry
          </button>
        </div>
      </div>

      {/* Manual Entry Form */}
      {showForm && (
        <TimeEntryForm
          projectId={projectId}
          taskId={taskId}
          initialDuration={elapsed > 0 ? Math.ceil(elapsed / 60) : ''}
          onSubmit={(data) => createMutation.mutate(data)}
          onCancel={() => setShowForm(false)}
          isLoading={createMutation.isPending}
        />
      )}

      {/* Recent Entries */}
      <RecentTimeEntries projectId={projectId} />
    </div>
  );
}

function TimeEntryForm({ projectId, taskId, initialDuration, onSubmit, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    projectId,
    taskId: taskId || '',
    duration: initialDuration || '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    billable: true
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      duration: parseInt(formData.duration),
      taskId: formData.taskId || null
    });
  };

  return (
    <form onSubmit={handleSubmit} className="border-t pt-4 mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Duration (minutes)
          </label>
          <input
            type="number"
            value={formData.duration}
            onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
            min="1"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Description
        </label>
        <input
          type="text"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="w-full border rounded-lg px-3 py-2"
          placeholder="What did you work on?"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="billable"
          checked={formData.billable}
          onChange={(e) => setFormData({ ...formData, billable: e.target.checked })}
        />
        <label htmlFor="billable" className="text-sm text-gray-700">Billable</label>
      </div>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? 'Saving...' : 'Save Entry'}
        </button>
      </div>
    </form>
  );
}

function RecentTimeEntries({ projectId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['time-entries', projectId],
    queryFn: () => api.getTimeEntries(projectId, { limit: 5 })
  });

  const formatDuration = (minutes) => {
    if (minutes < 60) return `${minutes}m`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  };

  if (isLoading || !data?.entries?.length) return null;

  return (
    <div className="border-t pt-4 mt-4">
      <h4 className="text-sm font-medium text-gray-700 mb-3">Recent Entries</h4>
      <div className="space-y-2">
        {data.entries.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between text-sm">
            <div>
              <span className="text-gray-900">{entry.description || 'No description'}</span>
              {entry.task && (
                <span className="text-gray-500 ml-2">on {entry.task.title}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500">
                {new Date(entry.date).toLocaleDateString()}
              </span>
              <span className={`font-medium ${entry.billable ? 'text-green-600' : 'text-gray-600'}`}>
                {formatDuration(entry.duration)}
              </span>
            </div>
          </div>
        ))}
      </div>
      {data.totals && (
        <div className="mt-3 pt-3 border-t flex justify-between text-sm">
          <span className="text-gray-500">Total</span>
          <span className="font-semibold text-gray-900">
            {formatDuration(data.totals.totalMinutes)}
          </span>
        </div>
      )}
    </div>
  );
}
