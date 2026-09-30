import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import LoadingState from './ui/LoadingState';
import { QueryErrorState } from './QueryErrorState';

const COLUMNS = [
  { id: 'PENDING', title: 'To Do', color: 'bg-muted', description: 'Tasks waiting to be started' },
  { id: 'IN_PROGRESS', title: 'In Progress', color: 'bg-info/10', description: 'Tasks currently being worked on' },
  { id: 'BLOCKED', title: 'Blocked', color: 'bg-destructive/10', description: 'Tasks blocked by dependencies or issues' },
  { id: 'COMPLETED', title: 'Done', color: 'bg-success/10', description: 'Completed tasks' }
];

const PRIORITY_COLORS = {
  CRITICAL: 'border-l-destructive',
  HIGH: 'border-l-warning',
  NORMAL: 'border-l-info',
  LOW: 'border-l-border'
};

// Context Menu Component for Mobile Move functionality
function MoveToMenu({ task, columns, onMove, onClose, position }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-card rounded-lg shadow-xl border border-border/40 py-2 min-w-[150px]"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label={`Move "${task.title}" to column`}
    >
      <div className="px-3 py-2 text-sm font-semibold text-foreground border-b border-border/25">
        Move to:
      </div>
      {columns.map((col) => (
        <button
          key={col.id}
          onClick={() => {
            onMove(task, col.id);
            onClose();
          }}
          disabled={task.status === col.id}
          className={`w-full text-left px-3 py-2 text-sm hover:bg-info/5 transition-colors ${
            task.status === col.id ? 'text-muted-foreground cursor-not-allowed' : 'text-foreground'
          }`}
          role="menuitem"
          aria-label={`Move "${task.title}" to ${col.title}${task.status === col.id ? ' (current column)' : ''}`}
        >
          {col.title}
          {task.status === col.id && ' (current)'}
        </button>
      ))}
    </div>
  );
}

