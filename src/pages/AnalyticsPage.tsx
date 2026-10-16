import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { listMyPaidCommissionPayments, type CommissionPayment } from '../lib/supabasePayments';
import { listArtistReviews, type ArtistReview } from '../lib/supabaseReviews';
import { listMyCommissions, type MyCommission } from '../lib/supabaseRevisions';
import './AnalyticsPage.css';

const ACTIVE_STATUSES = new Set(['REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED']);

interface CompletionMonth {
  key: string;
  label: string;
  count: number;
}

function completionMonths(commissions: MyCommission[]): CompletionMonth[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const commission of commissions) {
    if (commission.status !== 'COMPLETED' || !commission.completed_at) continue;
    const completedAt = new Date(commission.completed_at);
    if (!Number.isFinite(completedAt.getTime())) continue;
    const key = `${completedAt.getFullYear()}-${String(completedAt.getMonth() + 1).padStart(2, '0')}`;
    const current = counts.get(key);
    counts.set(key, {
      label: completedAt.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
      count: (current?.count ?? 0) + 1,
    });
  }
  return Array.from(counts, ([key, value]) => ({ key, ...value }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-6);
}

function averageWorkDays(commissions: MyCommission[]): number | null {
  const durations: number[] = [];
  for (const commission of commissions) {
    if (commission.status !== 'COMPLETED' || !commission.started_at || !commission.completed_at) continue;
    const start = Date.parse(commission.started_at);
    const end = Date.parse(commission.completed_at);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      durations.push((end - start) / 86400000);
    }
  }
  return durations.length ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length : null;
}

function repeatCounterpartyRate(commissions: MyCommission[], role: 'artist' | 'client'): number | null {
  const completedByCounterparty = new Map<string, number>();
  for (const commission of commissions) {
    if (commission.status !== 'COMPLETED') continue;
    const counterpartyId = role === 'artist' ? commission.client_id : commission.artist_id;
    completedByCounterparty.set(counterpartyId, (completedByCounterparty.get(counterpartyId) ?? 0) + 1);
  }
  if (completedByCounterparty.size === 0) return null;
  const repeatCount = Array.from(completedByCounterparty.values()).filter((count) => count > 1).length;
  return (repeatCount / completedByCounterparty.size) * 100;
}

function completionRate(commissions: MyCommission[]): number | null {
  const meaningfulCommissions = commissions.filter((commission) =>
    commission.status === 'COMPLETED' || commission.status === 'CANCELLED',
  );
  if (meaningfulCommissions.length === 0) return null;
  const completedCount = meaningfulCommissions.filter((commission) => commission.status === 'COMPLETED').length;
  return (completedCount / meaningfulCommissions.length) * 100;
}

