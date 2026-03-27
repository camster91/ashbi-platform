import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

export default function TimeTracking() {
  const { projectId } = useParams();
  const [timeEntries, setTimeEntries] = useState([]);
  const [activeTimer, setActiveTimer] = useState(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [formData, setFormData] = useState({
    taskId: '',
    description: '',
    hours: 0,
    minutes: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [totals, setTotals] = useState({ billed: 0, nonBilled: 0 });

  useEffect(() => {
    fetchTimeEntries();
  }, [projectId]);

  // Timer interval
  useEffect(() => {
    let interval;
    if (activeTimer) {
      interval = setInterval(() => {
        setTimerSeconds(s => s + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeTimer]);

  const fetchTimeEntries = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/time?projectId=${projectId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!res.ok) throw new Error('Failed to load time entries');
      const data = await res.json();
      setTimeEntries(data);
      
      // Calculate totals
      const billed = data.filter(e => e.billable).reduce((sum, e) => sum + (e.hours || 0), 0);
      const nonBilled = data.filter(e => !e.billable).reduce((sum, e) => sum + (e.hours || 0), 0);
      setTotals({ billed, nonBilled });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const startTimer = (description = '') => {
    setActiveTimer({ description });
    setTimerSeconds(0);
  };

  const stopTimer = async () => {
    if (!activeTimer) return;

    const hours = Math.floor(timerSeconds / 3600);
    const minutes = Math.floor((timerSeconds % 3600) / 60);

    try {
      const res = await fetch('/api/time', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          projectId,
          taskId: formData.taskId || null,
          description: activeTimer.description,
          hours,
          minutes,
          billable: true
        })
      });

      if (!res.ok) throw new Error('Failed to save time entry');
      
      setActiveTimer(null);
      setTimerSeconds(0);
      await fetchTimeEntries();
    } catch (err) {
      setError(err.message);
    }
  };

  const addTimeEntry = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/time', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          projectId,
          taskId: formData.taskId || null,
          description: formData.description,
          hours: formData.hours,
          minutes: formData.minutes,
          billable: true
        })
      });

      if (!res.ok) throw new Error('Failed to add time entry');
      
      setFormData({ taskId: '', description: '', hours: 0, minutes: 0 });
      setShowNewEntry(false);
      await fetchTimeEntries();
    } catch (err) {
      setError(err.message);
    }
  };

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return <div className="p-12 text-center">Loading time entries...</div>;
  }

  return (
    <div className="p-6 bg-[#f8f4ef] min-h-screen">
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-600">
          {error}
        </div>
      )}

      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-[#1a2744] mb-6">Time Tracking</h1>

        {/* Timer Card */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 mb-2">Current Timer</p>
              <p className="text-4xl font-bold font-mono text-[#c9a84c]">{formatTime(timerSeconds)}</p>
            </div>

            {!activeTimer ? (
              <button
                onClick={() => startTimer('Quick entry')}
                className="px-6 py-3 bg-[#c9a84c] text-white rounded-lg hover:bg-[#b89840] font-semibold"
              >
                ▶ Start Timer
              </button>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={stopTimer}
                  className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 font-semibold w-full"
                >
                  ⏹ Stop & Save
                </button>
                <button
                  onClick={() => { setActiveTimer(null); setTimerSeconds(0); }}
                  className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 w-full"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-gray-600 text-sm">Billable Hours</p>
            <p className="text-3xl font-bold text-[#1a2744]">{totals.billed.toFixed(1)}h</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-gray-600 text-sm">Non-Billable Hours</p>
            <p className="text-3xl font-bold text-[#1a2744]">{totals.nonBilled.toFixed(1)}h</p>
          </div>
        </div>

        {/* Add Manual Entry */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <button
            onClick={() => setShowNewEntry(!showNewEntry)}
            className="text-[#c9a84c] hover:text-[#b89840] font-semibold mb-4"
          >
            {showNewEntry ? '✕ Cancel' : '+ Add Manual Entry'}
          </button>

          {showNewEntry && (
            <form onSubmit={addTimeEntry} className="space-y-4 border-t pt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="What did you work on?"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#c9a84c] outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Hours
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    value={formData.hours}
                    onChange={(e) => setFormData({ ...formData, hours: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#c9a84c] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Minutes
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={formData.minutes}
                    onChange={(e) => setFormData({ ...formData, minutes: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#c9a84c] outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full px-4 py-2 bg-[#c9a84c] text-white rounded-lg hover:bg-[#b89840] font-semibold"
              >
                Add Entry
              </button>
            </form>
          )}
        </div>

        {/* Time Entries List */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Description</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Time</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Date</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {timeEntries.length === 0 ? (
                <tr>
                  <td colSpan="4" className="px-6 py-8 text-center text-gray-500">
                    No time entries yet. Start tracking!
                  </td>
                </tr>
              ) : (
                timeEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-sm text-gray-700">{entry.description}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-700">
                      {entry.hours}h {entry.minutes}m
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        entry.billable 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {entry.billable ? 'Billable' : 'Non-Billable'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
