import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { api } from '../lib/api';
import { EmptyState, LoadingState } from '../components/ui';
import QueryErrorState from '../components/QueryErrorState';

export default function Notifications() {
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.getNotifications().then((r) => r?.notifications ?? []),
  });

  const markReadMutation = useMutation({
    mutationFn: (id) => api.markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Bell className="w-6 h-6 text-primary" />
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Stay up to date with what's happening</p>
        </div>
        {notifications.length > 0 && (
          <button
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            className="min-h-11 flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
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
        <div className="flex justify-center py-12">
          <LoadingState label="Loading notifications…" compact />
        </div>
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
          {notifications.map(notification => (
            <div
              key={notification.id}
              className={`p-4 rounded-lg border transition-colors ${
                notification.read
                  ? 'bg-card border-border'
                  : 'bg-primary/5 border-primary/20'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${notification.read ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>
                    {notification.message || notification.content}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(notification.createdAt).toLocaleString()}
                  </p>
                </div>
                {!notification.read && (
                  <button
                    onClick={() => markReadMutation.mutate(notification.id)}
                    disabled={markReadMutation.isPending}
                    aria-label="Mark notification as read"
                    className="min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Mark as read"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
