import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import LoadingState from '../components/ui/LoadingState';
import QueryErrorState from '../components/QueryErrorState';
import { formatDate } from '../lib/format';
import { DEFAULT_TASK_PRIORITY, TASK_PRIORITY_LABELS } from '@shared/task-priority.js';

// Core columns are always shown. Other stored task statuses (the task status
// vocabulary is not yet unified, #405) get their own column when any task has
// them, so no task ever disappears from the board.
const CORE_STATUSES = ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED'];
const STATUS_META = {
  PENDING: { label: 'To Do', headerColor: 'text-muted-foreground border-muted-foreground/30' },
  TODO: { label: 'To Do (legacy)', headerColor: 'text-muted-foreground border-muted-foreground/30' },
  UPCOMING: { label: 'Upcoming', headerColor: 'text-muted-foreground border-muted-foreground/30' },
  IMMEDIATE: { label: 'Immediate', headerColor: 'text-orange-800 dark:text-orange-300 border-orange-400' },
  IN_PROGRESS: { label: 'In Progress', headerColor: 'text-blue-700 dark:text-blue-300 border-blue-400' },
  WAITING_US: { label: 'Waiting on us', headerColor: 'text-purple-700 dark:text-purple-300 border-purple-400' },
  WAITING_CLIENT: { label: 'Waiting on client', headerColor: 'text-purple-700 dark:text-purple-300 border-purple-400' },
  REVIEW: { label: 'In Review', headerColor: 'text-sky-800 dark:text-sky-300 border-sky-400' },
  BLOCKED: { label: 'Blocked', headerColor: 'text-yellow-800 dark:text-yellow-300 border-yellow-400' },
  COMPLETED: { label: 'Done', headerColor: 'text-green-800 dark:text-green-300 border-green-400' },
};
const STATUS_ORDER = ['PENDING', 'TODO', 'UPCOMING', 'IMMEDIATE', 'IN_PROGRESS', 'WAITING_US', 'WAITING_CLIENT', 'REVIEW', 'BLOCKED', 'COMPLETED'];

