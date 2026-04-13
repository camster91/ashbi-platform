import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { api } from '../lib/api';
import { formatRelativeTime, cn } from '../lib/utils';
import useSocket from '../hooks/useSocket';
import { useToast } from '../hooks/useToast';

const TYPE_ROUTES = {
  'project.update': (data) => data?.projectId ? `/project/${data.projectId}` : '/projects',
  'project.health': (data) => data?.projectId ? `/project/${data.projectId}` : '/projects',
  'PROJECT_HEALTH_CHANGED': (data) => data?.projectId ? `/project/${data.projectId}` : '/projects',
  'invoice.created': () => '/invoices',
  'invoice.overdue': () => '/invoices',
  'APPROVAL_NEEDED': (data) => data?.approvalId ? `/approvals/${data.approvalId}` : '/approvals',
  'THREAD_ASSIGNED': (data) => data?.threadId ? `/thread/${data.threadId}` : '/inbox',
  'CLIENT_REPLIED': (data) => data?.threadId ? `/thread/${data.threadId}` : '/inbox',
  'RESPONSE_APPROVED': (data) => data?.threadId ? `/thread/${data.threadId}` : '/inbox',
  'RESPONSE_REJECTED': (data) => data?.threadId ? `/thread/${data.threadId}` : '/inbox',
  'TASK_COMMENT': (data) => data?.taskId ? `/task/${data.taskId}` : null,
  'MENTION': (data) => data?.projectId ? `/project/${data.projectId}` : null,
  'SLA_WARNING': () => '/inbox',
  'SLA_BREACH': () => '/inbox',
  'ESCALATION': () => '/inbox',
};

const TYPE_BADGES = {
  'APPROVAL_NEEDED': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'THREAD_ASSIGNED': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'CLIENT_REPLIED': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'RESPONSE_APPROVED': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'RESPONSE_REJECTED': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'PROJECT_HEALTH_CHANGED': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  'project.update': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  'invoice.created': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'invoice.overdue': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'SLA_WARNING': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'SLA_BREACH': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'ESCALATION': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

function getNotificationLink(notification) {
  const resolver = TYPE_ROUTES[notification.type];
  if (resolver) return resolver(notification.data);
  return null;
}

function formatTypeBadge(type) {
  if (!type) return '';
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace('project.update', 'Project').replace('invoice.created', 'Invoice').replace('invoice.overdue', 'Overdue');
}

export default function NotificationsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const toast = useToast();
  const navigate = useNavigate();

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.getNotifications({ limit: 10 }),
    refetchInterval: 30000,
  });

  const { data: unreadCount } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: api.getUnreadCount,
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id) => api.markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  // Real-time Socket.IO notifications
  useEffect(() => {
    if (!socket) return;

    const handleNewNotification = (data) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });

      // Show toast
      if (data?.title || data?.message) {
        toast.info(data.title || 'New notification', data.message, 5000);
      }
    };

    socket.on('notification:new', handleNewNotification);
    socket.on('notification', handleNewNotification);

    return () => {
      socket.off('notification:new', handleNewNotification);
      socket.off('notification', handleNewNotification);
    };
  }, [socket, queryClient, toast]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = useCallback((notification) => {
    if (!notification.read) {
      markReadMutation.mutate(notification.id);
    }
    const link = getNotificationLink(notification);
    if (link) {
      navigate(link);
    }
    setIsOpen(false);
  }, [markReadMutation, navigate]);

  const count = unreadCount?.count ?? 0;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold bg-[#e6f354] text-[#2e2958] rounded-full">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-card border border-border shadow-xl rounded-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            {notifications?.length > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="flex items-center gap-1 text-xs font-medium text-[#2e2958] hover:text-[#e6f354] dark:text-foreground dark:hover:text-[#e6f354] transition-colors disabled:opacity-50"
                title="Mark all as read"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Mark all read</span>
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications?.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No notifications
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {notifications?.map((notification) => {
                  const badgeStyle = TYPE_BADGES[notification.type] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';

                  return (
                    <li key={notification.id}>
                      <button
                        onClick={() => handleNotificationClick(notification)}
                        className={cn(
                          'w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer',
                          !notification.read && 'bg-[#e6f354]/5'
                        )}
                      >
                        {/* Unread dot */}
                        <div className="flex-shrink-0 mt-1.5">
                          {!notification.read ? (
                            <span className="block w-2 h-2 rounded-full bg-[#e6f354]" />
                          ) : (
                            <span className="block w-2 h-2 rounded-full bg-transparent" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className={cn(
                              'text-sm truncate',
                              !notification.read ? 'font-semibold text-foreground' : 'text-foreground'
                            )}>
                              {notification.title}
                            </p>
                            {notification.type && (
                              <span className={cn('flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded', badgeStyle)}>
                                {formatTypeBadge(notification.type)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {notification.message}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1">
                            {formatRelativeTime(notification.createdAt)}
                          </p>
                        </div>

                        {/* Mark read button */}
                        {!notification.read && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              markReadMutation.mutate(notification.id);
                            }}
                            className="flex-shrink-0 p-1 text-muted-foreground hover:text-[#2e2958] dark:hover:text-[#e6f354] rounded transition-colors mt-0.5"
                            title="Mark as read"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-border">
            <Link
              to="/notifications"
              onClick={() => setIsOpen(false)}
              className="block text-center text-xs font-medium text-[#2e2958] hover:text-[#e6f354] dark:text-foreground dark:hover:text-[#e6f354] transition-colors"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}