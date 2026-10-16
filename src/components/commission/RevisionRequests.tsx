import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Icon } from '../../assets/icons';
import { useAuth } from '../../context/AuthContext';
import { isSupabaseConfigured } from '../../lib/supabase';
import { initialsFor, searchProfiles, type SearchUser } from '../../lib/supabaseData';
import {
  createRevisionRequest,
  createDeliverableRevisionRequest,
  getCommissionById,
  getCommissionByOrderRef,
  getOrCreateCommission,
  listRevisionRequests,
  setRevisionStatus,
  type CommissionLink,
  type RevisionRequest,
  type RevisionStatus,
} from '../../lib/supabaseRevisions';
import { validateRequired } from '../../utils/validators';

type Phase = 'loading' | 'unconfigured' | 'unlinked' | 'not-found' | 'ready';

const STATUS_BADGE: Record<RevisionStatus, { label: string; className: string; style?: CSSProperties }> = {
  OPEN: { label: 'Open', className: 'badge', style: { background: 'var(--ag-surface-3)', color: 'var(--ag-text-mid)' } },
  IN_PROGRESS: { label: 'In Progress', className: 'badge badge-warning' },
  SUBMITTED: { label: 'Submitted', className: 'badge badge-accent' },
  RESOLVED: { label: 'Resolved', className: 'badge badge-success' },
};

interface RevisionRequestsProps {
  /**
   * The demo Order.id shown in the mock workspace (e.g. "AG-2291").
   * When set (and commissionId isn't), an unlinked commission shows the
   * one-time "search for the real account" flow. Provide this OR
   * commissionId, not both.
   */
  orderRef?: string;
  /**
   * A real commission's own id (from public.commissions), used for
   * commissions created via the real "Start a Commission" flow. These
   * already have both parties set at creation time, so no link step is
   * ever shown — the section either loads for real or reports that the
   * commission wasn't found / isn't yours.
   */
  commissionId?: string;
  orderTitle: string;
  deliverableId?: string;
  readOnly?: boolean;
  onRevisionCountChange?: (count: number) => void;
}

/**
 * Real, database-backed revision request flow for a commission
 * workspace. Every create/status-change here is a genuine Supabase
 * call — see supabase/revision-requests.sql and lib/supabaseRevisions.ts.
 * Renders nothing fake: if Supabase isn't configured, it says so
 * instead of simulating success.
 */
