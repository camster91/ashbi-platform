import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

const COLUMNS = [
  { id: 'PENDING', title: 'To Do', color: 'bg-gray-100' },
  { id: 'IN_PROGRESS', title: 'In Progress', color: 'bg-blue-100' },
  { id: 'BLOCKED', title: 'Blocked', color: 'bg-red-100' },
  { id: 'COMPLETED', title: 'Done', color: 'bg-green-100' }
];

const PRIORITY_COLORS = {
  CRITICAL: 'border-l-red-500',
  HIGH: 'border-l-orange-500',
  NORMAL: 'border-l-blue-500',
  LOW: 'border-l-gray-400'
};

export default function KanbanBoard({ projectId }) {
  const queryClient = useQueryClient();
  const [draggedTask, setDraggedTask] = useState(null);

  // Fetch tasks for project
  const { data, isLoading } = useQuery({
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
      queryClient.invalidateQueries(['project-tasks', projectId]);
    }
  });

  // Group tasks by status
  const tasksByStatus = COLUMNS.reduce((acc, col) => {
    acc[col.id] = tasks.filter(t => t.status === col.id);
    return acc;
  }, {});

  // Drag handlers
  const handleDragStart = (e, task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, newStatus) => {
    e.preventDefault();
    if (draggedTask && draggedTask.status !== newStatus) {
      updateMutation.mutate({
        id: draggedTask.id,
        data: { status: newStatus }
      });
    }
    setDraggedTask(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {COLUMNS.map((column) => (
        <div
          key={column.id}
          className={`flex-shrink-0 w-72 ${column.color} rounded-lg p-3`}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, column.id)}
        >
          {/* Column Header */}
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">{column.title}</h3>
            <span className="text-sm text-gray-500 bg-white rounded-full px-2 py-0.5">
              {tasksByStatus[column.id].length}
            </span>
          </div>

          {/* Tasks */}
          <div className="space-y-2 min-h-[200px]">
            {tasksByStatus[column.id].map((task) => (
              <div
                key={task.id}
                draggable
                onDragStart={(e) => handleDragStart(e, task)}
                onDragEnd={handleDragEnd}
                className={`bg-white rounded-lg p-3 shadow-sm border-l-4 ${PRIORITY_COLORS[task.priority]} cursor-move hover:shadow-md transition-shadow ${
                  draggedTask?.id === task.id ? 'opacity-50' : ''
                }`}
              >
                <h4 className="font-medium text-gray-900 text-sm">{task.title}</h4>
                {task.description && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                )}
                <div className="flex items-center justify-between mt-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    task.priority === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                    task.priority === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                    task.priority === 'NORMAL' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {task.priority}
                  </span>
                  {task.assignee && (
                    <span className="text-xs text-gray-500">{task.assignee.name}</span>
                  )}
                </div>
                {task.dueDate && (
                  <div className="mt-2 text-xs text-gray-400">
                    Due: {new Date(task.dueDate).toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}
            {tasksByStatus[column.id].length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">
                No tasks
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
