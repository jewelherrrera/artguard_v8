import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { createArtworkProtectedSignedUrl, listMyArtworks, uploadArtwork, validateArtworkFile, type ArtworkRecord } from '../lib/supabaseArtworks';
import { submitArtistVerification } from '../lib/supabaseData';
import type { ArtistVerificationStatus } from '../types/auth';
import './ArtistVerificationPage.css';

function formatDate(value?: string): string {
  if (!value) return 'Not available';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function splitInterests(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

export function ArtistVerificationPage() {
  const navigate = useNavigate();
  const { user, backendMode, updateProfile } = useAuth();
  const [status, setStatus] = useState<ArtistVerificationStatus>(user?.artistVerificationStatus ?? 'not_started');
  const [submittedAt, setSubmittedAt] = useState(user?.artistVerificationSubmittedAt);
  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [introduction, setIntroduction] = useState(user?.bio ?? '');
  const [specialties, setSpecialties] = useState(user?.interests?.join(', ') ?? '');
  const [rejectionReason, setRejectionReason] = useState(user?.artistVerificationRejectionReason);
  const [sampleArtworkId, setSampleArtworkId] = useState(user?.artistVerificationArtworkId ?? '');
  const [samplePreviewUrl, setSamplePreviewUrl] = useState<string | undefined>();
  const [sampleUploading, setSampleUploading] = useState(false);
  const [sampleError, setSampleError] = useState<string | undefined>();
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const [artworks, setArtworks] = useState<ArtworkRecord[]>([]);
  const [loadingArtworks, setLoadingArtworks] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (user?.role !== 'artist') {
      setLoadingArtworks(false);
      return;
    }
    let active = true;
    void listMyArtworks(user.id)
      .then((records) => {
        if (active) {
          setArtworks(records);
          const selected = records.find((artwork) => artwork.id === (user?.artistVerificationArtworkId ?? ''));
          setSampleArtworkId(user?.artistVerificationArtworkId ?? '');
          if (selected?.status === 'ready' && selected.protected_storage_path) {
            void createArtworkProtectedSignedUrl(selected.id, user.id).then(setSamplePreviewUrl).catch(() => setSamplePreviewUrl(undefined));
          }
        }
      })
      .catch(() => {
        if (active) setArtworks([]);
      })
      .finally(() => {
        if (active) setLoadingArtworks(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const selectedSample = artworks.find((artwork) => artwork.id === sampleArtworkId);

  useEffect(() => {
    if (!sampleArtworkId || !user || selectedSample?.status !== 'ready' || !selectedSample.protected_storage_path) {
      if (!sampleArtworkId) setSamplePreviewUrl(undefined);
      return;
    }
    void createArtworkProtectedSignedUrl(sampleArtworkId, user.id).then(setSamplePreviewUrl).catch(() => setSamplePreviewUrl(undefined));
  }, [sampleArtworkId, selectedSample?.status, selectedSample?.protected_storage_path, user]);

  if (user?.role !== 'artist') return <Navigate to="/home" replace />;

  const canSubmit = status === 'not_started' || status === 'rejected';

  const handleSampleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const validation = validateArtworkFile(file);
    if (validation) {
      setSampleError(validation);
      return;
    }
    setSampleError(undefined);
    setSampleUploading(true);
    try {
      const uploaded = await uploadArtwork(user.id, file, 'standard');
      setArtworks((current) => [uploaded, ...current]);
      setSampleArtworkId(uploaded.id);
      setSamplePreviewUrl(await createArtworkProtectedSignedUrl(uploaded.id, user.id));
    } catch (uploadError) {
      setSampleError(uploadError instanceof Error ? uploadError.message : 'Could not upload this sample artwork.');
    } finally {
      setSampleUploading(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setSubmitted(false);
    const trimmedName = displayName.trim();
    const trimmedIntroduction = introduction.trim();
    const nextInterests = splitInterests(specialties);
    if (!trimmedName || !trimmedIntroduction || nextInterests.length === 0 || !sampleArtworkId) {
      setError('Add your display name, introduction, at least one specialty, and a ready sample artwork.');
      return;
    }

    setSubmitting(true);
    try {
      const nextSubmittedAt = new Date().toISOString();
      if (backendMode === 'supabase') {
        await submitArtistVerification(trimmedName, trimmedIntroduction, nextInterests, sampleArtworkId);
      } else {
        const result = await updateProfile({
          name: trimmedName,
          bio: trimmedIntroduction,
          interests: nextInterests,
          artistVerificationStatus: 'pending',
          artistVerificationSubmittedAt: nextSubmittedAt,
          artistVerificationArtworkId: sampleArtworkId,
        });
        if (!result.success) throw new Error(result.error ?? 'Could not submit verification.');
      }
      setStatus('pending');
      setSubmittedAt(nextSubmittedAt);
      setRejectionReason(undefined);
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit verification. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between">
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate('/profile/settings')} ariaLabel="Back to Settings" />
            <span className="h-title" style={{ fontSize: 19 }}>Artist Verification</span>
          </div>
        </div>
      }
    >
      <div className="artist-verification-page">
        {status === 'not_started' && (
          <div className="card artist-verification-intro">
            <Icon name="shield" style={{ stroke: 'var(--ag-accent)' }} />
            <div>
              <div className="t-sm fw-700">Artist verification is separate from signup</div>
              <p className="t-xs c-mid">Choosing Artist creates an artist account, but it does not automatically make you verified. Submit your details for review; the verified badge is granted only after approval.</p>
            </div>
          </div>
        )}

        {status === 'pending' && (
          <div className="card artist-verification-state" role="status">
            <Icon name="clock" style={{ stroke: 'var(--ag-warning)' }} />
            <div>
              <div className="t-sm fw-700">Pending Verification</div>
              <p className="t-xs c-mid">Your application was submitted on {formatDate(submittedAt)} and is awaiting review.</p>
            </div>
          </div>
        )}

        {status === 'verified' && (
          <div className="card artist-verification-state" role="status">
            <Icon name="check-circle" style={{ stroke: 'var(--ag-success)' }} />
            <div>
              <div className="t-sm fw-700">Verified Artist</div>
              <p className="t-xs c-mid">Your Artist account has been verified by ArtGuard.</p>
              {user.artistVerificationReviewedAt && <div className="t-xs c-low">Verified on {formatDate(user.artistVerificationReviewedAt)}</div>}
            </div>
          </div>
        )}

        {(status === 'pending' || status === 'verified') && (
          <div className="card artist-verification-sample-readonly">
            <div className="section-title">Verification Artwork</div>
            <div className="t-xs c-low">Submitted sample artwork</div>
            {selectedSample && samplePreviewUrl ? <img src={samplePreviewUrl} alt={selectedSample.title} /> : <div className="t-xs c-low">Preview unavailable</div>}
            {selectedSample && <div className="t-xs c-hi">{selectedSample.title}</div>}
          </div>
        )}

        {status === 'rejected' && (
          <div className="card artist-verification-state artist-verification-rejected" role="alert">
            <Icon name="alert" style={{ stroke: 'var(--ag-danger)' }} />
            <div>
              <div className="t-sm fw-700">Rejected / Needs Revision</div>
              <p className="t-xs c-mid">Update your application below and resubmit it for review.</p>
              {rejectionReason && <div className="t-xs c-danger">Reviewer note: {rejectionReason}</div>}
            </div>
          </div>
        )}

        {canSubmit && (
          <form className="card artist-verification-form" onSubmit={(event) => void handleSubmit(event)}>
            <div className="section-title">Verification application</div>
            <p className="t-xs c-low">Share enough context for a reviewer to understand your creative work. Do not submit government IDs or sensitive personal documents.</p>

            <label className="field-label" htmlFor="verification-display-name">Artist / display name</label>
            <input id="verification-display-name" className="input-field artist-verification-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={submitting} />

            <label className="field-label" htmlFor="verification-introduction">Short artist introduction</label>
            <textarea id="verification-introduction" className="textarea-field" value={introduction} onChange={(event) => setIntroduction(event.target.value)} disabled={submitting} placeholder="Tell reviewers what you create and how you work." />

            <label className="field-label" htmlFor="verification-specialties">Art specialties</label>
            <input id="verification-specialties" className="input-field artist-verification-input" value={specialties} onChange={(event) => setSpecialties(event.target.value)} disabled={submitting} placeholder="Illustration, anime, character design" />

            <div className="artist-verification-sample-upload">
              <div className="field-label">Verification Artwork</div>
              <div className="t-xs c-low">Upload one sample artwork that represents your work. This will be reviewed by ArtGuard Hub administrators.</div>
              <input ref={sampleInputRef} type="file" accept="image/jpeg,image/png" onChange={(event) => void handleSampleFile(event)} hidden />
              <select className="artist-verification-input" value={sampleArtworkId} onChange={(event) => { setSampleArtworkId(event.target.value); setSamplePreviewUrl(undefined); setSampleError(undefined); }} disabled={submitting || sampleUploading}>
                <option value="">Choose a ready protected artwork</option>
                {artworks.filter((artwork) => artwork.status === 'ready' && artwork.protected_storage_path).map((artwork) => <option key={artwork.id} value={artwork.id}>{artwork.title}</option>)}
              </select>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => sampleInputRef.current?.click()} disabled={submitting || sampleUploading}>
                {sampleUploading ? 'Uploading sample…' : 'Upload new sample'}
              </button>
              {sampleArtworkId && selectedSample && <div className="t-xs c-low">Selected: {selectedSample.title}</div>}
              {samplePreviewUrl && <img className="artist-verification-sample-preview" src={samplePreviewUrl} alt="Selected verification sample" />}
              {sampleError && <div className="field-error" role="alert">{sampleError}</div>}
            </div>

            {artworks.length > 0 && (
              <div className="artist-verification-samples">
                <div className="field-label">Existing artwork references</div>
                <div className="t-xs c-low">These private artwork records can support your application. They remain owner-controlled and are not made public by this form.</div>
                <div className="artist-verification-sample-list">
                  {artworks.slice(0, 5).map((artwork) => <span className="chip" key={artwork.id}>{artwork.title}</span>)}
                </div>
              </div>
            )}

            {error && <div className="field-error" role="alert"><Icon name="alert" style={{ width: 13, height: 13, stroke: 'var(--ag-danger)' }} />{error}</div>}
            {submitted && <div className="artist-verification-success" role="status">Application submitted. Your status is now pending review.</div>}
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Submitting…' : status === 'rejected' ? 'Resubmit for Review' : 'Submit for Review'}
            </button>
          </form>
        )}

        {status === 'pending' && loadingArtworks && <div className="t-xs c-low" role="status">Loading your existing artwork references…</div>}
      </div>
    </ScreenShell>
  );
}
