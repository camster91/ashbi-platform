import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { api } from '../lib/api';
import {
  DROPDOWN_NOTIFICATIONS_LIMIT,
  dropdownNotificationsKey,
  invalidateNotifications,
  unreadNotificationsKey,
} from '../lib/notificationKeys';
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
  'TASK_BLOCKED': (data) => data?.taskId ? `/task/${data.taskId}` : null,
  'MENTION': (data) => data?.reviewSessionId ? `/review/${data.reviewSessionId}` : data?.taskId ? `/task/${data.taskId}` : data?.projectId ? `/project/${data.projectId}` : null,
  'REVIEW_COMMENT': (data) => data?.reviewSessionId ? `/review/${data.reviewSessionId}` : null,
  'REVIEW_DECISION': (data) => data?.reviewSessionId ? `/review/${data.reviewSessionId}` : null,
  'RESPONSE_PENDING': (data) => data?.threadId ? `/thread/${data.threadId}` : '/inbox',
  'EVENT_INVITE': () => '/schedule',
  'EVENT_RSVP': () => '/schedule',
  'CLIENT_ONBOARDED': (data) => data?.clientId ? `/client/${data.clientId}` : '/clients',
  'SLA_WARNING': () => '/inbox',
  'SLA_BREACH': () => '/inbox',
  'ESCALATION': () => '/inbox',
};

const TYPE_BADGES = {
  'APPROVAL_NEEDED': 'bg-warning/10 text-warning',
  'THREAD_ASSIGNED': 'bg-info/10 text-info',
  'CLIENT_REPLIED': 'bg-success/10 text-success',
  'RESPONSE_APPROVED': 'bg-success/10 text-success',
  'RESPONSE_REJECTED': 'bg-destructive/10 text-destructive',
  'PROJECT_HEALTH_CHANGED': 'bg-primary/10 text-primary',
  'project.update': 'bg-primary/10 text-primary',
  'invoice.created': 'bg-success/10 text-success',
  'invoice.overdue': 'bg-destructive/10 text-destructive',
  'SLA_WARNING': 'bg-warning/10 text-warning',
  'SLA_BREACH': 'bg-destructive/10 text-destructive',
  'ESCALATION': 'bg-destructive/10 text-destructive',
};

// Rows written before the single notify() path stored `data` as a JSON
// string; newer rows store an object.
function notificationData(data) {
  if (typeof data !== 'string') return data;
  try { return JSON.parse(data); } catch { return null; }
}

export function getNotificationLink(notification) {
  const resolver = TYPE_ROUTES[notification.type];
  if (resolver) return resolver(notificationData(notification.data));
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

  const { data: notifications, isError: notificationsFailed, refetch: refetchNotifications } = useQuery({
    queryKey: dropdownNotificationsKey,
    queryFn: () => api.getNotifications({ limit: DROPDOWN_NOTIFICATIONS_LIMIT }).then((r) => r?.notifications ?? []),
    refetchInterval: 30000,
  });

  const { data: unreadCount } = useQuery({
    queryKey: unreadNotificationsKey,
    queryFn: api.getUnreadCount,
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id) => api.markNotificationRead(id),
    onSuccess: () => {
      invalidateNotifications(queryClient);
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => {
      invalidateNotifications(queryClient);
    },
  });

  // Real-time Socket.IO notifications
  useEffect(() => {
    if (!socket) return;

    const handleNewNotification = (data) => {
      invalidateNotifications(queryClient);

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
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative min-h-11 min-w-11 p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold bg-brand-lime text-brand-indigo rounded-full">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-card dark:bg-card border border-border shadow-xl rounded-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            {notifications?.length > 0 && (
              <button
                type="button"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="min-h-11 min-w-11 flex items-center justify-center gap-1 text-xs font-medium text-brand-indigo hover:text-brand-lime dark:text-foreground dark:hover:text-brand-lime transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Mark all as read"
                title="Mark all as read"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Mark all read</span>
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {notificationsFailed && !notifications ? (
              <div role="alert" className="p-6 text-center text-sm text-muted-foreground">
                Notifications could not be loaded.{' '}
                <button type="button" onClick={() => refetchNotifications()} className="underline text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                  Try again
                </button>
              </div>
            ) : notifications?.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No notifications
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {notifications?.map((notification) => {
                  const badgeStyle = TYPE_BADGES[notification.type] || 'bg-muted text-muted-foreground';

                  return (
                    <li key={notification.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleNotificationClick(notification)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleNotificationClick(notification);
                          }
                        }}
                        className={cn(
                          'w-full min-h-11 text-left flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                          !notification.read && 'bg-brand-lime/5'
                        )}
                      >
                        {/* Unread dot */}
                        <div className="flex-shrink-0 mt-1.5">
                          {!notification.read ? (
                            <span className="block w-2 h-2 rounded-full bg-brand-lime" />
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
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              markReadMutation.mutate(notification.id);
                            }}
                            className="flex-shrink-0 min-h-11 min-w-11 p-1 text-muted-foreground hover:text-brand-indigo dark:hover:text-brand-lime rounded transition-colors mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Mark as read"
                            title="Mark as read"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-1 border-t border-border">
            <Link
              to="/notifications"
              onClick={() => setIsOpen(false)}
              className="flex min-h-11 items-center justify-center rounded-lg text-center text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-brand-indigo hover:text-brand-lime dark:text-foreground dark:hover:text-brand-lime transition-colors"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