function titleCase(status) {
  return String(status).toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function buildKanbanColumns(board = {}) {
  const present = Object.keys(board).filter((key) => Array.isArray(board[key]) && board[key].length > 0);
  const keys = [...new Set([...CORE_STATUSES, ...present])].sort((a, b) => {
    const ia = STATUS_ORDER.indexOf(a);
    const ib = STATUS_ORDER.indexOf(b);
    return (ia === -1 ? STATUS_ORDER.length : ia) - (ib === -1 ? STATUS_ORDER.length : ib);
  });
  return keys.map((key) => ({
    key,
    label: STATUS_META[key]?.label || titleCase(key),
    headerColor: STATUS_META[key]?.headerColor || 'text-muted-foreground border-border',
    tasks: Array.isArray(board[key]) ? board[key] : [],
  }));
}

// Keyed by the shared API priority list (src/shared/task-priority.js).
const PRIORITY_COLORS = {
  LOW: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  NORMAL: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  HIGH: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  CRITICAL: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function TaskKanban() {
  const { projectId } = useParams();
  const queryClient = useQueryClient();
  const [draggedTask, setDraggedTask] = useState(null);
  const [moveError, setMoveError] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showNewTask, setShowNewTask] = useState(null);

  const { data: board = {}, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ['kanban', projectId],
    queryFn: () => api.getKanbanBoard(projectId),
  });

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
  });

  const columns = buildKanbanColumns(board);

  const moveMutation = useMutation({
    mutationFn: ({ taskId, status }) => api.moveTask(taskId, status),
    onSuccess: () => {
      setMoveError(null);
      queryClient.invalidateQueries({ queryKey: ['kanban', projectId] });
    },
    onError: (_, variables) => setMoveError(variables),
  });

  const createMutation = useMutation({
    mutationFn: ({ title, status }) => api.createQuickTask(projectId, { title, status, priority: DEFAULT_TASK_PRIORITY }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban', projectId] });
      setNewTaskTitle('');
      setShowNewTask(null);
      setCreateError(null);
    },
    onError: (_, variables) => setCreateError(variables),
  });

  const [announcement, setAnnouncement] = useState('');
  // A keyboard move re-renders the card in another column (a new element), so
  // remember which card to give focus back to once the board has refetched.
  const refocusTaskIdRef = useRef(null);
  const refocusStatusRef = useRef(null);
  useEffect(() => {
    const taskId = refocusTaskIdRef.current;
    if (!taskId) return;
    const card = document.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`);
    if (card && card.dataset.status === refocusStatusRef.current) {
      refocusTaskIdRef.current = null;
      card.focus();
    }
  }, [board]);

  const moveTaskTo = (task, fromStatus, toStatus) => {
    if (!toStatus || fromStatus === toStatus) return;
    setMoveError(null);
    const label = columns.find((c) => c.key === toStatus)?.label || titleCase(toStatus);
    moveMutation.mutate(
      { taskId: task.id, status: toStatus },
      {
        onSuccess: () => {
          refocusTaskIdRef.current = task.id;
          refocusStatusRef.current = toStatus;
          setAnnouncement(`Moved "${task.title}" to ${label}.`);
        },
        onError: () => setAnnouncement(`Could not move "${task.title}".`),
      },
    );
  };

  // Left/Right move to the neighbouring column. Below the lg breakpoint the
  // columns are stacked, so Up/Down move to the previous/next column too.
  const handleCardKeyDown = (event, task, columnIndex) => {
    if (event.target !== event.currentTarget) return;
    const stacked = typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 1024px)').matches;
    const step = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ...(stacked ? { ArrowUp: -1, ArrowDown: 1 } : {}),
    }[event.key];
    if (!step) return;
    event.preventDefault();
    const target = columns[columnIndex + step];
    if (target) moveTaskTo(task, columns[columnIndex].key, target.key);
  };

  const handleDrop = (toStatus) => {
    if (draggedTask && draggedTask.fromStatus !== toStatus) {
      setMoveError(null);
      moveMutation.mutate({ taskId: draggedTask.id, status: toStatus });
    }
    setDraggedTask(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingState label="Loading task board…" compact />
      </div>
    );
  }

  if (error) {
    return (
      <QueryErrorState
        error={error}
        onRetry={refetch}
        isRetrying={isFetching}
        message="Task board could not be loaded"
      />
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
      {moveError && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><span>Task move was not saved. Try again.</span><button type="button" onClick={() => moveMutation.mutate(moveError)} disabled={moveMutation.isPending} className="underline">Try again</button></div>}

      <p className="sr-only" aria-live="polite" role="status">{announcement}</p>
      <p id="kanban-keyboard-help" className="sr-only">
        To move a focused task card, press the left or right arrow key for the previous or next column. On narrow screens, where columns are stacked, the up and down arrow keys also move it to the previous or next column. You can also use the card's Move to menu.
      </p>

      <div className="flex flex-col gap-4 lg:flex-row lg:overflow-x-auto lg:pb-2 min-w-0 [contain:inline-size]" role="region" aria-label="Task board">
        {columns.map(({ key, label, headerColor, tasks }, columnIndex) => {
          return (
            <section
              key={key}
              aria-labelledby={`kanban-col-${key}`}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(key)}
              className="bg-muted/30 rounded-xl border border-border flex flex-col lg:min-h-[420px] lg:w-72 lg:flex-shrink-0"
            >
              {/* Column header */}
              <div className={`px-4 py-3 border-b-2 ${headerColor} flex items-center justify-between`}>
                <h2 id={`kanban-col-${key}`} className={`font-semibold text-sm ${headerColor.split(' ').filter((c) => c.startsWith('text-') || c.startsWith('dark:text-')).join(' ')}`}>{label}</h2>
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full" aria-label={`${tasks.length} tasks`}>
                  {tasks.length}
                </span>
              </div>

              {/* Tasks */}
              <ul className="flex-1 p-3 space-y-2 overflow-y-auto" aria-labelledby={`kanban-col-${key}`}>
                {tasks.map(task => (
                  <li
                    key={task.id}
                    draggable
                    tabIndex={0}
                    data-task-id={task.id}
                    data-status={key}
                    aria-describedby={`kanban-task-${task.id}-status kanban-keyboard-help`}
                    onKeyDown={(e) => handleCardKeyDown(e, task, columnIndex)}
                    onDragStart={() => setDraggedTask({ ...task, fromStatus: key })}
                    className="relative bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary/40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span id={`kanban-task-${task.id}-status`} className="sr-only">In column {label}.</span>
                    <Link to={`/task/${task.id}`} className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <p className="text-sm font-medium text-foreground leading-snug break-words">{task.title}</p>
                    </Link>
                    <div className="mt-2 flex items-center justify-between flex-wrap gap-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[DEFAULT_TASK_PRIORITY]}`}>
                        {TASK_PRIORITY_LABELS[task.priority] || task.priority}
                      </span>
                      {task.assignee && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          {task.assignee.name?.split(' ')[0]}
                        </span>
                      )}
                    </div>
                    {task.dueDate && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Due {formatDate(task.dueDate)}
                      </p>
                    )}
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Move to</span>
                      <select
                        value={key}
                        onChange={(e) => moveTaskTo(task, key, e.target.value)}
                        aria-label={`Move "${task.title}" to column`}
                        className="min-h-8 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {columns.map((col) => (
                          <option key={col.key} value={col.key}>{col.label}</option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>

              {/* Add task */}
              {showNewTask === key ? (
                <div className="p-3 border-t border-border space-y-2">
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={e => { setNewTaskTitle(e.target.value); setCreateError(null); }}
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
                  {createError && createError.status === key && <div role="alert" className="flex items-center justify-between gap-2 text-xs text-red-600"><span>Task was not created. Try again.</span><button type="button" onClick={() => createMutation.mutate(createError)} disabled={createMutation.isPending} className="underline">Try again</button></div>}
                </div>
              ) : (
                <button
                  onClick={() => setShowNewTask(key)}
                  className="mx-3 mb-3 py-2 text-center text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition text-sm flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add task
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
