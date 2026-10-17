import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import type { NotificationRecord } from '../lib/notifications';
import './NotificationsPage.css';

function formatNotificationDate(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function notificationIcon(type: string): 'bell' | 'chat' | 'shield' | 'alert' {
  if (type === 'message') return 'chat';
  if (type === 'verification' || type === 'security') return 'shield';
  if (type === 'account') return 'alert';
  return 'bell';
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { notifications, unreadCount, loading, error, markAsRead, markAllAsRead, clearNotifications, refreshNotifications } = useNotifications();
  const [actionError, setActionError] = useState<string | undefined>();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  if (!user) return <Navigate to="/login" replace />;

  const handleMarkAsRead = async (notification: NotificationRecord) => {
    if (notification.is_read || markingId) return;
    setMarkingId(notification.id);
    setActionError(undefined);
    try {
      await markAsRead(notification.id);
    } catch (markError) {
      setActionError(markError instanceof Error ? markError.message : 'Could not mark notification as read.');
    } finally {
      setMarkingId(null);
    }
  };

  const handleOpenNotification = async (notification: NotificationRecord) => {
    if (!notification.related_route || markingId) return;
    setActionError(undefined);
    if (!notification.is_read) {
      setMarkingId(notification.id);
      try {
        await markAsRead(notification.id);
      } catch (markError) {
        setActionError(markError instanceof Error ? markError.message : 'Could not mark notification as read.');
        setMarkingId(null);
        return;
      }
      setMarkingId(null);
    }
    navigate(notification.related_route);
  };

  const handleMarkAllAsRead = async () => {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    setActionError(undefined);
    try {
      await markAllAsRead();
    } catch (markError) {
      setActionError(markError instanceof Error ? markError.message : 'Could not mark notifications as read.');
    } finally {
      setMarkingAll(false);
    }
  };

  const handleClearNotifications = async () => {
    if (clearing || notifications.length === 0) return;
    setClearing(true);
    setActionError(undefined);
    try {
      await clearNotifications();
      setClearDialogOpen(false);
    } catch (clearError) {
      setActionError(clearError instanceof Error ? clearError.message : 'Could not clear notifications.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between">
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate('/home')} ariaLabel="Back to Home" />
            <span className="h-title" style={{ fontSize: 19 }}>Notifications</span>
          </div>
          <button type="button" className="link-sm" onClick={() => void handleMarkAllAsRead()} disabled={markingAll || unreadCount === 0}>
            {markingAll ? 'Updating…' : 'Mark all as read'}
          </button>
        </div>
      }
    >
      <main className="notifications-page">
        {!loading && !error && notifications.length > 0 && (
          <div className="notifications-toolbar">
            <button type="button" className="link-sm c-danger" onClick={() => setClearDialogOpen(true)} disabled={clearing}>
              Clear Notifications
            </button>
          </div>
        )}
        {loading && <div className="card t-sm c-mid" role="status">Loading notifications…</div>}
        {!loading && error && (
          <div className="card t-sm protection-artwork-error" role="alert">
            <div>{error}</div>
            <button type="button" className="link-sm" onClick={() => void refreshNotifications()}>Try again</button>
          </div>
        )}
        {!loading && !error && actionError && <div className="card t-xs protection-artwork-error" role="alert">{actionError}</div>}
        {!loading && !error && notifications.length === 0 && (
          <div className="card notifications-empty" role="status">
            <Icon name="bell" style={{ stroke: 'var(--ag-text-low)' }} />
            <div className="t-sm fw-700">No notifications yet</div>
            <div className="t-xs c-low">Important activity from across ArtGuard Hub will appear here.</div>
          </div>
        )}
        {!loading && !error && notifications.map((notification) => (
          <article className={`card notification-card ag-liquid-glass-soft${notification.is_read ? '' : ' is-unread'}`} key={notification.id}>
            <div className="notification-icon" aria-hidden="true">
              {notification.notification_type.startsWith('artwork_') && notification.actor_avatar_data_url ? (
                <img src={notification.actor_avatar_data_url} alt="" />
              ) : (
                <Icon name={notificationIcon(notification.notification_type)} />
              )}
            </div>
            <div className="notification-content">
              <div className="row-between gap-10">
                <div className="t-sm fw-700 notification-heading">
                  {notification.actor_name && notification.notification_type.startsWith('artwork_')
                    ? `${notification.actor_name} · ${notification.title}`
                    : notification.title}
                </div>
                {!notification.is_read && <span className="notification-unread-label">Unread</span>}
              </div>
              <div className="t-sm c-mid notification-message">{notification.message}</div>
              <div className="t-xs c-low">{formatNotificationDate(notification.created_at)}</div>
              <div className="notification-actions">
                {notification.related_route && (
                  <button
                    type="button"
                    className="link-sm"
                    onClick={() => void handleOpenNotification(notification)}
                    disabled={markingId === notification.id}
                  >
                    {markingId === notification.id ? 'Opening…' : 'Open'}
                  </button>
                )}
                {!notification.is_read && (
                  <button type="button" className="link-sm" onClick={() => void handleMarkAsRead(notification)} disabled={markingId === notification.id}>
                    {markingId === notification.id ? 'Updating…' : 'Mark as read'}
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </main>
      {clearDialogOpen && (
        <div className="notification-dialog-backdrop" role="presentation" onClick={() => !clearing && setClearDialogOpen(false)}>
          <section className="notification-dialog ag-liquid-glass-strong" role="dialog" aria-modal="true" aria-labelledby="clear-notifications-title" onClick={(event) => event.stopPropagation()}>
            <div className="notification-dialog-icon"><Icon name="alert" /></div>
            <h2 id="clear-notifications-title">Clear all notifications?</h2>
            <p>This cannot be undone.</p>
            <div className="notification-dialog-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClearDialogOpen(false)} disabled={clearing}>
                Keep Notifications
              </button>
              <button type="button" className="btn btn-secondary btn-sm notification-dialog-danger" onClick={() => void handleClearNotifications()} disabled={clearing}>
                {clearing ? 'Clearing…' : 'Clear Notifications'}
              </button>
            </div>
          </section>
        </div>
      )}
    </ScreenShell>
  );
}
