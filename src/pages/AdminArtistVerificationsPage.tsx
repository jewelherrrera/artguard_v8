import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { useAuth } from '../context/AuthContext';
import { useMockToast } from '../components/ui/MockToast';
import { createProtectedPathSignedUrl } from '../lib/supabaseArtworks';
import {
  approveArtistVerification,
  listPendingArtistVerifications,
  rejectArtistVerification,
  type PendingArtistVerification,
} from '../lib/supabaseData';
import './AdminArtistVerificationsPage.css';

function formatDate(value: string | null): string {
  if (!value) return 'Not available';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function AdminArtistVerificationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast, showToast } = useMockToast();
  const [applications, setApplications] = useState<PendingArtistVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [previewLoadingIds, setPreviewLoadingIds] = useState<Set<string>>(new Set());
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [selectedPreview, setSelectedPreview] = useState<{ title: string; url: string } | null>(null);

  const loadApplications = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const nextApplications = await listPendingArtistVerifications();
      setApplications(nextApplications);
      setPreviewUrls({});
      setPreviewErrors({});
      const previewTargets = nextApplications.flatMap((application) => application.artwork_references)
        .filter((artwork) => artwork.status === 'ready' && artwork.protected_storage_path);
      setPreviewLoadingIds(new Set(previewTargets.map((artwork) => artwork.id)));
      await Promise.all(previewTargets.map(async (artwork) => {
        try {
          const url = await createProtectedPathSignedUrl(artwork.protected_storage_path!);
          setPreviewUrls((current) => ({ ...current, [artwork.id]: url }));
        } catch (previewError) {
          setPreviewErrors((current) => ({
            ...current,
            [artwork.id]: previewError instanceof Error ? previewError.message : 'Preview unavailable',
          }));
        } finally {
          setPreviewLoadingIds((current) => {
            const next = new Set(current);
            next.delete(artwork.id);
            return next;
          });
        }
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load pending applications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.isAdmin !== true) {
      setLoading(false);
      return;
    }
    void loadApplications();
  }, [user?.isAdmin]);

  if (user?.isAdmin !== true) return <Navigate to="/home" replace />;

  const handleApprove = async (application: PendingArtistVerification) => {
    if (activeAction) return;
    if (!window.confirm(`Approve ${application.artist_name} as a verified Artist?`)) return;
    setActiveAction(application.artist_id);
    setError(undefined);
    try {
      await approveArtistVerification(application.artist_id);
      setApplications((current) => current.filter((item) => item.artist_id !== application.artist_id));
      setSelectedPreview(null);
      showToast(`${application.artist_name} approved`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not approve this application.');
    } finally {
      setActiveAction(null);
    }
  };

  const handleReject = async (application: PendingArtistVerification) => {
    const reason = rejectionReason.trim();
    if (!reason) {
      setError('A rejection reason is required.');
      return;
    }
    if (activeAction) return;
    setActiveAction(application.artist_id);
    setError(undefined);
    try {
      await rejectArtistVerification(application.artist_id, reason);
      setApplications((current) => current.filter((item) => item.artist_id !== application.artist_id));
      setSelectedPreview(null);
      setRejectingId(null);
      setRejectionReason('');
      showToast(`${application.artist_name} rejected`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not reject this application.');
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between">
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate('/profile/settings')} ariaLabel="Back to Settings" />
            <span className="h-title" style={{ fontSize: 19 }}>Artist Verification Review</span>
          </div>
        </div>
      }
    >
      <main className="admin-verification-page">
        {loading && <div className="card t-sm c-mid" role="status">Loading pending applications…</div>}
        {!loading && error && (
          <div className="card t-sm protection-artwork-error" role="alert">
            <div>{error}</div>
            <button type="button" className="link-sm" onClick={() => void loadApplications()}>Try again</button>
          </div>
        )}
        {!loading && !error && applications.length === 0 && (
          <div className="card t-sm c-mid admin-verification-empty" role="status">
            No pending Artist verification applications.
          </div>
        )}
        {!loading && applications.map((application) => (
          <article className="card admin-verification-card" key={application.artist_id}>
            <div className="row-between gap-10">
              <div>
                <div className="t-sm fw-700">{application.artist_name}</div>
                <div className="t-xs c-low">@{application.username}</div>
              </div>
              <span className="badge badge-warning">Pending</span>
            </div>
            <div className="admin-verification-detail">
              <div className="t-xs c-low">Submitted {formatDate(application.artist_verification_submitted_at)}</div>
              <p className="t-sm c-mid">{application.bio || 'No introduction provided.'}</p>
              <div className="admin-verification-interests">
                {application.interests.map((interest) => <span className="chip" key={interest}>{interest}</span>)}
              </div>
              {application.artwork_references.length > 0 && (
                <div className="admin-verification-artworks">
                  <div className="field-label">Artwork references</div>
                  <div className="admin-verification-artwork-grid">
                    {application.artwork_references.map((artwork) => {
                      const previewUrl = previewUrls[artwork.id];
                      const previewLoading = previewLoadingIds.has(artwork.id);
                      const previewError = previewErrors[artwork.id];
                      return (
                        <div className="admin-verification-artwork-reference" key={artwork.id}>
                          {previewUrl ? (
                            <button type="button" className="admin-verification-artwork-preview" onClick={() => setSelectedPreview({ title: artwork.title, url: previewUrl })} aria-label={`View protected preview of ${artwork.title}`}>
                              <img src={previewUrl} alt="" />
                            </button>
                          ) : (
                            <div className="admin-verification-artwork-preview unavailable" role="status">
                              <span className="t-xs c-low">{previewLoading ? 'Loading preview…' : previewError ? 'Preview unavailable' : 'Preview unavailable'}</span>
                            </div>
                          )}
                          <div className="t-xs c-hi admin-verification-artwork-title">{artwork.is_verification_sample ? 'Verification Sample · ' : ''}{artwork.title}</div>
                          <div className="t-xs c-low">{artwork.status === 'ready' ? 'Protected / Ready' : artwork.status}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {application.artwork_references.length === 0 && <div className="t-xs c-low">No sample artworks submitted</div>}
            </div>
            <div className="admin-verification-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleApprove(application)} disabled={Boolean(activeAction)}>
                {activeAction === application.artist_id && !rejectingId ? 'Approving…' : 'Approve'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRejectingId(application.artist_id); setRejectionReason(''); setError(undefined); }} disabled={Boolean(activeAction)}>
                Reject
              </button>
            </div>
            {rejectingId === application.artist_id && (
              <div className="admin-verification-reject-form">
                <label className="field-label" htmlFor={`rejection-${application.artist_id}`}>Rejection reason</label>
                <textarea
                  id={`rejection-${application.artist_id}`}
                  className="textarea-field"
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  placeholder="Explain what needs revision."
                  disabled={Boolean(activeAction)}
                />
                <div className="admin-verification-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleReject(application)} disabled={Boolean(activeAction)}>
                    {activeAction === application.artist_id ? 'Rejecting…' : 'Confirm Reject'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejectingId(null)} disabled={Boolean(activeAction)}>Cancel</button>
                </div>
              </div>
            )}
          </article>
        ))}
        {toast}
        {selectedPreview && (
          <div className="admin-verification-preview-backdrop" role="presentation" onClick={() => setSelectedPreview(null)}>
            <section className="admin-verification-preview-modal ag-liquid-glass-strong" role="dialog" aria-modal="true" aria-label={selectedPreview.title} onClick={(event) => event.stopPropagation()}>
              <div className="row-between gap-10">
                <span className="t-sm fw-700">{selectedPreview.title}</span>
                <button type="button" className="link-sm" onClick={() => setSelectedPreview(null)}>Close</button>
              </div>
              <img src={selectedPreview.url} alt={selectedPreview.title} />
              <div className="t-xs c-low">Protected derivative preview</div>
            </section>
          </div>
        )}
      </main>
    </ScreenShell>
  );
}
