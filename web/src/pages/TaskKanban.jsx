import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';

const STATUS_COLUMNS = [
  { key: 'PENDING', label: 'To Do', headerColor: 'text-muted-foreground border-muted-foreground/30' },
  { key: 'IN_PROGRESS', label: 'In Progress', headerColor: 'text-blue-600 border-blue-400' },
  { key: 'BLOCKED', label: 'Blocked', headerColor: 'text-yellow-600 border-yellow-400' },
  { key: 'COMPLETED', label: 'Done', headerColor: 'text-green-600 border-green-400' },
];

const PRIORITY_COLORS = {
  LOW: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  MEDIUM: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  HIGH: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  URGENT: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function TaskKanban() {
  const { projectId } = useParams();
  const queryClient = useQueryClient();
  const [draggedTask, setDraggedTask] = useState(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showNewTask, setShowNewTask] = useState(null);

  const { data: board = {}, isLoading, error } = useQuery({
    queryKey: ['kanban', projectId],
    queryFn: () => api.getKanbanBoard(projectId),
  });

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
  });

  const moveMutation = useMutation({
    mutationFn: ({ taskId, status }) => api.moveTask(taskId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kanban', projectId] }),
  });

  const createMutation = useMutation({
    mutationFn: ({ title, status }) => api.createQuickTask(projectId, { title, status, priority: 'MEDIUM' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban', projectId] });
      setNewTaskTitle('');
      setShowNewTask(null);
    },
  });

  const handleDrop = (toStatus) => {
    if (draggedTask && draggedTask.fromStatus !== toStatus) {
      moveMutation.mutate({ taskId: draggedTask.id, status: toStatus });
    }
    setDraggedTask(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        {project && (
          <Link to={`/project/${projectId}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="w-3.5 h-3.5" /> {project.name}
          </Link>
        )}
        <h1 className="text-2xl font-heading font-bold text-foreground">Kanban Board</h1>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 text-sm">
          Failed to load board
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 overflow-x-auto">
        {STATUS_COLUMNS.map(({ key, label, headerColor }) => {
          const tasks = board[key] || [];
          return (
            <div
              key={key}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(key)}
              className="bg-muted/30 rounded-xl border border-border flex flex-col min-h-[500px]"
            >
              {/* Column header */}
              <div className={`px-4 py-3 border-b-2 ${headerColor} flex items-center justify-between`}>
                <span className={`font-semibold text-sm ${headerColor.split(' ')[0]}`}>{label}</span>
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {tasks.length}
                </span>
              </div>

              {/* Tasks */}
              <div className="flex-1 p-3 space-y-2 overflow-y-auto">
                {tasks.map(task => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDraggedTask({ ...task, fromStatus: key })}
                    className="bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary/40 transition-all"
                  >
                    <Link to={`/task/${task.id}`} className="block">
                      <p className="text-sm font-medium text-foreground leading-snug">{task.title}</p>
                    </Link>
                    <div className="mt-2 flex items-center justify-between flex-wrap gap-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.MEDIUM}`}>
                        {task.priority}
                      </span>
                      {task.assignee && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          {task.assignee.name?.split(' ')[0]}
                        </span>
                      )}
                    </div>
                    {task.dueDate && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Due {new Date(task.dueDate).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Add task */}
              {showNewTask === key ? (
                <div className="p-3 border-t border-border space-y-2">
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    placeholder="Task title..."
                    className="w-full px-2 py-1.5 border border-border rounded-lg bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    onKeyDown={e => e.key === 'Enter' && createMutation.mutate({ title: newTaskTitle, status: key })}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => createMutation.mutate({ title: newTaskTitle, status: key })}
                      disabled={createMutation.isPending || !newTaskTitle.trim()}
                      className="flex-1 px-2 py-1 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {createMutation.isPending ? 'Creating…' : 'Create'}
                    </button>
                    <button
                      onClick={() => { setShowNewTask(null); setNewTaskTitle(''); }}
                      className="flex-1 px-2 py-1 bg-muted text-muted-foreground text-xs rounded-lg hover:bg-muted/80 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewTask(key)}
                  className="mx-3 mb-3 py-2 text-center text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition text-sm flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add task
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