export function RevisionRequests({ orderRef, commissionId, orderTitle, deliverableId, readOnly = false, onRevisionCountChange }: RevisionRequestsProps) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [commission, setCommission] = useState<CommissionLink | null>(null);
  const [revisions, setRevisions] = useState<RevisionRequest[]>([]);
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);

  const [newDescription, setNewDescription] = useState('');
  const [descriptionError, setDescriptionError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);

  const [busyRevisionId, setBusyRevisionId] = useState<string | null>(null);
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});
  const [responseErrors, setResponseErrors] = useState<Record<string, string | undefined>>({});

  const showFeedback = useCallback((text: string, isError = false) => {
    setFeedback({ text, isError });
    window.setTimeout(() => setFeedback((f) => (f?.text === text ? null : f)), 3200);
  }, []);

  const refreshRevisions = useCallback(
    async (id: string) => {
      try {
        const rows = await listRevisionRequests(id);
        setRevisions(rows);
        onRevisionCountChange?.(rows.length);
      } catch (err) {
        showFeedback(err instanceof Error ? err.message : 'Could not load revision requests.', true);
      }
    },
    [showFeedback],
  );

  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured || !user) {
      setPhase('unconfigured');
      return;
    }
    setPhase('loading');

    const resolve = commissionId ? getCommissionById(commissionId) : getCommissionByOrderRef(orderRef ?? '');

    resolve
      .then(async (found) => {
        if (!active) return;
        if (!found) {
          setCommission(null);
          // A real commission (opened by its own id) already has both
          // parties fixed at creation time — there's nothing to "link".
          // A demo order (opened by orderRef) genuinely has no real
          // parties yet until someone links it.
          setPhase(commissionId ? 'not-found' : 'unlinked');
          return;
        }
        setCommission(found);
        await refreshRevisions(found.id);
        if (active) setPhase('ready');
      })
      .catch((err) => {
        if (!active) return;
        showFeedback(err instanceof Error ? err.message : 'Could not load this commission.', true);
        setPhase(commissionId ? 'not-found' : 'unlinked');
      });
    return () => {
      active = false;
    };
  }, [orderRef, commissionId, user, refreshRevisions, showFeedback, onRevisionCountChange]);

  useEffect(() => {
    if (phase !== 'unlinked' || !user) return;
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const handle = window.setTimeout(() => {
      searchProfiles(term, user.id)
        .then((results) => {
          if (!active) return;
          setSearchResults(results.filter((r) => r.role !== user.role));
        })
        .catch(() => {
          if (active) setSearchResults([]);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [searchTerm, phase, user]);

  const handleLink = async (candidateId: string) => {
    if (!orderRef) return;
    setLinking(true);
    try {
      const newCommissionId = await getOrCreateCommission(candidateId, orderTitle, orderRef);
      const found = await getCommissionByOrderRef(orderRef);
      if (found) {
        setCommission(found);
        await refreshRevisions(newCommissionId);
        setPhase('ready');
        showFeedback('Commission linked.');
      }
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : 'Could not link this commission.', true);
    } finally {
      setLinking(false);
    }
  };

  const handleCreateRequest = async (e: FormEvent) => {
    e.preventDefault();
    const validation = validateRequired(newDescription, 'Description');
    setDescriptionError(validation);
    if (validation || !commission) return;
    setCreating(true);
    try {
      if (deliverableId) await createDeliverableRevisionRequest(commission.id, deliverableId, newDescription);
      else await createRevisionRequest(commission.id, newDescription);
      setNewDescription('');
      await refreshRevisions(commission.id);
      showFeedback('Revision request submitted.');
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : 'Could not create the revision request.', true);
    } finally {
      setCreating(false);
    }
  };

  const handleStartWork = async (revisionId: string) => {
    if (!commission) return;
    setBusyRevisionId(revisionId);
    try {
      await setRevisionStatus(revisionId, 'IN_PROGRESS');
      await refreshRevisions(commission.id);
      showFeedback('Marked in progress.');
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : 'Could not update this revision request.', true);
    } finally {
      setBusyRevisionId(null);
    }
  };

  const handleSubmitResponse = async (revisionId: string) => {
    if (!commission) return;
    const draft = responseDrafts[revisionId] ?? '';
    const validation = validateRequired(draft, 'Response');
    setResponseErrors((prev) => ({ ...prev, [revisionId]: validation }));
    if (validation) return;
    setBusyRevisionId(revisionId);
    try {
      await setRevisionStatus(revisionId, 'SUBMITTED', draft);
      setResponseDrafts((prev) => ({ ...prev, [revisionId]: '' }));
      await refreshRevisions(commission.id);
      showFeedback('Response submitted.');
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : 'Could not submit this response.', true);
    } finally {
      setBusyRevisionId(null);
    }
  };

  const handleResolve = async (revisionId: string) => {
    if (!commission) return;
    setBusyRevisionId(revisionId);
    try {
      await setRevisionStatus(revisionId, 'RESOLVED');
      await refreshRevisions(commission.id);
      showFeedback('Revision marked resolved.');
    } catch (err) {
      showFeedback(err instanceof Error ? err.message : 'Could not resolve this revision request.', true);
    } finally {
      setBusyRevisionId(null);
    }
  };

  const isClient = !!user && !!commission && user.id === commission.client_id;
  const isArtist = !!user && !!commission && user.id === commission.artist_id;

  return (
    <>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="section-title">Revision Requests</span>
      </div>

      {phase === 'loading' && (
        <div className="card t-xs c-low" style={{ marginBottom: 20 }}>
          Loading revision requests…
        </div>
      )}

      {phase === 'unconfigured' && (
        <div className="card t-xs c-low" style={{ marginBottom: 20 }}>
          Revision requests need a connected Supabase project — this preview is running in local mock mode.
        </div>
      )}

      {phase === 'not-found' && (
        <div className="card t-xs c-low" style={{ marginBottom: 20 }}>
          This commission couldn&apos;t be found, or your account isn&apos;t one of its two real parties.
        </div>
      )}

      {phase === 'unlinked' && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="t-sm fw-700" style={{ marginBottom: 4 }}>
            Link this commission to a real account
          </div>
          <p className="t-xs c-low" style={{ marginBottom: 12, lineHeight: 1.5 }}>
            One-time step — search for the {user?.role === 'client' ? 'artist' : 'client'} on this commission to turn
            on real revision requests here.
          </p>
          <div className="search-bar" style={{ marginBottom: 10 }}>
            <Icon name="search" style={{ width: 16, height: 16 }} />
            <input
              type="text"
              placeholder="Search by name or username…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search for the other party on this commission"
            />
          </div>
          {searching && <div className="t-xs c-low">Searching…</div>}
          {!searching && searchTerm.trim().length >= 2 && searchResults.length === 0 && (
            <div className="t-xs c-low">No matching accounts found.</div>
          )}
          {searchResults.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className="tap-card card row-between"
              style={{ padding: '10px 12px', marginTop: 8 }}
              disabled={linking}
              onClick={() => handleLink(candidate.id)}
            >
              <div className="row gap-10">
                <div
                  className="avatar avatar-sm"
                  style={
                    candidate.avatar_data_url
                      ? { backgroundImage: `url(${candidate.avatar_data_url})`, backgroundSize: 'cover' }
                      : {}
                  }
                >
                  {!candidate.avatar_data_url && initialsFor(candidate.name)}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div className="t-sm fw-600">{candidate.name}</div>
                  <div className="t-xs c-low">
                    @{candidate.username} · {candidate.role}
                  </div>
                </div>
              </div>
              <Icon name="chevron-r" style={{ width: 14, height: 14, stroke: 'var(--ag-text-low)' }} />
            </button>
          ))}
        </div>
      )}

      {phase === 'ready' && commission && (
        <>
          {isClient && !readOnly && (
            <form onSubmit={handleCreateRequest} className="card" style={{ marginBottom: 14 }}>
              <label className="field-label" htmlFor="revision-desc">
                {deliverableId ? 'Revision request for selected deliverable' : 'New revision request'}
              </label>
              <textarea
                id="revision-desc"
                className="textarea-field"
                value={newDescription}
                onChange={(e) => {
                  setNewDescription(e.target.value);
                  if (descriptionError) setDescriptionError(undefined);
                }}
                placeholder="Describe what needs to change…"
                rows={3}
                style={{ marginBottom: descriptionError ? 6 : 12 }}
              />
              {descriptionError && (
                <div className="field-error" style={{ marginBottom: 12 }}>
                  <Icon name="alert" style={{ width: 12, height: 12, stroke: 'var(--ag-danger)' }} />
                  <span>{descriptionError}</span>
                </div>
              )}
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Submitting…' : 'Submit Revision Request'}
              </button>
            </form>
          )}

          {revisions.length === 0 && !isClient && (
            <div className="card t-sm c-mid" style={{ textAlign: 'center', marginBottom: 14 }}>
              No revision requests yet.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            {revisions.map((rev) => {
              const badge = STATUS_BADGE[rev.status];
              const busy = busyRevisionId === rev.id;
              return (
                <div className="card" key={rev.id}>
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <span className={badge.className} style={badge.style}>
                      {badge.label}
                    </span>
                    <span className="t-xs c-low">
                      {new Date(rev.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <p className="t-sm c-mid" style={{ lineHeight: 1.5, marginBottom: rev.response_text ? 10 : 0 }}>
                    {rev.description}
                  </p>
                  {rev.deliverable_id && <div className="t-xs c-low" style={{ marginBottom: 8 }}>Deliverable revision requested</div>}
                  {rev.response_text && (
                    <div className="card" style={{ background: 'var(--ag-surface-2)', padding: '10px 12px' }}>
                      <div className="t-xs c-low fw-700" style={{ marginBottom: 3 }}>
                        Artist&apos;s response
                      </div>
                      <span className="t-xs c-mid">{rev.response_text}</span>
                    </div>
                  )}

                  {isArtist && !readOnly && rev.status === 'OPEN' && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: 12 }}
                      disabled={busy}
                      onClick={() => handleStartWork(rev.id)}
                    >
                      {busy ? 'Updating…' : 'Start Work'}
                    </button>
                  )}

                  {isArtist && !readOnly && rev.status === 'IN_PROGRESS' && (
                    <div style={{ marginTop: 12 }}>
                      <textarea
                        className="textarea-field"
                        value={responseDrafts[rev.id] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setResponseDrafts((prev) => ({ ...prev, [rev.id]: value }));
                          if (responseErrors[rev.id]) setResponseErrors((prev) => ({ ...prev, [rev.id]: undefined }));
                        }}
                        placeholder="Describe the revised work…"
                        rows={2}
                        style={{ marginBottom: responseErrors[rev.id] ? 6 : 10 }}
                      />
                      {responseErrors[rev.id] && (
                        <div className="field-error" style={{ marginBottom: 10 }}>
                          <Icon name="alert" style={{ width: 12, height: 12, stroke: 'var(--ag-danger)' }} />
                          <span>{responseErrors[rev.id]}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => handleSubmitResponse(rev.id)}
                      >
                        {busy ? 'Submitting…' : 'Submit Response'}
                      </button>
                    </div>
                  )}

                  {isClient && !readOnly && rev.status === 'SUBMITTED' && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: 12 }}
                      disabled={busy}
                      onClick={() => handleResolve(rev.id)}
                    >
                      {busy ? 'Updating…' : 'Mark Resolved'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {feedback && (
        <div className={`status-toast${feedback.isError ? ' is-error' : ''}`} role="status">
          {feedback.text}
        </div>
      )}
    </>
  );
}
