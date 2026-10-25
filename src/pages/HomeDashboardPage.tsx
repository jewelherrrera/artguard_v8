import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIonViewDidEnter, useIonViewWillLeave } from '@ionic/react';
import { useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { BottomNav } from '../components/ui/BottomNav';
import { IconButton } from '../components/ui/IconButton';
import { Icon } from '../assets/icons';
import { BrandMark } from '../components/ui/BrandMark';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { initialsFor } from '../lib/supabaseData';
import { acceptCommissionRequest, getCommissionDueAt, listCommissionProgress, listMyCommissions, rejectCommissionRequest, type MyCommission } from '../lib/supabaseRevisions';
import { listMyPaidCommissionPayments, type CommissionPayment } from '../lib/supabasePayments';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useMockToast } from '../components/ui/MockToast';
import { useNotifications } from '../context/NotificationContext';
import type { NotificationRecord } from '../lib/notifications';
import {
  logAuthInteractionDiagnostic,
  recordAuthDiagnosticDestinationReached,
} from '../utils/authInteractionDiagnostics';
import './HomeDashboardPage.css';

function relativeNotificationTime(value: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

const ACTIVE_COMMISSION_STATUSES = new Set(['ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED']);

function commissionSnapshotLabel(commission: MyCommission): string {
  const details = [commission.service_name_snapshot];
  if (commission.amount !== null) {
    const amount = commission.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    details.push(commission.currency ? `${commission.currency} ${amount}` : amount);
  }
  if (commission.turnaround_days_snapshot !== null) {
    details.push(`${commission.turnaround_days_snapshot} day${commission.turnaround_days_snapshot === 1 ? '' : 's'}`);
  }
  return details.filter((detail): detail is string => Boolean(detail)).join(' · ');
}

function paidTotalsByCurrency(payments: CommissionPayment[], now = new Date()): Array<{ currency: string; amount: number; count: number }> {
  const totals = new Map<string, { amount: number; count: number }>();
  for (const payment of payments) {
    const paidAt = payment.paid_at ? new Date(payment.paid_at) : null;
    if (!paidAt || Number.isNaN(paidAt.getTime())
      || paidAt.getFullYear() !== now.getFullYear()
      || paidAt.getMonth() !== now.getMonth()) continue;
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount)) continue;
    const total = totals.get(payment.currency) ?? { amount: 0, count: 0 };
    total.amount += amount;
    total.count += 1;
    totals.set(payment.currency, total);
  }
  return Array.from(totals, ([currency, total]) => ({ currency, ...total }));
}

function paidPaymentHistoryPoints(payments: CommissionPayment[], now = new Date()): string | null {
  const monthlyCounts = Array.from({ length: 6 }, () => 0);
  for (const payment of payments) {
    if (!payment.paid_at) continue;
    const paidAt = new Date(payment.paid_at);
    if (Number.isNaN(paidAt.getTime())) continue;
    const monthsAgo = (now.getFullYear() - paidAt.getFullYear()) * 12 + now.getMonth() - paidAt.getMonth();
    if (monthsAgo >= 0 && monthsAgo < monthlyCounts.length) {
      monthlyCounts[monthlyCounts.length - monthsAgo - 1] += 1;
    }
  }
  if (!monthlyCounts.some((count) => count > 0)) return null;
  const maxCount = Math.max(...monthlyCounts);
  return monthlyCounts.map((count, index) => `${index * 52} ${28 - (count / maxCount) * 20}`).join(' ');
}

function compactCommissionStatusLabel(commission: MyCommission): string {
  switch (commission.status) {
    case 'REQUESTED':
      return 'Waiting for approval';
    case 'ACCEPTED':
      return 'Accepted';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'REVISION_REQUESTED':
      return 'Revision needed';
    default:
      return commission.status.replace('_', ' ');
  }
}

