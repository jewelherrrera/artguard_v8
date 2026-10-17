import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { initialsFor, listArtistProfiles, searchProfiles, type PublicProfile } from '../lib/supabaseData';
import { createCommissionRequest, getCommissionById } from '../lib/supabaseRevisions';
import { validateRequired } from '../utils/validators';
import './FindArtistPage.css';

/**
 * Real "Start a Commission" flow — only ever lists real registered
 * artist accounts (profiles.role = 'artist'), never the mock artist
 * directory. Selecting one and confirming a title calls
 * get_or_create_commission for real; there is no fake success state.
 */
export function FindArtistPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const requestedArtistId = searchParams.get('artistId');
  const preselectionApplied = useRef(false);

  const [artists, setArtists] = useState<PublicProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState<PublicProfile | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>();
  const [descriptionError, setDescriptionError] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);
  const [submittedRequest, setSubmittedRequest] = useState<{ id: string; created: boolean; snapshot?: { name: string | null; amount: number | null; currency: string | null; turnaroundDays: number | null } } | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);

  const showFeedback = (text: string, isError = false) => {
    setFeedback({ text, isError });
    window.setTimeout(() => setFeedback((f) => (f?.text === text ? null : f)), 3200);
  };

  const selectArtist = (artist: PublicProfile) => {
    setSelected(artist);
    setSubmittedRequest(null);
  };

  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    listArtistProfiles(user.id)
      .then((rows) => {
        if (active) setArtists(rows);
      })
      .catch(() => {
        if (active) setArtists([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (preselectionApplied.current || !requestedArtistId || loading || artists.length === 0) return;
    const requestedArtist = artists.find((artist) => artist.id === requestedArtistId);
    if (!requestedArtist) return;
    preselectionApplied.current = true;
    selectArtist(requestedArtist);
  }, [artists, loading, requestedArtistId]);

  useEffect(() => {
    if (!user) return;
    const term = searchTerm.trim();
    if (term.length < 2) return;
    let active = true;
    setSearching(true);
    const handle = window.setTimeout(() => {
      searchProfiles(term, user.id)
        .then((results) => {
          if (active) setArtists(results.filter((r) => r.role === 'artist'));
        })
        .catch(() => {
          if (active) setArtists([]);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [searchTerm, user]);

  const handleConfirmStart = async () => {
    if (!selected) return;
    if (selected.accepting_commissions !== true) {
      showFeedback(selected.accepting_commissions === false
        ? 'This artist is no longer accepting new commissions.'
        : 'Commission availability could not be confirmed.', true);
      return;
    }
    const nextTitleError = validateRequired(title, 'Commission title');
    const nextDescriptionError = validateRequired(description, 'Commission description');
    setTitleError(nextTitleError);
    setDescriptionError(nextDescriptionError);
    if (nextTitleError || nextDescriptionError) return;
    setStarting(true);
    try {
      const result = await createCommissionRequest(selected.id, title, description);
      const savedCommission = await getCommissionById(result.commissionId);
      setSubmittedRequest({
        id: result.commissionId,
        created: result.created,
        snapshot: savedCommission ? {
          name: savedCommission.service_name_snapshot,
          amount: savedCommission.amount,
          currency: savedCommission.currency,
          turnaroundDays: savedCommission.turnaround_days_snapshot,
        } : undefined,
      });
      showFeedback(result.created ? 'Commission request sent' : 'A commission request is already pending for this artist.');
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : '';
      showFeedback(message.includes('artist_not_accepting_commissions')
        ? 'This artist is no longer accepting new commissions.'
        : 'Could not start this commission.', true);
    } finally {
      setStarting(false);
    }
  };

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between commission-start-header">
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" />
            <span className="h-title" style={{ fontSize: 19 }}>
              Start a Commission
            </span>
          </div>
        </div>
      }
    >
      {user?.role !== 'client' ? (
        <div className="card t-sm c-mid" style={{ textAlign: 'center', padding: 24 }}>
          Only client accounts can start a new commission.
        </div>
      ) : !isSupabaseConfigured ? (
        <div className="card t-xs c-low" style={{ marginBottom: 20 }}>
          Starting a real commission needs a connected Supabase project — this preview is running in local mock
          mode.
        </div>
      ) : (
        <>
          <p className="t-xs c-low" style={{ marginBottom: 14, lineHeight: 1.5 }}>
            Pick a real registered artist to start a commission with. This creates a real record you and the artist
            will both see.
          </p>

          <div className="search-bar" style={{ marginBottom: 14 }}>
            <Icon name="search" style={{ width: 16, height: 16 }} />
            <input
              type="text"
              placeholder="Search artists by name or username…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search real registered artists"
            />
          </div>

          {selected && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="t-sm fw-700" style={{ marginBottom: 4 }}>
                Start a commission with {selected.name}
              </div>
              {selected.accepting_commissions === false && (
                <div className="t-xs c-low" role="status" style={{ marginBottom: 10 }}>
                  Not accepting new commissions
                </div>
              )}
              {selected.accepting_commissions == null && (
                <div className="t-xs c-danger" role="status" style={{ marginBottom: 10 }}>
                  Availability unavailable. New requests are disabled.
                </div>
              )}
              <label className="field-label" htmlFor="commission-title">
                Commission title
              </label>
              <div className={`input-field${titleError ? ' is-error' : ''}`} style={{ marginBottom: titleError ? 6 : 12 }}>
                <input
                  id="commission-title"
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (titleError) setTitleError(undefined);
                  }}
                  placeholder="e.g. Anime-style OC portrait"
                />
              </div>
              {titleError && (
                <div className="field-error" style={{ marginBottom: 12 }}>
                  <Icon name="alert" style={{ width: 12, height: 12, stroke: 'var(--ag-danger)' }} />
                  <span>{titleError}</span>
                </div>
              )}
              <label className="field-label" htmlFor="commission-description">
                Description / brief
              </label>
              <textarea
                id="commission-description"
                className={`textarea-field${descriptionError ? ' is-error' : ''}`}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (descriptionError) setDescriptionError(undefined);
                }}
                placeholder="Describe the artwork, style, references, and deadline."
                rows={4}
                style={{ marginBottom: descriptionError ? 6 : 12 }}
              />
              {descriptionError && <div className="field-error" style={{ marginBottom: 12 }}>{descriptionError}</div>}
              {submittedRequest && (
                <div className="card" style={{ marginBottom: 12, padding: '12px 14px' }} role="status">
                  <div className="t-sm fw-700">{submittedRequest.created ? 'Commission request sent' : 'Existing commission request'}</div>
                  <div className="t-xs c-low" style={{ marginTop: 4 }}>Status: REQUESTED</div>
                  {submittedRequest.snapshot?.name && <div className="t-xs c-mid" style={{ marginTop: 4 }}>Service: {submittedRequest.snapshot.name}</div>}
                  {submittedRequest.snapshot?.amount !== null && submittedRequest.snapshot?.amount !== undefined && submittedRequest.snapshot.currency && <div className="t-xs c-mid">Price: {submittedRequest.snapshot.currency} {submittedRequest.snapshot.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
                  {submittedRequest.snapshot?.turnaroundDays && <div className="t-xs c-mid">Turnaround: {submittedRequest.snapshot.turnaroundDays} days</div>}
                  <button type="button" className="link-sm" style={{ marginTop: 8 }} onClick={() => navigate(`/home/workspace/${submittedRequest.id}`)}>
                    View request
                  </button>
                </div>
              )}
              <div className="row gap-10">
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  disabled={starting}
                  onClick={() => {
                    setSelected(null);
                    setTitle('');
                    setDescription('');
                    setTitleError(undefined);
                    setDescriptionError(undefined);
                    setSubmittedRequest(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={starting || selected.accepting_commissions !== true}
                  onClick={() => void handleConfirmStart()}
                >
                  {starting ? 'Sending…' : 'Send Commission Request'}
                </button>
              </div>
            </div>
          )}

          {loading && <div className="t-xs c-low">Loading artists…</div>}
          {searching && <div className="t-xs c-low">Searching…</div>}
          {!loading && !searching && artists.length === 0 && (
            <div className="card t-sm c-mid" style={{ textAlign: 'center' }}>
              No registered artist accounts found.
            </div>
          )}

          {!selected &&
            artists.map((artist) => (
              <button
                key={artist.id}
                type="button"
                className="tap-card card row-between"
                style={{ padding: '10px 12px', marginBottom: 8 }}
                onClick={() => selectArtist(artist)}
              >
                <div className="row gap-10">
                  <div
                    className="avatar avatar-sm"
                    style={
                      artist.avatar_data_url
                        ? { backgroundImage: `url(${artist.avatar_data_url})`, backgroundSize: 'cover' }
                        : {}
                    }
                  >
                    {!artist.avatar_data_url && initialsFor(artist.name)}
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <div className="t-sm fw-600">{artist.name}</div>
                    <div className="t-xs c-low">@{artist.username}</div>
                  </div>
                </div>
                <Icon name="chevron-r" style={{ width: 14, height: 14, stroke: 'var(--ag-text-low)' }} />
              </button>
            ))}
        </>
      )}

      {feedback && (
        <div className={`status-toast${feedback.isError ? ' is-error' : ''}`} role="status">
          {feedback.text}
        </div>
      )}
    </ScreenShell>
  );
}
