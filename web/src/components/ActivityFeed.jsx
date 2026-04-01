import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

const ACTIVITY_ICONS = {
  TASK_CREATED: '📝',
  TASK_COMPLETED: '✅',
  TASK_COMMENTED: '💬',
  CHAT_MESSAGE: '💭',
  NOTE_CREATED: '📄',
  NOTE_UPDATED: '📝',
  MILESTONE_CREATED: '🎯',
  MILESTONE_COMPLETED: '🏆',
  TIME_LOGGED: '⏱️',
  FILE_UPLOADED: '📎',
  EVENT_CREATED: '📅',
  PROJECT_CREATED: '📁',
  THREAD_ASSIGNED: '👤'
};

const ACTIVITY_COLORS = {
  created: 'text-green-600 bg-green-100',
  completed: 'text-blue-600 bg-blue-100',
  updated: 'text-yellow-600 bg-yellow-100',
  deleted: 'text-red-600 bg-red-100',
  commented: 'text-purple-600 bg-purple-100',
  uploaded: 'text-indigo-600 bg-indigo-100'
};

export default function ActivityFeed({ projectId, limit = 20, showProject = false }) {
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['activity', projectId, limit],
    queryFn: () => projectId
      ? api.getProjectActivity(projectId, { limit })
      : api.getActivity({ limit }),
    refetchInterval: 30000
  });

  // Format relative time
  const formatTime = (date) => {
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  };

  // Generate activity message
  const getActivityMessage = (activity) => {
    const { type, action, entityName, entityType } = activity;
    const userName = activity.user?.name || 'Someone';

    switch (type) {
      case 'TASK_CREATED':
        return `${userName} created task "${entityName}"`;
      case 'TASK_COMPLETED':
        return `${userName} completed task "${entityName}"`;
      case 'TASK_COMMENTED':
        return `${userName} commented on "${entityName}"`;
      case 'CHAT_MESSAGE':
        return `${userName} sent a message`;
      case 'NOTE_CREATED':
        return `${userName} created note "${entityName}"`;
      case 'NOTE_UPDATED':
        return `${userName} updated note "${entityName}"`;
      case 'MILESTONE_CREATED':
        return `${userName} created milestone "${entityName}"`;
      case 'MILESTONE_COMPLETED':
        return `${userName} completed milestone "${entityName}"`;
      case 'TIME_LOGGED':
        return `${userName} logged ${entityName}`;
      case 'FILE_UPLOADED':
        return `${userName} uploaded "${entityName}"`;
      case 'EVENT_CREATED':
        return `${userName} scheduled "${entityName}"`;
      default:
        return `${userName} ${action} ${entityType.toLowerCase()}`;
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
            <div className="flex-1">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-3 bg-gray-100 rounded w-1/4 mt-1"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No activity yet
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {activities.map((activity) => (
        <div key={activity.id} className="flex items-start gap-3">
          {/* Icon */}
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${ACTIVITY_COLORS[activity.action] || 'text-gray-600 bg-gray-100'}`}>
            {ACTIVITY_ICONS[activity.type] || '📌'}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900">
              {getActivityMessage(activity)}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-500">
                {formatTime(activity.createdAt)}
              </span>
              {showProject && activity.project && (
                <span className="text-xs text-blue-600">
                  {activity.project.name}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