export function HomeDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useMockToast();
  const { notifications, unreadCount, loading: loadingNotifications, error: notificationsError, refreshNotifications, markAsRead } = useNotifications();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationActionError, setNotificationActionError] = useState<string>();
  const notificationAnchorRef = useRef<HTMLDivElement>(null);

  const [myCommissions, setMyCommissions] = useState<MyCommission[]>([]);
  const [commissionTab, setCommissionTab] = useState<'active' | 'pending' | 'completed'>('active');
  const [loadingCommissions, setLoadingCommissions] = useState(true);
  const [commissionLoadError, setCommissionLoadError] = useState<string | null>(null);
  const [commissionActionId, setCommissionActionId] = useState<string | null>(null);
  const [paidCommissionPayments, setPaidCommissionPayments] = useState<CommissionPayment[]>([]);
  const [loadingPaidCommissionPayments, setLoadingPaidCommissionPayments] = useState(true);
  const [paidCommissionPaymentsError, setPaidCommissionPaymentsError] = useState(false);
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);
  const [commissionProgressById, setCommissionProgressById] = useState<Record<string, number>>({});
  const [commissionProgressFailedById, setCommissionProgressFailedById] = useState<Record<string, boolean>>({});
  const dashboardRefreshInProgress = useRef(false);
  const dashboardHasLoadedCommissions = useRef(false);
  const lastCommissionNotificationSignature = useRef<{ userId: string; signature: string } | null>(null);

  useEffect(() => {
    recordAuthDiagnosticDestinationReached('/home');
    logAuthInteractionDiagnostic('home.mounted', { destination: '/home' });
    return () => logAuthInteractionDiagnostic('home.unmounted', { destination: '/home' });
  }, []);

  const pendingCommissions = useMemo(() => myCommissions.filter((commission) => commission.status === 'REQUESTED'
    && (user?.role === 'artist' ? !commission.isClient : commission.isClient)), [myCommissions, user?.role]);
  const activeCommissions = useMemo(() => myCommissions.filter((commission) => ACTIVE_COMMISSION_STATUSES.has(commission.status)), [myCommissions]);
  const completedCommissions = useMemo(() => myCommissions.filter((commission) => commission.status === 'COMPLETED'), [myCommissions]);
  const completedCommissionCount = completedCommissions.length;
  const visibleCommissions = commissionTab === 'active'
    ? activeCommissions
    : commissionTab === 'pending'
      ? (user?.role === 'artist' ? [] : pendingCommissions)
      : completedCommissions;
  const paidCurrencyTotals = useMemo(() => paidTotalsByCurrency(paidCommissionPayments), [paidCommissionPayments]);
  const paidHistoryPoints = useMemo(() => paidPaymentHistoryPoints(paidCommissionPayments), [paidCommissionPayments]);
  const currentMonthPaidCount = paidCurrencyTotals.reduce((count, total) => count + total.count, 0);
  const pendingRequestCount = pendingCommissions.length;
  const recentCommissionActivity = useMemo(() => notifications
    .filter((notification) => notification.notification_type === 'commission' || notification.notification_type === 'revision')
    .slice(0, 5), [notifications]);
  const quickStats: Array<{ key: 'active' | 'pending' | 'completed'; label: string; value: number; tone: 'gold' | 'blue' | 'green' }> = [
    { key: 'active', label: 'Active', value: activeCommissions.length, tone: 'gold' },
    { key: 'pending', label: 'Pending', value: pendingRequestCount, tone: 'blue' },
    { key: 'completed', label: 'Completed', value: completedCommissionCount, tone: 'green' },
  ];
  const commissionSectionRef = useRef<HTMLElement>(null);

  const refreshCommissions = useCallback(async () => {
    if (!user?.id) return;
    try {
      const rows = await listMyCommissions(user.id);
      setMyCommissions(rows);
      setCommissionLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not refresh dashboard commissions.';
      setCommissionLoadError(message);
      throw error;
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      setMyCommissions([]);
      setCommissionLoadError(null);
      setLoadingCommissions(false);
      dashboardHasLoadedCommissions.current = false;
      return;
    }
    let active = true;
    setLoadingCommissions(true);
    setMyCommissions([]);
    setCommissionLoadError(null);
    dashboardHasLoadedCommissions.current = false;
    void refreshCommissions()
      .catch((error: unknown) => {
        console.error('ArtGuard: unable to load dashboard commissions', error);
      })
      .finally(() => {
        if (active) {
          setLoadingCommissions(false);
          dashboardHasLoadedCommissions.current = true;
        }
      });
    return () => {
      active = false;
    };
  }, [refreshCommissions, user]);

  const logHomeViewDidEnter = useCallback(() => {
    logAuthInteractionDiagnostic('home.ionic-view.did-enter', { destination: '/home' });
    if (!isSupabaseConfigured || !user?.id || !dashboardHasLoadedCommissions.current) return;
    void refreshCommissions().catch((error: unknown) => {
      console.error('ArtGuard: unable to refresh commissions when returning to dashboard', error);
    });
    void refreshNotifications().catch((error: unknown) => {
      console.error('ArtGuard: unable to refresh activity when returning to dashboard', error);
    });
  }, [refreshCommissions, refreshNotifications, user?.id]);

  const logHomeViewWillLeave = useCallback(() => {
    logAuthInteractionDiagnostic('home.ionic-view.will-leave', { destination: '/home' });
  }, []);

  useIonViewDidEnter(logHomeViewDidEnter);
  useIonViewWillLeave(logHomeViewWillLeave);

  const commissionNotificationSignature = useMemo(() => notifications
    .filter((notification) => notification.notification_type === 'commission')
    .map((notification) => `${notification.id}:${notification.created_at}`)
    .join('|'), [notifications]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id) {
      lastCommissionNotificationSignature.current = null;
      return;
    }
    const previous = lastCommissionNotificationSignature.current;
    if (!previous || previous.userId !== user.id) {
      lastCommissionNotificationSignature.current = { userId: user.id, signature: commissionNotificationSignature };
      return;
    }
    if (previous.signature === commissionNotificationSignature) return;
    lastCommissionNotificationSignature.current = { userId: user.id, signature: commissionNotificationSignature };
    void refreshCommissions().catch((error: unknown) => {
      console.error('ArtGuard: unable to refresh commissions after commission activity changed', error);
    });
  }, [commissionNotificationSignature, refreshCommissions, user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      setPaidCommissionPayments([]);
      setPaidCommissionPaymentsError(false);
      setLoadingPaidCommissionPayments(false);
      return;
    }
    let active = true;
    setPaidCommissionPayments([]);
    setPaidCommissionPaymentsError(false);
    setLoadingPaidCommissionPayments(true);
    listMyPaidCommissionPayments(user.id, user.role)
      .then((payments) => {
        if (active) setPaidCommissionPayments(payments);
      })
      .catch(() => {
        if (active) {
          setPaidCommissionPayments([]);
          setPaidCommissionPaymentsError(true);
        }
      })
      .finally(() => {
        if (active) setLoadingPaidCommissionPayments(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user || activeCommissions.length === 0) {
      setCommissionProgressById({});
      setCommissionProgressFailedById({});
      return;
    }

    let active = true;
    void Promise.all(activeCommissions.map(async (commission) => {
      try {
        const updates = await listCommissionProgress(commission.id);
        const latest = updates.reduce((max, update) => Math.max(max, Number(update.progress_percent) || 0), 0);
        return [commission.id, latest, false] as const;
      } catch {
        return [commission.id, 0, true] as const;
      }
    })).then((entries) => {
      if (!active) return;
      setCommissionProgressById(Object.fromEntries(entries.filter(([, , failed]) => !failed).map(([id, value]) => [id, value])));
      setCommissionProgressFailedById(Object.fromEntries(entries.filter(([, , failed]) => failed).map(([id]) => [id, true])));
    });

    return () => {
      active = false;
    };
  }, [user?.id, activeCommissions]);

  const refreshDashboard = async () => {
    if (dashboardRefreshInProgress.current || loadingCommissions || loadingPaidCommissionPayments || loadingNotifications) return;
    if (!user || !isSupabaseConfigured) {
      await refreshNotifications();
      return;
    }
    dashboardRefreshInProgress.current = true;
    setRefreshingDashboard(true);
    try {
      const [commissionsResult, paymentsResult] = await Promise.allSettled([
        listMyCommissions(user.id),
        listMyPaidCommissionPayments(user.id, user.role),
      ]);
      if (commissionsResult.status === 'fulfilled') {
        setMyCommissions(commissionsResult.value);
        setCommissionLoadError(null);
      } else {
        setCommissionLoadError(commissionsResult.reason instanceof Error
          ? commissionsResult.reason.message
          : 'Could not refresh dashboard commissions.');
      }
      if (paymentsResult.status === 'fulfilled') {
        setPaidCommissionPayments(paymentsResult.value);
        setPaidCommissionPaymentsError(false);
      } else {
        setPaidCommissionPaymentsError(true);
      }
      await refreshNotifications();
    } finally {
      dashboardRefreshInProgress.current = false;
      setRefreshingDashboard(false);
    }
  };

  const handleAcceptCommission = async (commissionId: string) => {
    if (commissionActionId) return;
    setCommissionActionId(commissionId);
    try {
      await acceptCommissionRequest(commissionId);
      await refreshCommissions();
    } catch (error) {
      console.error('ArtGuard: unable to accept commission request', error);
    } finally {
      setCommissionActionId(null);
    }
  };

  const handleRejectCommission = async (commissionId: string) => {
    if (commissionActionId) return;
    const reason = window.prompt('Reason for rejecting this commission request:')?.trim() ?? '';
    if (!reason) return;
    setCommissionActionId(commissionId);
    try {
      await rejectCommissionRequest(commissionId, reason);
      await refreshCommissions();
    } catch (error) {
      console.error('ArtGuard: unable to reject commission request', error);
    } finally {
      setCommissionActionId(null);
    }
  };

  const firstName = (user?.name || 'Maren').split(' ')[0];

  useEffect(() => {
    if (!notificationsOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!notificationAnchorRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [notificationsOpen]);

  const handleNotificationBell = () => {
    if (window.matchMedia('(min-width: 768px)').matches) setNotificationsOpen((current) => !current);
    else navigate('/notifications');
  };

  const handleNotificationClick = async (notification: NotificationRecord) => {
    setNotificationActionError(undefined);
    if (!notification.is_read) {
      try {
        await markAsRead(notification.id);
      } catch (error) {
        setNotificationActionError(error instanceof Error ? error.message : 'Could not mark notification as read.');
        return;
      }
    }
    setNotificationsOpen(false);
    if (notification.related_route) navigate(notification.related_route);
  };

  return (
    <ScreenShell
      contentClassName="home-dashboard-content"
      loading={loadingCommissions || loadingPaidCommissionPayments || loadingNotifications || refreshingDashboard}
      loadingLabel="Loading dashboard"
      onRefresh={refreshDashboard}
      header={
        <div className="px-hd row-between home-dashboard-header">
          <div className="row gap-10">
            <div className="avatar avatar-md">
              <BrandMark themed={{ light: 'navy', dark: 'yellow' }} className="dash-brand-avatar-logo" />
            </div>
            <div className="home-dashboard-greeting">
              <div className="home-dashboard-greeting-title" style={{ fontFamily: "'P22 Vincent', cursive", fontWeight: 400, fontSize: 19 }}>
                Good evening, {firstName}
              </div>
              <div className="t-xs c-low home-dashboard-greeting-subtitle">Here&apos;s your studio at a glance</div>
            </div>
          </div>
          <div className="home-notification-anchor" ref={notificationAnchorRef}>
            <IconButton
              icon="bell"
              onClick={handleNotificationBell}
              ariaLabel="Notifications"
              badge={unreadCount > 0 ? (unreadCount > 99 ? '99+' : String(unreadCount)) : undefined}
            />
            {notificationsOpen && (
              <div className="notification-preview glass-surface" role="dialog" aria-label="Notification preview">
                <div className="notification-preview-header">
                  <span className="t-sm fw-700">Notifications</span>
                  {unreadCount > 0 && <span className="t-xs c-low">{unreadCount} unread</span>}
                </div>
                <div className="notification-preview-list">
                  {notificationActionError && <div className="notification-preview-empty t-xs c-danger" role="alert">{notificationActionError}</div>}
                  {notifications.length === 0 && <div className="notification-preview-empty t-xs c-low">No notifications yet</div>}
                  {notifications.slice(0, 5).map((notification) => (
                    <button
                      type="button"
                      className={`notification-preview-item${notification.is_read ? '' : ' is-unread'}`}
                      key={notification.id}
                      onClick={() => void handleNotificationClick(notification)}
                    >
                      {notification.notification_type.startsWith('artwork_') && notification.actor_avatar_data_url ? (
                        <img className="notification-preview-avatar" src={notification.actor_avatar_data_url} alt="" />
                      ) : (
                        <Icon name={notification.notification_type === 'message' ? 'chat' : notification.notification_type === 'verification' ? 'shield' : 'bell'} />
                      )}
                      <span className="notification-preview-item-copy">
                        <span className="notification-preview-item-title">
                          {notification.actor_name && notification.notification_type.startsWith('artwork_')
                            ? `${notification.actor_name} · ${notification.title}`
                            : notification.title}
                        </span>
                        <span className="notification-preview-item-message">{notification.message}</span>
                        <span className="notification-preview-item-time">{relativeNotificationTime(notification.created_at)}</span>
                      </span>
                      {!notification.is_read && <span className="notification-preview-unread" aria-label="Unread" />}
                    </button>
                  ))}
                </div>
                <button type="button" className="notification-preview-view-all" onClick={() => { setNotificationsOpen(false); navigate('/notifications'); }}>
                  View all notifications <Icon name="chevron-r" />
                </button>
              </div>
            )}
          </div>
        </div>
      }
      footer={<BottomNav active="home" />}
    >
      <div className="home-dashboard-shell">
        <div className="dashboard-summary-row">
          <div className="home-dashboard-main-column">
          {isSupabaseConfigured ? (
            <button
              type="button"
              className="tap-card card home-revenue-card glass-surface"
              onClick={() => navigate('/home/analytics')}
            >
              <div className="row-between home-revenue-header">
                <span className="t-xs home-revenue-label">
                  {user?.role === 'artist' ? 'Revenue · This month' : 'Spending · This month'}
                </span>
              </div>

              {loadingPaidCommissionPayments ? (
                <div className="t-sm fw-600 home-revenue-loading">Loading...</div>
              ) : paidCommissionPaymentsError ? (
                <div className="t-sm fw-600 home-revenue-loading" role="alert">Could not load payment summary.</div>
              ) : paidCurrencyTotals.length === 0 ? (
                <>
                  <div className="mono home-revenue-amount">—</div>
                  <div className="t-xs home-revenue-subtext">No paid commissions this month</div>
                </>
              ) : paidCurrencyTotals.length === 1 ? (
                <>
                  <div className="mono home-revenue-amount">
                    {paidCurrencyTotals[0].currency} {paidCurrencyTotals[0].amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="t-xs home-revenue-subtext">
                    {paidCurrencyTotals[0].count} paid commission{paidCurrencyTotals[0].count === 1 ? '' : 's'}
                  </div>
                </>
              ) : (
                <>
                  <div className="t-sm fw-700 home-revenue-multi-label">Multiple currencies</div>
                  <div className="home-revenue-multi-list">
                    {paidCurrencyTotals.map((total) => (
                      <div className="row-between t-xs home-revenue-multi-item" key={total.currency}>
                        <span>{total.currency}</span>
                        <span className="mono">{total.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                  <div className="t-xs home-revenue-subtext">
                    {currentMonthPaidCount} paid commission{currentMonthPaidCount === 1 ? '' : 's'} this month
                  </div>
                </>
              )}

              <div className="home-revenue-chart" role="img" aria-label="Paid commission activity over the past six months">
                {paidHistoryPoints ? (
                  <svg viewBox="0 0 260 36" className="home-revenue-graph-svg" aria-hidden="true">
                    <polyline points={paidHistoryPoints} />
                  </svg>
                ) : (
                  <div className="home-revenue-chart-empty">
                    {paidCommissionPayments.length > 0 ? 'Paid history unavailable' : 'No paid history yet'}
                  </div>
                )}
              </div>
            </button>
          ) : (
            <button
              type="button"
              className="tap-card card home-revenue-card glass-surface"
              onClick={() => navigate('/home/analytics')}
            >
              <div className="row-between home-revenue-header">
                <span className="t-xs home-revenue-label">Revenue · This month</span>
              </div>
              <div className="mono home-revenue-amount">
                {user?.role === 'artist' ? 'No revenue history yet' : 'No spending history yet'}
              </div>
              <div className="home-revenue-chart" aria-label="Revenue chart area">
                <div className="home-revenue-chart-empty">No payment history available</div>
              </div>
            </button>
          )}

          <section className="home-commissions-panel" ref={commissionSectionRef}>
            {isSupabaseConfigured && (
              <>
                <div className="row-between home-commissions-heading">
                  <span className="section-title">Your Commissions</span>
                  {user?.role === 'client' && (
                    <button type="button" className="btn btn-primary btn-sm home-start-commission-button" onClick={() => navigate('/commission/start')}>
                      + Start Commission
                    </button>
                  )}
                </div>

                <div className="segmented home-commission-tabs" role="tablist" aria-label="Commission history">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={commissionTab === 'active'}
                    className={`segmented-option${commissionTab === 'active' ? ' active' : ''}`}
                    onClick={() => setCommissionTab('active')}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={commissionTab === 'pending'}
                    className={`segmented-option${commissionTab === 'pending' ? ' active' : ''}`}
                    onClick={() => setCommissionTab('pending')}
                  >
                    Pending
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={commissionTab === 'completed'}
                    className={`segmented-option${commissionTab === 'completed' ? ' active' : ''}`}
                    onClick={() => setCommissionTab('completed')}
                  >
                    Completed
                  </button>
                </div>

                {loadingCommissions && (
                  <div className="card home-empty-state-card ag-liquid-glass-soft t-xs c-low">Loading dashboard...</div>
                )}

                {!loadingCommissions && commissionLoadError && (
                  <div className="card home-empty-state-card ag-liquid-glass-soft t-sm c-mid" role="alert">
                    <span>Could not load dashboard commissions: {commissionLoadError}</span>
                    <button type="button" className="link-sm" onClick={() => void refreshDashboard()}>Retry</button>
                  </div>
                )}

                {!loadingCommissions && !commissionLoadError && commissionTab === 'active' && activeCommissions.length === 0 && (
                  <div className="card home-empty-state-card ag-liquid-glass-soft home-empty-empty-state">
                    <div className="home-empty-state-icon"><Icon name="palette" /></div>
                    <div className="home-empty-state-title">No active commissions yet</div>
                    <div className="home-empty-state-copy">Start a new commission or explore the marketplace to collaborate with artists.</div>
                  </div>
                )}

                {!loadingCommissions && !commissionLoadError && commissionTab === 'pending' && pendingCommissions.length === 0 && (
                  <div className="card home-empty-state-card ag-liquid-glass-soft home-empty-empty-state">
                    <div className="home-empty-state-icon"><Icon name="palette" /></div>
                    <div className="home-empty-state-title">No pending commissions</div>
                    <div className="home-empty-state-copy">Requests awaiting a response will appear here.</div>
                  </div>
                )}

                {!loadingCommissions && !commissionLoadError && commissionTab === 'completed' && completedCommissions.length === 0 && (
                  <div className="card home-empty-state-card ag-liquid-glass-soft home-empty-empty-state">
                    <div className="home-empty-state-icon"><Icon name="palette" /></div>
                    <div className="home-empty-state-title">No completed commissions yet</div>
                    <div className="home-empty-state-copy">Your finished work will appear here once a commission is delivered.</div>
                  </div>
                )}

                {visibleCommissions.map((commission, i) => {
                  const rawProgress = Number(commissionProgressById[commission.id] ?? 0);
                  const progressUnavailable = commission.status !== 'REQUESTED' && Boolean(commissionProgressFailedById[commission.id]);
                  const progressPercent = commission.status === 'COMPLETED'
                    ? 100
                    : commission.status === 'REQUESTED' || progressUnavailable
                      ? null
                      : Math.max(0, Math.min(100, Number.isFinite(rawProgress) ? rawProgress : 0));
                  const dueAt = getCommissionDueAt(commission);
                  const dueLabel = dueAt
                    ? `Due ${new Date(dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                    : 'No deadline set';
                  const progressLabel =
                    commission.status === 'REQUESTED'
                      ? 'Awaiting approval'
                      : progressUnavailable
                        ? 'Progress unavailable'
                        : commission.status === 'ACCEPTED'
                          ? 'Accepted'
                          : commission.status === 'REVISION_REQUESTED'
                            ? 'Revision requested'
                            : progressPercent !== null && progressPercent > 0
                              ? `${progressPercent}% complete`
                              : 'Not started';

                  return (
                    <button
                      key={commission.id}
                      type="button"
                      className="tap-card card home-commission-card ag-liquid-glass-soft"
                      style={{ marginBottom: i === visibleCommissions.length - 1 ? 20 : 10 }}
                      onClick={() => navigate(`/home/workspace/${commission.id}`)}
                    >
                      <div className="home-commission-card-header">
                        <div
                          className="avatar avatar-sm"
                          style={commission.counterparty?.avatar_data_url ? { backgroundImage: `url(${commission.counterparty.avatar_data_url})`, backgroundSize: 'cover' } : {}}
                        >
                          {!commission.counterparty?.avatar_data_url && initialsFor(commission.counterparty?.name ?? '?')}
                        </div>
                        <div className="home-commission-card-body">
                          <div className="row-between">
                            <span className="t-sm fw-700 home-commission-title">{commission.title}</span>
                            <span className={`badge ${commission.status === 'REQUESTED' ? 'badge-warning' : 'badge-accent'}`}>
                              {compactCommissionStatusLabel(commission).replace(' ', '\u00A0')}
                            </span>
                          </div>
                          <div className="home-commission-meta">
                            {commission.counterparty?.name ?? 'Unknown'} · {new Date(commission.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </div>
                          <div className="home-commission-progress-row">
                            <span className="t-xs c-low">{progressLabel}</span>
                            {progressPercent !== null && <span className="t-xs fw-700 c-hi">{progressPercent}%</span>}
                          </div>
                          {progressPercent !== null && <ProgressBar percent={progressPercent} color="var(--ag-success)" />}
                          <div className="home-commission-compact-due">
                            {commission.status === 'REQUESTED'
                              ? 'Awaiting approval'
                              : commission.status === 'ACCEPTED'
                                ? 'Ready to start'
                                : dueLabel}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}

                {user?.role === 'artist' && commissionTab === 'pending' && pendingRequestCount > 0 && (
                  <>
                    <div className="row-between home-commissions-heading secondary-heading">
                      <span className="section-title">Incoming Commission Requests</span>
                      <span className="t-xs c-low">{pendingRequestCount} pending</span>
                    </div>
                    {pendingCommissions.map((commission) => (
                      <article className="card home-incoming-request-card" key={`request-${commission.id}`} style={{ marginBottom: 10 }}>
                        <div className="row-between" style={{ marginBottom: 7 }}>
                          <div>
                            <div className="t-sm fw-700">{commission.counterparty?.name ?? 'Unknown client'}</div>
                            {commission.counterparty?.username && <div className="t-xs c-low">@{commission.counterparty.username}</div>}
                          </div>
                          <span className="badge badge-warning">REQUESTED</span>
                        </div>
                        <div className="t-sm fw-600" style={{ marginBottom: 4 }}>{commission.title}</div>
                        {commissionSnapshotLabel(commission) && (
                          <div className="t-xs c-low" style={{ marginBottom: 4 }}>{commissionSnapshotLabel(commission)}</div>
                        )}
                        <div className="t-xs c-mid" style={{ lineHeight: 1.5 }}>{commission.description || 'No description provided.'}</div>
                        <div className="t-xs c-low" style={{ marginTop: 8 }}>
                          Requested {new Date(commission.requested_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>
                        <div className="row gap-10 home-request-actions" style={{ marginTop: 12 }}>
                          <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={Boolean(commissionActionId)} onClick={() => void handleAcceptCommission(commission.id)}>
                            {commissionActionId === commission.id ? 'Saving…' : 'Accept Commission'}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 1 }} disabled={Boolean(commissionActionId)} onClick={() => void handleRejectCommission(commission.id)}>
                            Reject
                          </button>
                        </div>
                      </article>
                    ))}
                  </>
                )}
              </>
            )}

            {!isSupabaseConfigured && (
              <>
                <div className="row-between home-commissions-heading">
                  <span className="section-title">Active Commissions</span>
                </div>
                <div className="card home-empty-state-card ag-liquid-glass-soft t-sm c-mid">No active commission data is available yet.</div>
              </>
            )}
          </section>
          </div>

          <div className="home-summary-sidebar">
            <aside className="home-quick-stats" aria-label="Quick stats">
              <div className="home-quick-stats-header">Quick Stats</div>
              <div className="home-quick-stats-grid">
                {quickStats.map((stat) => (
                  <button
                    key={stat.label}
                    type="button"
                    className={`home-stat home-stat-${stat.tone}`}
                    aria-label={`${stat.value} ${stat.label.toLowerCase()} commissions`}
                    aria-pressed={commissionTab === stat.key}
                    onClick={() => {
                      setCommissionTab(stat.key);
                      commissionSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    <div className="home-stat-label">{stat.label}</div>
                    <div className="home-stat-value" aria-hidden="true">{stat.value}</div>
                  </button>
                ))}
              </div>
            </aside>

            <aside className="card home-activity-card ag-liquid-glass-soft">
              <div className="row-between home-activity-heading">
                <span className="section-title">Recent Activity</span>
                <button
                  type="button"
                  className="home-refresh-button"
                  aria-label="Refresh dashboard"
                  title="Refresh dashboard"
                  disabled={loadingCommissions || loadingPaidCommissionPayments || loadingNotifications || refreshingDashboard}
                  onClick={() => void refreshDashboard()}
                >
                  <Icon name="refresh" />
                </button>
              </div>
              <div className="home-activity-list">
                {isSupabaseConfigured ? (
                  loadingNotifications ? (
                    <div className="t-xs c-low" role="status">Loading recent activity…</div>
                  ) : notificationsError ? (
                    <div className="home-activity-error" role="alert">
                      <div className="t-xs c-low">Recent activity unavailable: {notificationsError}</div>
                      <button type="button" className="link-sm" onClick={() => void refreshNotifications()}>Retry</button>
                    </div>
                  ) : recentCommissionActivity.length === 0 ? (
                    <div className="t-xs c-low home-empty-activity">No recent commission activity.</div>
                  ) : recentCommissionActivity.slice(0, 4).map((notification) => (
                    <div className="row gap-10 home-activity-row" key={notification.id}>
                      <div className="home-activity-icon">
                        <Icon name="bell" style={{ width: 14, height: 14, stroke: 'var(--ag-accent)' }} />
                      </div>
                      <div className="home-activity-copy">
                        <div className="t-xs c-hi fw-600">{notification.title}</div>
                        <div className="t-xs c-mid">{notification.message}</div>
                        <div className="t-xs c-low">{relativeNotificationTime(notification.created_at)}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="t-xs c-low home-empty-activity">No recent activity data is available yet.</div>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
      {toast}
    </ScreenShell>
  );
}
