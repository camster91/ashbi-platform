import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { api } from '../lib/api';
import { formatRelativeTime, cn } from '../lib/utils';
import useSocket from '../hooks/useSocket';

export default function NotificationsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.getNotifications(),
    refetchInterval: 30000,
  });

  const { data: unreadCount } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: async () => {
      const res = await fetch('/api/notifications/unread-count', {
        credentials: 'include',
      });
      return res.json();
    },
    refetchInterval: 15000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id) => api.markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications']);
      queryClient.invalidateQueries(['notifications-unread']);
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications']);
      queryClient.invalidateQueries(['notifications-unread']);
    },
  });

  // Real-time WebSocket notifications
  useEffect(() => {
    if (!socket) return;

    const handleNewNotification = () => {
      // Refetch notifications and unread count immediately
      queryClient.invalidateQueries(['notifications']);
      queryClient.invalidateQueries(['notifications-unread']);
    };

    socket.on('notification', handleNewNotification);
    socket.on('notification:new', handleNewNotification);

    return () => {
      socket.off('notification', handleNewNotification);
      socket.off('notification:new', handleNewNotification);
    };
  }, [socket, queryClient]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getNotificationLink = (notification) => {
    const data = notification.data;

    switch (notification.type) {
      case 'APPROVAL_NEEDED':
        return data?.approvalId ? `/approvals/${data.approvalId}` : '/approvals';
      case 'THREAD_ASSIGNED':
      case 'CLIENT_REPLIED':
      case 'RESPONSE_APPROVED':
      case 'RESPONSE_REJECTED':
        return data?.threadId ? `/thread/${data.threadId}` : null;
      case 'PROJECT_HEALTH_CHANGED':
        return data?.projectId ? `/project/${data.projectId}` : null;
      case 'TASK_COMMENT':
        return data?.taskId ? `/task/${data.taskId}` : null;
      case 'MENTION':
        return data?.projectId ? `/project/${data.projectId}` : null;
      default:
        return null;
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'APPROVAL_NEEDED':
        return '🔐';
      case 'THREAD_ASSIGNED':
        return '📥';
      case 'RESPONSE_APPROVED':
        return '✅';
      case 'RESPONSE_REJECTED':
        return '❌';
      case 'CLIENT_REPLIED':
        return '💬';
      case 'PROJECT_HEALTH_CHANGED':
        return '📊';
      case 'SLA_WARNING':
        return '⚠️';
      case 'SLA_BREACH':
        return '🚨';
      case 'ESCALATION':
        return '🔺';
      case 'TASK_COMMENT':
        return '💬';
      case 'MENTION':
        return '📣';
      default:
        return '🔔';
    }
  };

  const handleNotificationClick = (notification) => {
    // Mark as read on click
    if (!notification.read) {
      markReadMutation.mutate(notification.id);
    }
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
      >
        <Bell className="w-5 h-5" />
        {unreadCount?.count > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-xs font-medium text-white bg-red-500 rounded-full animate-pulse">
            {unreadCount.count > 9 ? '9+' : unreadCount.count}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="font-semibold">Notifications</h3>
            {notifications?.length > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                className="text-sm text-primary hover:text-primary/80 flex items-center gap-1"
                title="Mark all as read"
              >
                <CheckCheck className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications?.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                No notifications
              </div>
            ) : (
              <ul className="divide-y">
                {notifications?.map((notification) => {
                  const link = getNotificationLink(notification);
                  const content = (
                    <div
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer',
                        !notification.read && 'bg-blue-50/50 border-l-2 border-l-blue-500'
                      )}
                    >
                      <span className="text-lg flex-shrink-0">
                        {getNotificationIcon(notification.type)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'text-sm text-gray-900',
                          !notification.read && 'font-semibold'
                        )}>
                          {notification.title}
                        </p>
                        <p className="text-sm text-gray-500 truncate">
                          {notification.message}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatRelativeTime(notification.createdAt)}
                        </p>
                      </div>
                      {!notification.read && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            markReadMutation.mutate(notification.id);
                          }}
                          className="p-1 text-gray-400 hover:text-blue-600 rounded flex-shrink-0"
                          title="Mark as read"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );

                  return (
                    <li key={notification.id} onClick={() => handleNotificationClick(notification)}>
                      {link ? (
                        <Link to={link}>
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {notifications?.length > 0 && (
            <div className="px-4 py-2 border-t text-center">
              <Link
                to="/notifications"
                onClick={() => setIsOpen(false)}
                className="text-sm text-primary hover:text-primary/80"
              >
                View all notifications
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
