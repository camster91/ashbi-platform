import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, Check, CheckCheck, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { invalidateNotifications, PAGE_NOTIFICATIONS_LIMIT, pageNotificationsKey } from '../lib/notificationKeys';
import { EmptyState, ListPageSkeleton } from '../components/ui';
import QueryErrorState from '../components/QueryErrorState';
import { getNotificationLink } from '../components/NotificationsDropdown';

export default function Notifications() {
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: pageNotificationsKey,
    queryFn: () => api.getNotifications({ limit: PAGE_NOTIFICATIONS_LIMIT }).then((r) => r?.notifications ?? []),
  });

  const markReadMutation = useMutation({
    mutationFn: (id) => api.markNotificationRead(id),
    // Refresh the page list, the header dropdown and the unread badge.
    onSuccess: () => invalidateNotifications(queryClient),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    // Refresh the page list, the header dropdown and the unread badge.
    onSuccess: () => invalidateNotifications(queryClient),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Bell className="w-6 h-6 text-primary" />
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Stay up to date with what's happening</p>
        </div>
        {notifications.length > 0 && (
          <button
            type="button"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            className="min-h-11 min-w-11 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CheckCheck className="w-4 h-4" />
            Mark all read
          </button>
        )}
      </div>

      {markAllReadMutation.isError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          Notifications were not marked as read. Nothing was changed; try again when you are ready.
        </p>
      )}

      {markReadMutation.isError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          That notification could not be marked as read. It remains unread; try again when you are ready.
        </p>
      )}

      {isLoading ? (
        <ListPageSkeleton rows={5} label="Loading notifications" />
      ) : isError ? (
        <QueryErrorState
          error={error}
          message="Notifications could not be loaded"
          onRetry={refetch}
          isRetrying={isFetching}
        />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon="notifications"
          title="No notifications"
          description="You're all caught up. New activity will appear here."
        />
      ) : (
        <div className="space-y-2">
          {notifications.map(notification => {
            const link = getNotificationLink(notification);
            const body = notification.message || notification.content;
            const title = notification.title || body;
            const details = (
              <>
                <p className={`text-sm ${notification.read ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>
                  {title}
                </p>
                {notification.title && body && body !== notification.title && (
                  <p className="text-sm text-muted-foreground mt-0.5">{body}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(notification.createdAt).toLocaleString()}
                </p>
              </>
            );
            return (
              <div
                key={notification.id}
                className={`rounded-lg border transition-colors ${
                  notification.read
                    ? 'bg-card border-border'
                    : 'bg-primary/5 border-primary/20'
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  {link ? (
                    // Opening a notification also marks it read, matching the
                    // header dropdown.
                    <Link
                      to={link}
                      onClick={() => { if (!notification.read) markReadMutation.mutate(notification.id); }}
                      className="group flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-lg p-4 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1">{details}</span>
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                    </Link>
                  ) : (
                    <div className="min-w-0 flex-1 p-4">{details}</div>
                  )}
                  {!notification.read && (
                    <button
                      type="button"
                      onClick={() => markReadMutation.mutate(notification.id)}
                      disabled={markReadMutation.isPending}
                      aria-label="Mark notification as read"
                      className="m-2 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors shrink-0 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="Mark as read"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
