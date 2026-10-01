// React Query keys for notifications. The header dropdown and the full page
// fetch different amounts (10 vs 50), so each list has its own key; sharing
// one key let whichever loaded first fill the other (the page showed only 10).
// Both list keys sit under NOTIFICATIONS_ROOT_KEY, so invalidating the root
// refreshes every list.

export const NOTIFICATIONS_ROOT_KEY = ['notifications'];
export const DROPDOWN_NOTIFICATIONS_LIMIT = 10;
export const PAGE_NOTIFICATIONS_LIMIT = 50;

export const dropdownNotificationsKey = ['notifications', 'dropdown', DROPDOWN_NOTIFICATIONS_LIMIT];
export const pageNotificationsKey = ['notifications', 'page', PAGE_NOTIFICATIONS_LIMIT];
export const unreadNotificationsKey = ['notifications-unread'];

/** Refresh every notification list and the unread badge. */
export function invalidateNotifications(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_ROOT_KEY }),
    queryClient.invalidateQueries({ queryKey: unreadNotificationsKey }),
  ]);
}
