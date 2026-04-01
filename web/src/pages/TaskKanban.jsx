import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

const STATUS_COLUMNS = [
  { key: 'NOT_STARTED', label: '📋 To Do', color: 'gray' },
  { key: 'IN_PROGRESS', label: '⚙️ In Progress', color: 'blue' },
  { key: 'IN_REVIEW', label: '👀 In Review', color: 'yellow' },
  { key: 'DONE', label: '✓ Done', color: 'green' }
];

const PRIORITY_COLORS = {
  LOW: 'bg-green-100 text-green-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  HIGH: 'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-700'
};

export default function TaskKanban() {
  const { projectId } = useParams();
  const [board, setBoard] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draggedTask, setDraggedTask] = useState(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showNewTask, setShowNewTask] = useState(null);

  useEffect(() => {
    fetchBoard();
  }, [projectId]);

  const fetchBoard = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/tasks/kanban/${projectId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!res.ok) throw new Error('Failed to load board');
      const data = await res.json();
      setBoard(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const moveTask = async (taskId, newStatus) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (!res.ok) throw new Error('Failed to move task');
      
      // Optimistic update
      await fetchBoard();
    } catch (err) {
      setError(err.message);
    }
  };

  const createTask = async (status) => {
    if (!newTaskTitle.trim()) return;

    try {
      const res = await fetch(`/api/tasks/${projectId}/quick`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          title: newTaskTitle,
          priority: 'MEDIUM'
        })
      });

      if (!res.ok) throw new Error('Failed to create task');
      
      setNewTaskTitle('');
      setShowNewTask(null);
      await fetchBoard();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDragStart = (task, status) => {
    setDraggedTask({ ...task, fromStatus: status });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (status) => {
    if (draggedTask && draggedTask.fromStatus !== status) {
      moveTask(draggedTask.id, status);
    }
    setDraggedTask(null);
  };

  if (loading) {
    return <div className="p-12 text-center">Loading board...</div>;
  }

  return (
    <div className="p-6 bg-[#f8f4ef] min-h-screen">
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-600">
          {error}
        </div>
      )}

      <h1 className="text-3xl font-bold text-[#1a2744] mb-6">Project Tasks</h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {STATUS_COLUMNS.map(({ key, label, color }) => (
          <div
            key={key}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(key)}
            className="bg-white rounded-lg shadow p-4 min-h-[600px] flex flex-col"
          >
            {/* Column Header */}
            <div className="mb-4 pb-4 border-b">
              <h2 className={`text-lg font-semibold text-${color}-700`}>{label}</h2>
              <p className="text-sm text-gray-500">
                {board[key]?.length || 0} tasks
              </p>
            </div>

            {/* Tasks */}
            <div className="flex-1 space-y-3">
              {board[key]?.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={() => handleDragStart(task, key)}
                  className="bg-gray-50 border-2 border-gray-200 rounded-lg p-3 cursor-move hover:shadow-md transition hover:border-[#c9a84c]"
                >
                  <p className="font-semibold text-[#1a2744] text-sm">{task.title}</p>
                  
                  <div className="mt-2 flex justify-between items-center">
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${PRIORITY_COLORS[task.priority]}`}>
                      {task.priority}
                    </span>
                    {task.assignee && (
                      <span className="text-xs bg-[#c9a84c] text-white px-2 py-1 rounded">
                        {task.assignee.name?.split(' ')[0]}
                      </span>
                    )}
                  </div>

                  {task.dueDate && (
                    <p className="text-xs text-gray-500 mt-2">
                      Due: {new Date(task.dueDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Add Task Button */}
            <button
              onClick={() => setShowNewTask(key)}
              className="mt-4 w-full py-2 text-center text-gray-600 hover:bg-gray-100 rounded-lg transition font-medium text-sm"
            >
              + Add Task
            </button>

            {/* Quick Create */}
            {showNewTask === key && (
              <div className="mt-4 p-3 bg-gray-50 border-2 border-[#c9a84c] rounded-lg">
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Task title..."
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[#c9a84c]"
                  onKeyPress={(e) => e.key === 'Enter' && createTask(key)}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => createTask(key)}
                    className="flex-1 px-2 py-1 bg-[#c9a84c] text-white text-sm rounded hover:bg-[#b89840]"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => { setShowNewTask(null); setNewTaskTitle(''); }}
                    className="flex-1 px-2 py-1 bg-gray-300 text-gray-700 text-sm rounded hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
