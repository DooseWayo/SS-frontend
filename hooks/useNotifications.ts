"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type NotificationItem,
} from "@/lib/api";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;
export const UNREAD_COUNT_QUERY_KEY = ["notifications", "unread-count"] as const;

/**
 * Nudges the cached unread count by `delta` without a round trip, clamped at
 * zero. Accepts either cached shape (`{count}` or a bare number) so it works
 * regardless of which shape populated the cache.
 *
 * A no-op when nothing has been cached yet — inventing a count out of nothing
 * would be a lie, and the invalidate that follows fetches the real one.
 *
 * Returns the previous value so callers can roll back, or `undefined` when
 * there was nothing cached.
 */
export function bumpUnreadCount(
  queryClient: QueryClient,
  delta: number
): { count: number } | number | undefined {
  const previous = queryClient.getQueryData<{ count: number } | number>(
    UNREAD_COUNT_QUERY_KEY
  );
  if (previous === undefined) return undefined;

  queryClient.setQueryData(UNREAD_COUNT_QUERY_KEY, (old: unknown) => {
    if (typeof old === "number") return Math.max(0, old + delta);
    if (old && typeof old === "object" && "count" in old) {
      const record = old as { count: number };
      return { ...record, count: Math.max(0, record.count + delta) };
    }
    return old;
  });

  return previous;
}

export function useNotifications(
  options: {
    /** Only fetch while true (e.g. the notification panel is open). */
    enabled?: boolean;
    refetchOnMount?: "always" | boolean;
  } = {}
) {
  const { enabled = true, refetchOnMount } = options;
  return useQuery<NotificationItem[]>({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: fetchNotifications,
    enabled,
    refetchOnMount,
  });
}

export function useUnreadCount() {
  return useQuery<{ count: number }>({
    queryKey: UNREAD_COUNT_QUERY_KEY,
    queryFn: fetchUnreadCount,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => markNotificationAsRead(notificationId),

    onMutate: async (notificationId: string) => {
      // 1. Cancel in-flight notification list and unread count queries
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      await queryClient.cancelQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });

      // 2. Snapshot previous values for rollback
      const previousNotifications = queryClient.getQueryData<NotificationItem[]>(NOTIFICATIONS_QUERY_KEY);
      const previousUnreadCount = queryClient.getQueryData<{ count: number } | number>(UNREAD_COUNT_QUERY_KEY);

      // 3. Optimistically clear unread indicator immediately in notifications list
      if (previousNotifications) {
        queryClient.setQueryData<NotificationItem[]>(NOTIFICATIONS_QUERY_KEY, (old) => {
          if (!old) return [];
          return old.map((item) =>
            item.id === notificationId ? { ...item, read: true, is_read: true } : item
          );
        });
      }

      // 4. Optimistically decrement nav bell unread count
      if (previousUnreadCount !== undefined) {
        queryClient.setQueryData(UNREAD_COUNT_QUERY_KEY, (old: any) => {
          if (typeof old === "number") {
            return Math.max(0, old - 1);
          }
          if (old && typeof old === "object" && "count" in old) {
            return { ...old, count: Math.max(0, old.count - 1) };
          }
          return old;
        });
      }

      return { previousNotifications, previousUnreadCount };
    },

    onError: (_err, _notificationId, context) => {
      // Roll back to unread state if mutation fails
      if (context?.previousNotifications !== undefined) {
        queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previousNotifications);
      }
      if (context?.previousUnreadCount !== undefined) {
        queryClient.setQueryData(UNREAD_COUNT_QUERY_KEY, context.previousUnreadCount);
      }
      toast.error("Failed to mark notification as read");
    },

    onSettled: () => {
      // Invalidate notification list cache & unread count cache after mutation settles
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
    },
  });
}

/**
 * Bulk mark-as-read (issue #283): clears every unread item and the nav badge
 * optimistically, rolling back on API error.
 */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => markAllNotificationsAsRead(),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      await queryClient.cancelQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });

      const previousNotifications = queryClient.getQueryData<NotificationItem[]>(NOTIFICATIONS_QUERY_KEY);
      const previousUnreadCount = queryClient.getQueryData<{ count: number } | number>(UNREAD_COUNT_QUERY_KEY);

      if (previousNotifications) {
        queryClient.setQueryData<NotificationItem[]>(NOTIFICATIONS_QUERY_KEY, (old) => {
          if (!old) return [];
          return old.map((item) => ({ ...item, read: true, is_read: true }));
        });
      }

      if (previousUnreadCount !== undefined) {
        queryClient.setQueryData(UNREAD_COUNT_QUERY_KEY, (old: any) => {
          if (typeof old === "number") return 0;
          if (old && typeof old === "object" && "count" in old) return { ...old, count: 0 };
          return old;
        });
      }

      return { previousNotifications, previousUnreadCount };
    },

    onError: (_err, _vars, context) => {
      if (context?.previousNotifications !== undefined) {
        queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, context.previousNotifications);
      }
      if (context?.previousUnreadCount !== undefined) {
        queryClient.setQueryData(UNREAD_COUNT_QUERY_KEY, context.previousUnreadCount);
      }
      toast.error("Failed to mark all notifications as read");
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
    },
  });
}
