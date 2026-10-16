import { useEffect, useRef, useState } from 'react';
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

const ACTIVE_COMMISSION_STATUSES = new Set(['REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED']);

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

function paidTotalsByCurrency(payments: CommissionPayment[]): Array<{ currency: string; amount: number; count: number }> {
  const totals = new Map<string, { amount: number; count: number }>();
  for (const payment of payments) {
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount)) continue;
    const total = totals.get(payment.currency) ?? { amount: 0, count: 0 };
    total.amount += amount;
    total.count += 1;
    totals.set(payment.currency, total);
  }
  return Array.from(totals, ([currency, total]) => ({ currency, ...total }));
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
  const { notifications, unreadCount, error: notificationsError, markAsRead } = useNotifications();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationAnchorRef = useRef<HTMLDivElement>(null);

  const [myCommissions, setMyCommissions] = useState<MyCommission[]>([]);
  const [commissionTab, setCommissionTab] = useState<'active' | 'completed'>('active');
  const [loadingCommissions, setLoadingCommissions] = useState(true);
  const [commissionLoadError, setCommissionLoadError] = useState<string | null>(null);
  const [commissionActionId, setCommissionActionId] = useState<string | null>(null);
  const [paidCommissionPayments, setPaidCommissionPayments] = useState<CommissionPayment[]>([]);
  const [loadingPaidCommissionPayments, setLoadingPaidCommissionPayments] = useState(true);
  const [paidCommissionPaymentsError, setPaidCommissionPaymentsError] = useState(false);
  const [commissionProgressById, setCommissionProgressById] = useState<Record<string, number>>({});

  const activeCommissions = myCommissions.filter((commission) => ACTIVE_COMMISSION_STATUSES.has(commission.status));
  const completedCommissions = myCommissions.filter((commission) => commission.status === 'COMPLETED');
  const completedCommissionCount = completedCommissions.length;
  const visibleCommissions = commissionTab === 'active' ? activeCommissions : completedCommissions;
  const paidCurrencyTotals = paidTotalsByCurrency(paidCommissionPayments);
  const pendingRequestCount = myCommissions.filter((commission) => commission.status === 'REQUESTED'
    && (user?.role === 'artist' ? !commission.isClient : commission.isClient)).length;
  const recentCommissionActivity = notifications
    .filter((notification) => notification.notification_type === 'commission' || notification.notification_type === 'revision')
    .slice(0, 5);

  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      setMyCommissions([]);
      setCommissionLoadError(null);
      setLoadingCommissions(false);
      return;
    }
    let active = true;
    setLoadingCommissions(true);
    setMyCommissions([]);
    setCommissionLoadError(null);
    listMyCommissions(user.id)
      .then((rows) => {
        if (active) setMyCommissions(rows);
      })
      .catch((error) => {
        if (active) {
          setMyCommissions([]);
          setCommissionLoadError(error instanceof Error ? error.message : 'Could not load dashboard commissions.');
        }
      })
      .finally(() => {
        if (active) setLoadingCommissions(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

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
      return;
    }

    let active = true;
    void Promise.all(activeCommissions.map(async (commission) => {
      try {
        const updates = await listCommissionProgress(commission.id);
        const latest = updates.reduce((max, update) => Math.max(max, Number(update.progress_percent) || 0), 0);
        return [commission.id, latest] as const;
      } catch {
        return [commission.id, 0] as const;
      }
    })).then((entries) => {
      if (!active) return;
      setCommissionProgressById(Object.fromEntries(entries));
    });

    return () => {
      active = false;
    };
  }, [user?.id, activeCommissions]);

  const refreshCommissions = async () => {
    if (!user) return;
    const rows = await listMyCommissions(user.id);
    setMyCommissions(rows);
    setCommissionLoadError(null);
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
    if (!notification.is_read) await markAsRead(notification.id);
    setNotificationsOpen(false);
    if (notification.related_route) navigate(notification.related_route);
  };

  return (
    <ScreenShell
      contentClassName="home-dashboard-content"
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
              <div className="notification-preview" role="dialog" aria-label="Notification preview">
                <div className="notification-preview-header">
                  <span className="t-sm fw-700">Notifications</span>
                  {unreadCount > 0 && <span className="t-xs c-low">{unreadCount} unread</span>}
                </div>
                <div className="notification-preview-list">
                  {notifications.length === 0 && <div className="notification-preview-empty t-xs c-low">No notifications yet</div>}
                  {notifications.slice(0, 5).map((notification) => (
                    <button
                      type="button"
                      className={`notification-preview-item${notification.is_read ? '' : ' is-unread'}`}
                      key={notification.id}
                      onClick={() => void handleNotificationClick(notification)}
                    >
                      <Icon name={notification.notification_type === 'message' ? 'chat' : notification.notification_type === 'verification' ? 'shield' : 'bell'} />
                      <span className="notification-preview-item-copy">
                        <span className="notification-preview-item-title">{notification.title}</span>
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
      <div className="dash-grid">
        <div className="dash-main">
          {isSupabaseConfigured ? (
            <button
              type="button"
              className="tap-card card home-revenue-card"
              style={{
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                background: 'var(--ag-grad-primary)',
                border: 'none',
                marginBottom: 16,
              }}
              onClick={() => navigate('/home/analytics')}
            >
              <div className="row-between" style={{ marginBottom: 10 }}>
                <span className="t-xs" style={{ color: 'rgba(22,33,59,0.7)' }}>
                  {user?.role === 'artist' ? 'Revenue · This month' : 'Spending · This month'}
                </span>
                {paidCurrencyTotals.length > 0 && (
                  <span className="badge" style={{ background: 'rgba(22,33,59,0.16)', color: 'var(--ag-ink)' }}>
                    +18%
                  </span>
                )}
              </div>
              {loadingPaidCommissionPayments ? (
                <div className="t-sm fw-600" style={{ color: 'var(--ag-ink)' }}>Loading...</div>
              ) : paidCommissionPaymentsError ? (
                <div className="t-sm fw-600" role="alert" style={{ color: 'var(--ag-ink)' }}>
                  Could not load payment summary.
                </div>
              ) : paidCurrencyTotals.length === 0 ? (
                <>
                  <div className="mono" style={{ fontSize: 29, fontWeight: 700, color: 'var(--ag-ink)' }}>₱0.00</div>
                  <div className="t-xs" style={{ color: 'rgba(22,33,59,0.7)', marginTop: 4 }}>No paid commissions yet</div>
                </>
              ) : paidCurrencyTotals.length === 1 ? (
                <>
                  <div className="mono" style={{ fontSize: 29, fontWeight: 700, color: 'var(--ag-ink)' }}>
                    {paidCurrencyTotals[0].currency} {paidCurrencyTotals[0].amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="t-xs" style={{ color: 'rgba(22,33,59,0.7)', marginTop: 4 }}>
                    {paidCurrencyTotals[0].count} paid commission{paidCurrencyTotals[0].count === 1 ? '' : 's'}
                  </div>
                </>
              ) : (
                <>
                  <div className="t-sm fw-700" style={{ color: 'var(--ag-ink)', marginBottom: 5 }}>Multiple currencies</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {paidCurrencyTotals.map((total) => (
                      <div className="row-between t-xs" key={total.currency} style={{ color: 'var(--ag-ink)' }}>
                        <span>{total.currency}</span>
                        <span className="mono">{total.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                  <div className="t-xs" style={{ color: 'rgba(22,33,59,0.7)', marginTop: 4 }}>
                    {paidCommissionPayments.length} paid commission{paidCommissionPayments.length === 1 ? '' : 's'}
                  </div>
                </>
              )}
              <div className="home-revenue-chart" aria-label="Revenue chart area">
                {paidCurrencyTotals.length > 0 ? (
                  <svg viewBox="0 0 260 36" className="home-revenue-graph-svg" aria-hidden="true">
                    <path d="M 0 22 C 34 18, 54 25, 78 17 S 138 12, 162 20 S 214 8, 260 10" />
                  </svg>
                ) : (
                  <div className="home-revenue-chart-empty">No revenue history yet</div>
                )}
              </div>
            </button>
          ) : (
            <button
              type="button"
              className="tap-card card home-revenue-card"
              style={{
                background: 'var(--ag-grad-primary)',
                border: 'none',
                marginBottom: 16,
                position: 'relative',
                overflow: 'hidden',
              }}
              onClick={() => navigate('/home/analytics')}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage:
                    'repeating-linear-gradient(135deg, rgba(22,33,59,0.06) 0 2px, transparent 2px 14px)',
                }}
              />
              <div className="row-between" style={{ position: 'relative', marginBottom: 10 }}>
                <span className="t-xs" style={{ color: 'rgba(22,33,59,0.72)' }}>
                  Revenue · This month
                </span>
              </div>
              <div className="mono" style={{ fontSize: 29, fontWeight: 700, color: 'var(--ag-ink)', position: 'relative' }}>
                No revenue history yet
              </div>
              <div className="home-revenue-chart" aria-label="Revenue chart area" style={{ position: 'relative' }}>
                <div className="home-revenue-chart-empty">No revenue history yet</div>
              </div>
            </button>
          )}

          {isSupabaseConfigured && (
            <>
              <div className="row-between home-commissions-heading" style={{ marginBottom: 12 }}>
                <div>
                  <span className="section-title">Your Commissions</span>
                  {!loadingCommissions && !commissionLoadError && (
                    <div className="t-xs c-low" style={{ marginTop: 3 }}>
                      {activeCommissions.length} active · {completedCommissionCount} completed · {pendingRequestCount} pending
                    </div>
                  )}
                </div>
                {user?.role === 'client' && (
                  <button
                    type="button"
                    className="link-sm tap-card"
                    style={{ width: 'auto' }}
                    onClick={() => navigate('/commission/start')}
                  >
                    + Start Commission
                  </button>
                )}
              </div>

              <div className="segmented" role="tablist" aria-label="Commission history" style={{ marginBottom: 12 }}>
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
                  aria-selected={commissionTab === 'completed'}
                  className={`segmented-option${commissionTab === 'completed' ? ' active' : ''}`}
                  onClick={() => setCommissionTab('completed')}
                >
                  Completed
                </button>
              </div>

              {loadingCommissions && (
                <div className="card t-xs c-low" style={{ marginBottom: 20 }}>
                  Loading dashboard...
                </div>
              )}

              {!loadingCommissions && commissionLoadError && (
                <div className="card t-sm c-mid" role="alert" style={{ textAlign: 'center', marginBottom: 20 }}>
                  Could not load dashboard commissions.
                </div>
              )}

              {!loadingCommissions && !commissionLoadError && commissionTab === 'active' && activeCommissions.length === 0 && (
                <div className="card t-sm c-mid" style={{ textAlign: 'center', marginBottom: 20 }}>
                  No active commissions yet.
                </div>
              )}

              {!loadingCommissions && !commissionLoadError && commissionTab === 'completed' && completedCommissions.length === 0 && (
                <div className="card t-sm c-mid" style={{ textAlign: 'center', marginBottom: 20 }}>
                  No completed commissions yet.
                </div>
              )}

              {visibleCommissions.map((commission, i) => {
                const rawProgress = Number(commissionProgressById[commission.id] ?? 0);
                const progressPercent = commission.status === 'COMPLETED'
                  ? 100
                  : Math.max(0, Math.min(100, Number.isFinite(rawProgress) ? rawProgress : 0));
                const dueAt = getCommissionDueAt(commission);
                const dueLabel = dueAt
                  ? `Due ${new Date(dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                  : 'No deadline set';
                const progressLabel = commission.status === 'REQUESTED'
                  ? 'Awaiting approval'
                  : commission.status === 'ACCEPTED'
                    ? 'Accepted'
                    : commission.status === 'REVISION_REQUESTED'
                      ? 'Revision requested'
                      : progressPercent > 0 ? `${progressPercent}% complete` : 'Not started';

                return (
                  <button
                    key={commission.id}
                    type="button"
                    className="tap-card card home-commission-card"
                    style={{ marginBottom: i === visibleCommissions.length - 1 ? 20 : 10 }}
                    onClick={() => navigate(`/home/workspace/${commission.id}`)}
                  >
                    <div className="home-commission-card-header">
                      <div
                        className="avatar avatar-sm"
                        style={
                          commission.counterparty?.avatar_data_url
                            ? { backgroundImage: `url(${commission.counterparty.avatar_data_url})`, backgroundSize: 'cover' }
                            : {}
                        }
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
                          <span className="t-xs fw-700 c-hi">{progressPercent}%</span>
                        </div>
                        <ProgressBar percent={progressPercent} color="var(--ag-success)" />
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

              {user?.role === 'artist' && (
                <>
                  <div className="row-between home-commissions-heading" style={{ margin: '4px 0 12px' }}>
                    <span className="section-title">Incoming Commission Requests</span>
                    <span className="t-xs c-low">{pendingRequestCount} pending</span>
                  </div>
                  {myCommissions.filter((commission) => commission.status === 'REQUESTED' && !commission.isClient).map((commission) => (
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

          {user?.role === 'artist' && (
            <button
              type="button"
              className="tap-card card home-shield-card"
              onClick={() => navigate('/shield')}
              style={{ marginBottom: 20 }}
            >
              <div className="row gap-10">
                <div className="home-shield-icon">
                  <Icon name="shield" style={{ stroke: 'var(--ag-success)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row-between">
                    <span className="t-sm fw-700">Shield Active</span>
                    <span className="badge badge-success">Live</span>
                  </div>
                  <div className="t-xs c-low">Protection status available</div>
                </div>
                <Icon name="chevron-r" style={{ width: 15, height: 15, stroke: 'var(--ag-text-low)' }} />
              </div>
            </button>
          )}

          {!isSupabaseConfigured && (
            <>
              <div className="row-between home-commissions-heading" style={{ marginBottom: 12 }}>
                <span className="section-title">Active Commissions</span>
              </div>

              <div className="card t-sm c-mid" style={{ textAlign: 'center', marginBottom: 20 }}>
                No active commission data is available yet.
              </div>
            </>
          )}
        </div>

        <div className="dash-side home-activity-card">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <span className="section-title">Recent Activity</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 6 }}>
            {isSupabaseConfigured ? (
              notificationsError ? (
                <div className="t-xs c-low">Recent activity unavailable.</div>
              ) : recentCommissionActivity.length === 0 ? (
                <div className="t-xs c-low">No recent commission activity.</div>
              ) : recentCommissionActivity.map((notification) => (
                <div className="row gap-10" key={notification.id}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      background: 'var(--ag-surface-2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="bell" style={{ width: 14, height: 14, stroke: 'var(--ag-accent)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t-xs c-hi fw-600">{notification.title}</div>
                    <div className="t-xs c-mid">{notification.message}</div>
                    <div className="t-xs c-low">{relativeNotificationTime(notification.created_at)}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="t-xs c-low">No recent activity data is available yet.</div>
            )}
          </div>
        </div>
      </div>
      {toast}
    </ScreenShell>
  );
}
