import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  getMyNotifications,
  getMyUnreadNotificationCount,
  clearMyNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type NotificationRecord,
} from '../lib/notifications';
import { useAuth } from './AuthContext';

interface NotificationContextValue {
  notifications: NotificationRecord[];
  unreadCount: number;
  loading: boolean;
  error?: string;
  refreshNotifications: () => Promise<void>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const refreshNotifications = useCallback(async () => {
    if (!user || !isSupabaseConfigured || !supabase) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const [nextNotifications, nextUnreadCount] = await Promise.all([
        getMyNotifications(user.id),
        getMyUnreadNotificationCount(user.id),
      ]);
      setNotifications(nextNotifications);
      setUnreadCount(nextUnreadCount);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured || !supabase) return;
    const client = supabase;
    const channel = client
      .channel(`artguard-notifications-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, () => {
        void refreshNotifications();
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [refreshNotifications, user]);

  const markAsRead = useCallback(async (notificationId: string) => {
    if (!user) return;
    await markNotificationAsRead(notificationId, user.id);
    setNotifications((current) => current.map((notification) => notification.id === notificationId ? { ...notification, is_read: true } : notification));
    setUnreadCount((current) => Math.max(0, current - (notifications.find((notification) => notification.id === notificationId)?.is_read ? 0 : 1)));
  }, [notifications, user]);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    await markAllNotificationsAsRead(user.id);
    setNotifications((current) => current.map((notification) => ({ ...notification, is_read: true })));
    setUnreadCount(0);
  }, [user]);

  const clearNotifications = useCallback(async () => {
    if (!user) return;
    await clearMyNotifications();
    setNotifications([]);
    setUnreadCount(0);
  }, [user]);

  const value = useMemo(() => ({ notifications, unreadCount, loading, error, refreshNotifications, markAsRead, markAllAsRead, clearNotifications }), [clearNotifications, error, loading, markAllAsRead, markAsRead, notifications, refreshNotifications, unreadCount]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
}