function revenueByMonth(payments: CommissionPayment[]): Array<{ key: string; label: string; amount: number }> {
  const totals = new Map<string, { key: string; label: string; amount: number }>();
  for (const payment of payments) {
    const paidAt = payment.paid_at ?? payment.created_at;
    const date = new Date(paidAt);
    if (!Number.isFinite(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const amount = Number(payment.amount) || 0;
    const entry = totals.get(key) ?? { key, label: date.toLocaleDateString(undefined, { month: 'short' }), amount: 0 };
    entry.amount += amount;
    totals.set(key, entry);
  }
  return Array.from(totals.values()).sort((a, b) => a.key.localeCompare(b.key)).slice(-6);
}

function MockAnalyticsContent() {
  return (
    <div className="analytics-dashboard analytics-dashboard-mock">
      <div className="card analytics-revenue-card analytics-empty-state-card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <span className="t-xs c-low">Total Revenue</span>
          <span className="t-xs c-low">This Month</span>
        </div>
        <div className="mono fw-700" style={{ fontSize: 26, lineHeight: 1.2 }}>Unavailable</div>
        <div className="t-xs c-low" style={{ marginTop: 8 }}>
          Revenue data appears after payment records are available for this workspace.
        </div>
        <div className="analytics-chart-placeholder" aria-label="Revenue chart area">
          No historical revenue data yet.
        </div>
      </div>

      <div className="section-title analytics-section-title" style={{ marginBottom: 10 }}>
        Commission Activity
      </div>
      <div className="analytics-metric-grid">
        {[
          { label: 'Completed', value: '—' },
          { label: 'In progress', value: '—' },
          { label: 'Avg. turnaround', value: '—' },
          { label: 'Repeat clients', value: '—' },
        ].map((kpi) => (
          <div className="card analytics-metric-card" key={kpi.label}>
            <div className="mono fw-700" style={{ fontSize: 19 }}>{kpi.value}</div>
            <div className="t-xs c-low">{kpi.label}</div>
          </div>
        ))}
      </div>

      <div className="card analytics-security-card analytics-empty-state-card">
        <div className="section-title" style={{ marginBottom: 8 }}>Security Report</div>
        <div className="t-xs c-low">No security analytics available yet.</div>
      </div>
    </div>
  );
}

function RealAnalyticsContent({ commissions, reviews, payments, role, reviewError }: {
  commissions: MyCommission[];
  reviews: ArtistReview[];
  payments: CommissionPayment[];
  role: 'artist' | 'client';
  reviewError: string | null;
}) {
  const completed = commissions.filter((commission) => commission.status === 'COMPLETED');
  const active = commissions.filter((commission) => ACTIVE_STATUSES.has(commission.status));
  const inProgress = commissions.filter((commission) => commission.status === 'IN_PROGRESS');
  const pending = commissions.filter((commission) => commission.status === 'REQUESTED');
  const months = completionMonths(commissions);
  const maxMonthlyCount = Math.max(0, ...months.map((month) => month.count));
  const averageDays = averageWorkDays(commissions);
  const repeatRate = repeatCounterpartyRate(commissions, role);
  const completionPercent = completionRate(commissions);
  const clientArtistsCount = new Set(commissions.map((commission) => commission.artist_id)).size;
  const requestsSentCount = commissions.filter((commission) => commission.isClient).length;
  const revenueSeries = revenueByMonth(payments);
  const totalRevenue = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const revenueCurveMax = Math.max(1, ...revenueSeries.map((entry) => entry.amount));
  const revenueCurrencies = Array.from(new Set(payments.map((payment) => payment.currency))).join(', ') || '—';
  const revenuePath = revenueSeries.length > 0
    ? (() => {
        const points = revenueSeries.map((entry, index) => {
          const x = revenueSeries.length === 1 ? 130 : 20 + (index * 220) / Math.max(1, revenueSeries.length - 1);
          const y = 30 - ((entry.amount / revenueCurveMax) * 18);
          return { x, y };
        });
        if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
        let path = `M ${points[0].x} ${points[0].y}`;
        for (let index = 1; index < points.length; index += 1) {
          const previous = points[index - 1];
          const current = points[index];
          const controlX = (previous.x + current.x) / 2;
          path += ` Q ${previous.x} ${previous.y}, ${controlX} ${(previous.y + current.y) / 2}`;
          if (index === points.length - 1) {
            path += ` T ${current.x} ${current.y}`;
          }
        }
        return path;
      })()
    : '';

  return (
    <div className="analytics-dashboard analytics-dashboard-real">
      <div className="card analytics-revenue-card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <span className="t-xs c-low">Total Revenue</span>
          {revenueSeries.length > 1 && (
            <span className="row gap-8 t-xs c-success fw-600">
              <Icon name="trending" style={{ width: 12, height: 12, stroke: 'var(--ag-success)' }} />
              {payments.length > 0 ? 'Live' : 'N/A'}
            </span>
          )}
        </div>
        {payments.length === 0 ? (
          <>
            <div className="t-sm c-mid">No paid commission revenue is available yet.</div>
            <div className="analytics-chart-placeholder" aria-label="Revenue chart area">
              No historical revenue data yet.
            </div>
          </>
        ) : (
          <>
            <div className="mono fw-700" style={{ fontSize: 26, lineHeight: 1.2 }}>
              {revenueCurrencies === '—' ? '—' : `${revenueCurrencies} ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </div>
            <div className="t-xs c-low" style={{ marginTop: 8 }}>{payments.length} paid commission{payments.length === 1 ? '' : 's'}</div>
            <div className="home-revenue-chart analytics-revenue-chart" aria-label="Revenue chart area">
              <svg viewBox="0 0 260 36" className="home-revenue-graph-svg" aria-label="Revenue trend graph">
                <path
                  d={revenuePath}
                  fill="none"
                  stroke="rgba(22,33,59,0.8)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </>
        )}
      </div>

      <div className="section-title analytics-section-title" style={{ marginBottom: 10 }}>
        {role === 'artist' ? 'Commission Performance' : 'Commission Activity'}
      </div>
      <div className="analytics-metric-grid">
        {[
          { label: 'Completed commissions', value: String(completed.length) },
          { label: 'Active commissions', value: String(active.length) },
          { label: 'In progress', value: String(inProgress.length) },
          { label: 'Pending requests', value: String(pending.length) },
        ].map((kpi) => (
          <div className="card analytics-metric-card" key={kpi.label}>
            <div className="mono fw-700" style={{ fontSize: 19 }}>{kpi.value}</div>
            <div className="t-xs c-low">{kpi.label}</div>
          </div>
        ))}
      </div>

      <div className="card analytics-month-chart-card">
        <div className="section-title" style={{ marginBottom: 12 }}>Completed Commissions by Month</div>
        {months.length === 0 ? (
          <div className="t-xs c-low">No completed commissions with completion dates yet.</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, minHeight: 112, overflowX: 'auto' }}>
            {months.map((month) => (
              <div key={month.key} style={{ flex: '1 0 42px', minWidth: 0, textAlign: 'center' }}>
                <div className="t-xs c-mid" style={{ marginBottom: 4 }}>{month.count}</div>
                <div
                  style={{
                    height: `${Math.max(8, Math.round((month.count / maxMonthlyCount) * 72))}px`,
                    background: 'var(--ag-grad-primary)',
                    borderRadius: '5px 5px 0 0',
                  }}
                />
                <div className="t-xs c-low" style={{ marginTop: 5, whiteSpace: 'nowrap' }}>{month.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section-title analytics-section-title" style={{ marginBottom: 10 }}>
        {role === 'artist' ? 'Work Performance' : 'Project History'}
      </div>
      <div className="analytics-metric-grid analytics-work-metrics">
        <div className="card analytics-metric-card">
          <div className="mono fw-700" style={{ fontSize: 19 }}>{averageDays === null ? '—' : `${averageDays.toFixed(1)}d`}</div>
          <div className="t-xs c-low">{role === 'artist' ? 'Avg. Work Duration' : 'Avg. Project Duration'}</div>
          {averageDays === null && <div className="t-xs c-mid" style={{ marginTop: 5 }}>No completion data yet.</div>}
        </div>
        <div className="card analytics-metric-card">
          <div className="mono fw-700" style={{ fontSize: 19 }}>{repeatRate === null ? 'N/A' : `${repeatRate.toFixed(0)}%`}</div>
          <div className="t-xs c-low">{role === 'artist' ? 'Repeat-client rate' : 'Repeat-artist rate'}</div>
          {repeatRate === null && <div className="t-xs c-mid" style={{ marginTop: 5 }}>No completed commissions yet.</div>}
        </div>
        {role === 'artist' && (
          <div className="card analytics-metric-card">
            <div className="mono fw-700" style={{ fontSize: 19 }}>{completionPercent === null ? 'N/A' : `${completionPercent.toFixed(0)}%`}</div>
            <div className="t-xs c-low">Completion Rate</div>
            <div className="t-xs c-mid" style={{ marginTop: 5 }}>Completed ÷ completed and cancelled commissions</div>
          </div>
        )}
      </div>

      {role === 'artist' && (
        <div className="card analytics-feedback-card">
          <div className="section-title" style={{ marginBottom: 10 }}>Client Feedback</div>
          {reviewError ? (
            <div className="t-sm c-mid" role="alert">{reviewError}</div>
          ) : reviews.length === 0 ? (
            <div className="t-sm c-mid">No reviews yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div className="mono fw-700" style={{ fontSize: 19 }}>{(reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1)} / 5</div>
                <div className="t-xs c-low">Average Rating</div>
              </div>
              <div>
                <div className="mono fw-700" style={{ fontSize: 19 }}>{reviews.length}</div>
                <div className="t-xs c-low">Total Reviews</div>
              </div>
            </div>
          )}
        </div>
      )}

      {role === 'client' && (
        <>
          <div className="section-title" style={{ marginBottom: 10 }}>Commission Activity Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div className="card analytics-metric-card" style={{ padding: 14 }}>
              <div className="mono fw-700" style={{ fontSize: 19 }}>{requestsSentCount}</div>
              <div className="t-xs c-low">Requests Sent</div>
            </div>
            <div className="card analytics-metric-card" style={{ padding: 14 }}>
              <div className="mono fw-700" style={{ fontSize: 19 }}>{clientArtistsCount}</div>
              <div className="t-xs c-low">Artists Commissioned</div>
            </div>
          </div>
        </>
      )}

      <div className="card analytics-security-card">
        <div className="section-title" style={{ marginBottom: 8 }}>Security analytics</div>
        <div className="t-xs c-low">Security event data is unavailable.</div>
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const navigate = useNavigate();
  const { user, initializing } = useAuth();
  const [commissions, setCommissions] = useState<MyCommission[]>([]);
  const [reviews, setReviews] = useState<ArtistReview[]>([]);
  const [payments, setPayments] = useState<CommissionPayment[]>([]);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (initializing) {
      setLoading(true);
      setError(null);
      return;
    }
    if (!user) {
      setCommissions([]);
      setReviews([]);
      setPayments([]);
      setReviewError(null);
      setError('Unable to load analytics. Please sign in again.');
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    setCommissions([]);
    setReviews([]);
    setPayments([]);
    setReviewError(null);
    const reviewsPromise = user.role === 'artist'
      ? listArtistReviews(user.id)
        .then((rows) => ({ rows, error: null }))
        .catch(() => ({ rows: [] as ArtistReview[], error: 'Could not load review metrics.' }))
      : Promise.resolve({ rows: [] as ArtistReview[], error: null });
    const paymentsPromise = listMyPaidCommissionPayments(user.id, user.role)
      .then((rows) => ({ rows, error: null }))
      .catch(() => ({ rows: [] as CommissionPayment[], error: 'Could not load revenue metrics.' }));
    void Promise.all([listMyCommissions(user.id), reviewsPromise, paymentsPromise])
      .then(([nextCommissions, reviewResult, paymentResult]) => {
        if (!active) return;
        setCommissions(nextCommissions);
        setReviews(reviewResult.rows);
        setPayments(paymentResult.rows);
        setReviewError(reviewResult.error);
      })
      .catch(() => {
        if (!active) return;
        setCommissions([]);
        setReviews([]);
        setPayments([]);
        setReviewError(null);
        setError('Could not load analytics. Please try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initializing, user?.id, user?.role]);

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between analytics-page-header">
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" />
            <span className="h-title" style={{ fontSize: 19 }}>
              Analytics
            </span>
          </div>
          <div className="chip analytics-period-chip" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="calendar" style={{ width: 12, height: 12 }} />
            {isSupabaseConfigured ? 'All time' : 'This Month'}
          </div>
        </div>
      }
      contentClassName="analytics-page-content"
    >
      {!isSupabaseConfigured ? (
        <MockAnalyticsContent />
      ) : loading ? (
        <div className="card t-sm c-mid">Loading analytics...</div>
      ) : error ? (
        <div className="card t-sm c-mid" role="alert">{error}</div>
      ) : user ? (
        <RealAnalyticsContent commissions={commissions} reviews={reviews} payments={payments} role={user.role} reviewError={reviewError} />
      ) : (
        <div className="card t-sm c-mid" role="alert">Unable to load analytics. Please sign in again.</div>
      )}
    </ScreenShell>
  );
}