export default function KanbanBoard({ projectId }) {
  const queryClient = useQueryClient();
  const [draggedTask, setDraggedTask] = useState(null);
  const [focusedTaskId, setFocusedTaskId] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const taskRefs = useRef({});

  // Fetch tasks for project
  const { data, isLoading, isError, error: tasksError, refetch, isFetching } = useQuery({
    queryKey: ['project-tasks', projectId],
    queryFn: () => api.getTasks({ projectId })
  });

  const tasks = data?.tasks || [];

  // Update task mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateTask(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries(['project-tasks', projectId]);
      const previous = queryClient.getQueryData(['project-tasks', projectId]);

      queryClient.setQueryData(['project-tasks', projectId], (old) => ({
        ...old,
        tasks: old.tasks.map(t => t.id === id ? { ...t, ...data } : t)
      }));

      return { previous };
    },
    onError: (err, vars, context) => {
      queryClient.setQueryData(['project-tasks', projectId], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['project-tasks', projectId] });
    }
  });

  // Group tasks by status
  const tasksByStatus = COLUMNS.reduce((acc, col) => {
    acc[col.id] = tasks.filter(t => t.status === col.id);
    return acc;
  }, {});

  // Move task to new status
  const moveTask = (task, newStatus) => {
    if (task.status !== newStatus) {
      updateMutation.mutate({
        id: task.id,
        data: { status: newStatus }
      });
    }
  };

  // Drag handlers
  const handleDragStart = (e, task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, newStatus) => {
    e.preventDefault();
    if (draggedTask && draggedTask.status !== newStatus) {
      moveTask(draggedTask, newStatus);
    }
    setDraggedTask(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
  };

  // Keyboard navigation handlers
  const handleTaskKeyDown = (e, task) => {
    const currentStatus = task.status;
    const currentIndex = tasksByStatus[currentStatus].findIndex(t => t.id === task.id);
    const currentColumnIndex = COLUMNS.findIndex(c => c.id === currentStatus);

    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (selectedTaskId === task.id) {
          setSelectedTaskId(null);
        } else {
          setSelectedTaskId(task.id);
          setFocusedTaskId(task.id);
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (currentIndex > 0) {
          const prevTask = tasksByStatus[currentStatus][currentIndex - 1];
          setFocusedTaskId(prevTask.id);
          taskRefs.current[prevTask.id]?.focus();
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (currentIndex < tasksByStatus[currentStatus].length - 1) {
          const nextTask = tasksByStatus[currentStatus][currentIndex + 1];
          setFocusedTaskId(nextTask.id);
          taskRefs.current[nextTask.id]?.focus();
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        if (currentColumnIndex > 0) {
          const prevColumn = COLUMNS[currentColumnIndex - 1];
          const targetTasks = tasksByStatus[prevColumn.id];
          const targetTask = targetTasks[Math.min(currentIndex, targetTasks.length - 1)] || targetTasks[0];
          if (targetTask) {
            setFocusedTaskId(targetTask.id);
            taskRefs.current[targetTask.id]?.focus();
          }
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (currentColumnIndex < COLUMNS.length - 1) {
          const nextColumn = COLUMNS[currentColumnIndex + 1];
          const targetTasks = tasksByStatus[nextColumn.id];
          const targetTask = targetTasks[Math.min(currentIndex, targetTasks.length - 1)] || targetTasks[0];
          if (targetTask) {
            setFocusedTaskId(targetTask.id);
            taskRefs.current[targetTask.id]?.focus();
          }
        }
        break;

      case 'Escape':
        setSelectedTaskId(null);
        setContextMenu(null);
        break;

      case 'm':
      case 'M':
        // Open move menu for mobile/keyboard users
        e.preventDefault();
        if (selectedTaskId === task.id) {
          const rect = taskRefs.current[task.id]?.getBoundingClientRect();
          setContextMenu({
            task,
            position: { x: rect?.left || 0, y: (rect?.bottom || 0) + 5 }
          });
        }
        break;

      default:
        break;
    }
  };

  // Handle moving selected task via keyboard shortcuts
  useEffect(() => {
    if (!selectedTaskId) return;

    const handleGlobalKeyDown = (e) => {
      const task = tasks.find(t => t.id === selectedTaskId);
      if (!task) return;

      const currentColumnIndex = COLUMNS.findIndex(c => c.id === task.status);

      // Number keys 1-4 to move to specific columns
      if (e.key >= '1' && e.key <= '4') {
        const colIndex = parseInt(e.key) - 1;
        if (colIndex !== currentColumnIndex && COLUMNS[colIndex]) {
          moveTask(task, COLUMNS[colIndex].id);
          setSelectedTaskId(null);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [selectedTaskId, tasks]);

  // Handle context menu for mobile (long press)
  const handleContextMenu = (e, task) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({
      task,
      position: {
        x: Math.min(rect.left, window.innerWidth - 170),
        y: rect.bottom + 5
      }
    });
  };

  // Touch handlers for mobile drag
  const handleTouchStart = (e, task) => {
    const touch = e.touches[0];
    const longPressTimer = setTimeout(() => {
      handleContextMenu(e, task);
    }, 500);

    const handleTouchEnd = () => {
      clearTimeout(longPressTimer);
      document.removeEventListener('touchend', handleTouchEnd);
    };
    document.addEventListener('touchend', handleTouchEnd);
  };

  if (isLoading) {
    return <LoadingState label="Loading tasks…" compact className="h-64" spinnerClassName="border-info/30 border-t-info" />;
  }

  if (isError) {
    return <QueryErrorState error={tasksError} message="Tasks could not be loaded" onRetry={refetch} isRetrying={isFetching} />;
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4" role="region" aria-label="Kanban board task management">
      {COLUMNS.map((column) => (
        <div
          key={column.id}
          className={`flex-shrink-0 w-72 ${column.color} rounded-lg p-3`}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, column.id)}
          role="list"
          aria-label={`${column.title} - ${column.description}. Contains ${tasksByStatus[column.id].length} tasks`}
        >
          {/* Column Header */}
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground" id={`column-header-${column.id}`}>
              {column.title}
            </h3>
            <span className="text-sm text-muted-foreground bg-card rounded-full px-2 py-0.5" aria-label={`${tasksByStatus[column.id].length} tasks`}>
              {tasksByStatus[column.id].length}
            </span>
          </div>

          {/* Tasks */}
          <div className="space-y-2 min-h-[200px]" role="list" aria-labelledby={`column-header-${column.id}`}>
            {tasksByStatus[column.id].map((task) => (
              <div
                key={task.id}
                ref={(el) => taskRefs.current[task.id] = el}
                draggable
                onDragStart={(e) => handleDragStart(e, task)}
                onDragEnd={handleDragEnd}
                onContextMenu={(e) => handleContextMenu(e, task)}
                onTouchStart={(e) => handleTouchStart(e, task)}
                onKeyDown={(e) => handleTaskKeyDown(e, task)}
                tabIndex={0}
                role="listitem"
                aria-grabbed={draggedTask?.id === task.id}
                aria-selected={selectedTaskId === task.id}
                aria-label={`${task.title}. Priority: ${task.priority}. Status: ${column.title}${task.assignee ? `. Assigned to: ${task.assignee.name}` : ''}${task.dueDate ? `. Due: ${new Date(task.dueDate).toLocaleDateString('en-CA')}` : ''}`}
                className={`bg-card rounded-lg p-3 shadow-sm border-l-4 ${PRIORITY_COLORS[task.priority]} transition-all ${
                  draggedTask?.id === task.id ? 'opacity-50 scale-95' : ''
                } ${
                  selectedTaskId === task.id
                    ? 'ring-2 ring-info ring-offset-2'
                    : 'hover:shadow-md'
                }`}
              >
                {/* Drag Handle - Touch-friendly */}
                <div className="flex items-start gap-2">
                  <div
                    className="flex-shrink-0 p-2 -ml-2 -mt-1 cursor-grab active:cursor-grabbing touch-none"
                    aria-hidden="true"
                  >
                    <svg
                      className="w-5 h-5 text-muted-foreground"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 8h16M4 16h16"
                      />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-foreground text-sm">{task.title}</h4>
                    {task.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                    )}
                    <div className="flex items-center justify-between mt-2 flex-wrap gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        task.priority === 'CRITICAL' ? 'bg-destructive/10 text-destructive' :
                        task.priority === 'HIGH' ? 'bg-warning/10 text-warning' :
                        task.priority === 'NORMAL' ? 'bg-info/10 text-info' :
                        'bg-muted text-foreground'
                      }`}>
                        {task.priority}
                      </span>
                      {task.assignee && (
                        <span className="text-xs text-muted-foreground">{task.assignee.name}</span>
                      )}
                    </div>
                    {task.dueDate && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Due: {new Date(task.dueDate).toLocaleDateString('en-CA')}
                      </div>
                    )}
                    {/* Mobile move button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setContextMenu({
                          task,
                          position: {
                            x: Math.min(rect.left, window.innerWidth - 170),
                            y: rect.bottom + 5
                          }
                        });
                      }}
                      className="mt-2 text-xs text-info hover:text-info/80 underline touch-target-py-2"
                      aria-label={`Move ${task.title} to another column`}
                    >
                      Move to...
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {tasksByStatus[column.id].length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm" role="status">
                No tasks
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Context Menu for Move */}
      {contextMenu && (
        <MoveToMenu
          task={contextMenu.task}
          columns={COLUMNS}
          position={contextMenu.position}
          onMove={moveTask}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Keyboard shortcuts help */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {selectedTaskId
          ? `Task selected. Press 1-4 to move to a column, or M to open move menu. Press Escape to deselect.`
          : ''}
      </div>
    </div>
  );
}
