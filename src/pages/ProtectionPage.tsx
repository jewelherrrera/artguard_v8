import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { BottomNav } from '../components/ui/BottomNav';
import { ToggleSwitch } from '../components/ui/ToggleSwitch';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { ProtectedArtworkDisplay } from '../components/ui/ProtectedArtworkDisplay';
import { Icon } from '../assets/icons';
import { useMockToast } from '../components/ui/MockToast';
import { useAuth } from '../context/AuthContext';
import {
  ARTWORK_CATEGORIES,
  createArtworkProtectedSignedUrl,
  createArtworkOriginalSignedUrl,
  deleteArtwork,
  listMyArtworks,
  processArtworkProtection,
  updateMyArtworkMetadata,
  updateMyArtworkVisibility,
  updateArtworkProtectionLevel,
  uploadArtwork,
  type ArtworkRecord,
  type ArtworkCategory,
  type ArtworkVisibility,
} from '../lib/supabaseArtworks';
import {
  countBlockedProtectionEventsToday,
  countMyReadyProtectedWorks,
  getProtectionScanHealth,
  listMyProtectionEvents,
  listMyProtectionSettings,
  recordProtectionEvent,
  saveProtectionSettings,
  type ProtectionEvent,
  type ProtectionSettings,
  type ProtectionSettingsUpdate,
} from '../lib/supabaseProtection';
import './ProtectionPage.css';

type ProtectionLevel = 'standard' | 'enhanced' | 'maximum';

interface ShieldSetting {
  key: string;
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  subtitle: string;
}

const SETTINGS: ShieldSetting[] = [
  { key: 'cloaking', icon: 'fingerprint', title: 'Dynamic Cloaking', subtitle: 'Noise pattern on upload' },
  { key: 'tiling', icon: 'grid', title: 'Canvas Tiling Shield', subtitle: 'Encrypted chunk delivery' },
  { key: 'rightclick', icon: 'lock', title: 'Right-Click Shield', subtitle: 'Blocks direct downloads' },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatArtworkDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function protectionLabel(level: ArtworkRecord['protection_level']): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function visibilityLabel(visibility: ArtworkVisibility): string {
  if (visibility === 'portfolio') return 'Protected Portfolio';
  if (visibility === 'discover') return 'Portfolio + Discover';
  return 'Private';
}

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function eventLabel(event: ProtectionEvent): string {
  if (event.event_type === 'blocked') return 'Right-click attempt blocked';
  if (event.event_type === 'settings_updated') return 'Shield settings updated';
  if (event.event_type === 'protection_processing_started') return 'Protection processing started';
  if (event.event_type === 'protection_processing_completed') return 'Protection processing completed';
  if (event.event_type === 'protection_processing_failed') return 'Protection processing failed';
  return event.event_type.replaceAll('_', ' ');
}

function ProtectionPageContent() {
  const { toast, showToast } = useMockToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [toggles, setToggles] = useState<Record<string, boolean>>({
    cloaking: false,
    tiling: false,
    rightclick: false,
  });
  const [level, setLevel] = useState<ProtectionLevel>('enhanced');
  const [activeArtworkId, setActiveArtworkId] = useState<string | null>(null);
  const [settingsByArtwork, setSettingsByArtwork] = useState<Record<string, ProtectionSettings>>({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | undefined>();
  const [events, setEvents] = useState<ProtectionEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | undefined>();
  const [blockedToday, setBlockedToday] = useState(0);
  const [protectedWorks, setProtectedWorks] = useState(0);
  const [scanHealth, setScanHealth] = useState({ completed: 0, failed: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>();
  const [artworks, setArtworks] = useState<ArtworkRecord[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [artworksLoading, setArtworksLoading] = useState(true);
  const [artworksError, setArtworksError] = useState<string | undefined>();
  const [previewError, setPreviewError] = useState<string | undefined>();
  const [preview, setPreview] = useState<{ artwork: ArtworkRecord; url: string } | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [previewUnavailableIds, setPreviewUnavailableIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [processingArtworkId, setProcessingArtworkId] = useState<string | null>(null);
  const [editingArtwork, setEditingArtwork] = useState<{ id: string; title: string; description: string; error?: string } | null>(null);
  const [savingMetadataId, setSavingMetadataId] = useState<string | null>(null);
  const [uploadCategory, setUploadCategory] = useState<ArtworkCategory>('Other');
  const [visibilityDrafts, setVisibilityDrafts] = useState<Record<string, ArtworkVisibility>>({});
  const [visibilityErrors, setVisibilityErrors] = useState<Record<string, string>>({});
  const [savingVisibilityId, setSavingVisibilityId] = useState<string | null>(null);

  const refreshProtectionData = useCallback(async (records: ArtworkRecord[]) => {
    if (!user) {
      setActiveArtworkId(null);
      setSettingsByArtwork({});
      setEvents([]);
      setBlockedToday(0);
      setProtectedWorks(0);
      setScanHealth({ completed: 0, failed: 0 });
      return;
    }

    setSettingsLoading(true);
    setEventsLoading(true);
    setSettingsError(undefined);
    setEventsError(undefined);
    try {
      const [settings, recentEvents, blockedCount, readyCount, nextScanHealth] = await Promise.all([
        listMyProtectionSettings(user.id, records.map((artwork) => artwork.id)),
        listMyProtectionEvents(user.id),
        countBlockedProtectionEventsToday(user.id),
        countMyReadyProtectedWorks(user.id),
        getProtectionScanHealth(user.id),
      ]);
      const nextSettings = Object.fromEntries(settings.map((setting) => [setting.artwork_id, setting]));
      setSettingsByArtwork(nextSettings);
      setEvents(recentEvents);
      setBlockedToday(blockedCount);
      setProtectedWorks(readyCount);
      setScanHealth(nextScanHealth);
      const nextActiveId = records[0]?.id ?? null;
      setActiveArtworkId(nextActiveId);
      const activeSettings = nextActiveId ? nextSettings[nextActiveId] : undefined;
      setLevel(records.find((artwork) => artwork.id === nextActiveId)?.protection_level ?? 'enhanced');
      setToggles({
        cloaking: activeSettings?.dynamic_cloaking ?? false,
        tiling: activeSettings?.canvas_tiling ?? false,
        rightclick: activeSettings?.right_click_shield ?? false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load protection data.';
      setSettingsError(message);
      setEventsError(message);
    } finally {
      setSettingsLoading(false);
      setEventsLoading(false);
    }
  }, [user]);

  const refreshArtworks = useCallback(async () => {
    if (!user) {
      setArtworks([]);
      setPreviewUrls({});
      setActiveArtworkId(null);
      setSettingsByArtwork({});
      setEvents([]);
      setBlockedToday(0);
      setProtectedWorks(0);
      setScanHealth({ completed: 0, failed: 0 });
      setArtworksLoading(false);
      return;
    }

    setArtworksLoading(true);
    setArtworksError(undefined);
    setPreviewUnavailableIds(new Set());
    try {
      const records = await listMyArtworks(user.id);
      setArtworks(records);
      void refreshProtectionData(records);
      const previewEntries = await Promise.all(records.map(async (artwork) => {
        if (artwork.status !== 'ready' || !artwork.protected_storage_path) return null;
        try {
          const url = await createArtworkProtectedSignedUrl(artwork.id, user.id);
          return [artwork.id, url] as const;
        } catch {
          return null;
        }
      }));
      setPreviewUrls(Object.fromEntries(previewEntries.filter((entry): entry is readonly [string, string] => entry !== null)));
      setPreviewUnavailableIds(new Set(records
        .filter((artwork) => artwork.status === 'ready' && !previewEntries.some((entry) => entry?.[0] === artwork.id))
        .map((artwork) => artwork.id)));
    } catch (error) {
      setArtworksError(error instanceof Error ? error.message : 'Could not load your protected artworks.');
      setArtworks([]);
      setPreviewUrls({});
      setProtectedWorks(0);
    } finally {
      setArtworksLoading(false);
    }
  }, [refreshProtectionData, user]);

  useEffect(() => {
    void refreshArtworks();
  }, [refreshArtworks]);

  const handleActiveArtworkChange = (artworkId: string) => {
    setActiveArtworkId(artworkId);
    setLevel(artworks.find((artwork) => artwork.id === artworkId)?.protection_level ?? 'enhanced');
    const activeSettings = settingsByArtwork[artworkId];
    setToggles({
      cloaking: activeSettings?.dynamic_cloaking ?? false,
      tiling: activeSettings?.canvas_tiling ?? false,
      rightclick: activeSettings?.right_click_shield ?? false,
    });
    setSettingsError(undefined);
  };

  const handleToggleChange = async (key: string, checked: boolean) => {
    if (!user || !activeArtworkId || settingsSaving) return;
    const previous = toggles;
    const nextToggles = { ...toggles, [key]: checked };
    const nextSettings: ProtectionSettingsUpdate = {
      dynamic_cloaking: nextToggles.cloaking,
      canvas_tiling: nextToggles.tiling,
      right_click_shield: nextToggles.rightclick,
    };
    setToggles(nextToggles);
    setSettingsSaving(true);
    setSettingsError(undefined);
    try {
      const saved = await saveProtectionSettings(activeArtworkId, user.id, nextSettings);
      setSettingsByArtwork((current) => ({ ...current, [activeArtworkId]: saved }));
      const recentEvents = await listMyProtectionEvents(user.id);
      setEvents(recentEvents);
      showToast('Protection settings saved');
    } catch (error) {
      setToggles(previous);
      setSettingsError(error instanceof Error ? error.message : 'Could not save protection settings.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleProtectionLevelChange = async (nextLevel: ProtectionLevel) => {
    setLevel(nextLevel);
    if (!user || !activeArtworkId || processingArtworkId) return;
    const artwork = artworks.find((candidate) => candidate.id === activeArtworkId);
    if (!artwork || artwork.protection_level === nextLevel) return;

    setProcessingArtworkId(artwork.id);
    setSettingsError(undefined);
    setPreviewUnavailableIds((current) => new Set(current).add(artwork.id));
    setPreviewUrls((current) => {
      const next = { ...current };
      delete next[artwork.id];
      return next;
    });
    setArtworks((current) => current.map((candidate) => candidate.id === artwork.id
      ? { ...candidate, protection_level: nextLevel, status: 'processing', protected_storage_path: null }
      : candidate));
    try {
      const updatedArtwork = await updateArtworkProtectionLevel(artwork.id, user.id, nextLevel);
      await processArtworkProtection(user.id, updatedArtwork);
      await refreshArtworks();
      showToast('Protection level updated and artwork reprocessed');
    } catch (error) {
      await refreshArtworks();
      setSettingsError(error instanceof Error ? error.message : 'Could not reprocess this artwork.');
    } finally {
      setProcessingArtworkId(null);
    }
  };

  const handleRetryProtection = async (artwork: ArtworkRecord) => {
    if (!user || processingArtworkId) return;
    setProcessingArtworkId(artwork.id);
    setArtworksError(undefined);
    setPreviewUnavailableIds((current) => new Set(current).add(artwork.id));
    setPreviewUrls((current) => {
      const next = { ...current };
      delete next[artwork.id];
      return next;
    });
    setArtworks((current) => current.map((candidate) => candidate.id === artwork.id
      ? { ...candidate, status: 'processing', protected_storage_path: null }
      : candidate));
    try {
      await processArtworkProtection(user.id, artwork);
      await refreshArtworks();
      showToast('Protection retry completed');
    } catch (error) {
      await refreshArtworks();
      setArtworksError(error instanceof Error ? error.message : 'Could not retry protection.');
    } finally {
      setProcessingArtworkId(null);
    }
  };

  const handleContextMenuBlocked = async (artwork: ArtworkRecord) => {
    if (!user) return;
    try {
      await recordProtectionEvent(artwork.id, user.id, 'blocked', {
        action: 'contextmenu',
        protection: 'right_click_shield',
        user_agent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent.slice(0, 240),
      });
      setBlockedToday((current) => current + 1);
      setEvents(await listMyProtectionEvents(user.id));
      showToast('Right-click attempt blocked');
    } catch (error) {
      setEventsError(error instanceof Error ? error.message : 'Could not record the blocked protection event.');
    }
  };

  const trackedProcessingAttempts = scanHealth.completed + scanHealth.failed;
  const scanHealthLabel = trackedProcessingAttempts === 0
    ? '—'
    : `${Math.round((scanHealth.completed / trackedProcessingAttempts) * 100)}%`;

  const handleFileChosen = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setUploadError(undefined);
    setUploading(true);
    try {
      await uploadArtwork(user?.id ?? '', file, level, uploadCategory);
      await refreshArtworks();
      showToast(`"${file.name}" uploaded to private artwork storage`);
    } catch (error) {
      await refreshArtworks();
      setUploadError(error instanceof Error ? error.message : 'Artwork upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveVisibility = async (artwork: ArtworkRecord) => {
    if (!user || savingVisibilityId) return;
    const visibility = visibilityDrafts[artwork.id] ?? artwork.visibility ?? 'private';
    if (visibility !== 'private' && (artwork.status !== 'ready' || !artwork.protected_storage_path)) {
      setVisibilityErrors((current) => ({ ...current, [artwork.id]: 'Only ready protected artwork can be published.' }));
      return;
    }

    setSavingVisibilityId(artwork.id);
    setVisibilityErrors((current) => ({ ...current, [artwork.id]: '' }));
    try {
      const savedVisibility = await updateMyArtworkVisibility(artwork.id, visibility);
      setArtworks((current) => current.map((candidate) => candidate.id === artwork.id
        ? { ...candidate, visibility: savedVisibility }
        : candidate));
      setVisibilityDrafts((current) => ({ ...current, [artwork.id]: savedVisibility }));
    } catch (error) {
      let refreshError: unknown;
      try {
        const currentArtworks = await listMyArtworks(user.id);
        setArtworks(currentArtworks);
      } catch (errorWhileRefreshing) {
        refreshError = errorWhileRefreshing;
      }
      setVisibilityErrors((current) => ({
        ...current,
        [artwork.id]: error instanceof Error
          ? `Could not save publication setting: ${error.message}${refreshError instanceof Error ? ` Current server state could not be refreshed: ${refreshError.message}` : ''}`
          : `Could not save publication setting.${refreshError instanceof Error ? ` Current server state could not be refreshed: ${refreshError.message}` : ' Please try again.'}`,
      }));
    } finally {
      setSavingVisibilityId(null);
    }
  };

  const openArtwork = async (artwork: ArtworkRecord) => {
    setPreviewError(undefined);
    setPreviewLoadingId(artwork.id);
    try {
      const url = previewUrls[artwork.id] ?? await createArtworkOriginalSignedUrl(artwork.id, user?.id ?? '');
      setPreviewUrls((previous) => ({ ...previous, [artwork.id]: url }));
      setPreview({ artwork, url });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Could not open this artwork preview.');
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const handleDelete = async (artwork: ArtworkRecord) => {
    if (!user || deletingId) return;
    const confirmed = window.confirm(`Delete "${artwork.title}"? Its private storage file and artwork record will be removed.`);
    if (!confirmed) return;

    setDeletingId(artwork.id);
    setArtworksError(undefined);
    try {
      await deleteArtwork(artwork.id, user.id);
      if (preview?.artwork.id === artwork.id) setPreview(null);
      await refreshArtworks();
      showToast('Artwork deleted from private storage');
    } catch (error) {
      setArtworksError(error instanceof Error ? error.message : 'Could not delete this artwork.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveMetadata = async (artworkId: string) => {
    if (!editingArtwork || editingArtwork.id !== artworkId || savingMetadataId) return;
    const title = editingArtwork.title.trim();
    if (!title) {
      setEditingArtwork((current) => current ? { ...current, error: 'Title is required.' } : current);
      return;
    }

    setSavingMetadataId(artworkId);
    setEditingArtwork((current) => current ? { ...current, error: undefined } : current);
    try {
      const updatedArtwork = await updateMyArtworkMetadata(artworkId, title, editingArtwork.description);
      setArtworks((current) => current.map((artwork) => artwork.id === updatedArtwork.id ? updatedArtwork : artwork));
      setPreview((current) => current?.artwork.id === updatedArtwork.id
        ? { ...current, artwork: updatedArtwork }
        : current);
      setEditingArtwork(null);
      showToast('Artwork details updated');
    } catch {
      setEditingArtwork((current) => current?.id === artworkId
        ? { ...current, error: 'Could not save artwork details. Please try again.' }
        : current);
    } finally {
      setSavingMetadataId(null);
    }
  };

  return (
    <ScreenShell
      header={
        <div className="px-hd">
          <div className="row gap-10">
            <Icon name="shield" style={{ stroke: 'var(--ag-accent)' }} />
            <span className="h-title">Protection</span>
          </div>
        </div>
      }
      footer={<BottomNav active="shield" />}
    >
      <input
        type="file"
        accept="image/png,image/jpeg"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={(e) => void handleFileChosen(e.target.files)}
      />
      <label className="artwork-category-field">
        <span className="t-xs c-low">Artwork category</span>
        <select
          value={uploadCategory}
          onChange={(event) => setUploadCategory(event.target.value as ArtworkCategory)}
          disabled={uploading}
        >
          {ARTWORK_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>
      <button
        type="button"
        className="tap-card card ag-liquid-glass-soft"
        style={{
          border: '1.5px dashed var(--ag-border)',
          textAlign: 'center',
          padding: '26px 16px',
          marginBottom: 18,
        }}
        disabled={uploading}
        aria-busy={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'var(--ag-surface-3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 10px',
          }}
        >
          <Icon name="upload" style={{ stroke: 'var(--ag-accent)' }} />
        </div>
        <div className="t-sm fw-700" style={{ marginBottom: 3 }}>
          {uploading ? 'Uploading and protecting artwork…' : 'Drop artwork to shield'}
        </div>
        <div className="t-xs c-low">or tap to upload · JPG, PNG up to 40MB</div>
      </button>
      {uploadError && (
        <div className="card t-xs" role="alert" style={{ marginBottom: 18, color: 'var(--ag-danger)', borderColor: 'rgba(248,113,113,0.3)' }}>
          {uploadError}
        </div>
      )}

      <div className="row-between protection-section-heading">
        <span className="section-title">My Protected Artworks</span>
        <span className="t-xs c-low">{protectedWorks} stored</span>
      </div>
      {artworksLoading && (
        <div className="card t-sm c-mid protection-artwork-state" role="status">
          Loading your private artworks…
        </div>
      )}
      {!artworksLoading && artworksError && (
        <div className="card t-sm protection-artwork-state protection-artwork-error" role="alert">
          <div>{artworksError}</div>
          <button type="button" className="link-sm" onClick={() => void refreshArtworks()}>
            Try again
          </button>
        </div>
      )}
      {!artworksLoading && !artworksError && artworks.length === 0 && (
        <div className="card t-sm c-mid protection-artwork-state">
          Your uploaded artwork will appear here after it is stored privately.
        </div>
      )}
      {!artworksLoading && !artworksError && artworks.length > 0 && (
        <div className="protected-artwork-grid">
          {artworks.map((artwork) => (
            <article className="protected-artwork-card card ag-liquid-glass-soft" key={artwork.id}>
              <button
                type="button"
                className="protected-artwork-preview"
                onClick={() => void openArtwork(artwork)}
                disabled={previewLoadingId === artwork.id}
                aria-label={`Open preview of ${artwork.title}`}
              >
                {artwork.status === 'ready' && previewUrls[artwork.id] ? (
                  <ProtectedArtworkDisplay
                    src={previewUrls[artwork.id]}
                    alt={`${artwork.title} protected preview`}
                    settings={settingsByArtwork[artwork.id]}
                    onContextMenuBlocked={() => void handleContextMenuBlocked(artwork)}
                  />
                ) : (
                  <span>
                    {previewLoadingId === artwork.id
                      ? 'Loading preview…'
                      : artwork.status === 'processing'
                        ? 'Protection processing…'
                        : artwork.status === 'failed'
                          ? 'Protection failed'
                          : 'Preview unavailable'}
                  </span>
                )}
              </button>
              <div className="protected-artwork-info">
                {editingArtwork?.id === artwork.id ? (
                  <div>
                    <label className="field-label" htmlFor={`artwork-title-${artwork.id}`}>Title</label>
                    <input
                      id={`artwork-title-${artwork.id}`}
                      className="input-field"
                      value={editingArtwork.title}
                      onChange={(event) => setEditingArtwork((current) => current ? { ...current, title: event.target.value, error: undefined } : current)}
                      disabled={savingMetadataId === artwork.id}
                      style={{ marginBottom: 10 }}
                    />
                    <label className="field-label" htmlFor={`artwork-description-${artwork.id}`}>Description</label>
                    <textarea
                      id={`artwork-description-${artwork.id}`}
                      className="textarea-field"
                      value={editingArtwork.description}
                      onChange={(event) => setEditingArtwork((current) => current ? { ...current, description: event.target.value, error: undefined } : current)}
                      disabled={savingMetadataId === artwork.id}
                      rows={3}
                      style={{ marginBottom: 10 }}
                    />
                    {editingArtwork.error && <div className="t-xs c-danger" role="alert" style={{ marginBottom: 8 }}>{editingArtwork.error}</div>}
                    <div className="row gap-8">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleSaveMetadata(artwork.id)} disabled={savingMetadataId === artwork.id}>
                        {savingMetadataId === artwork.id ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingArtwork(null)} disabled={savingMetadataId === artwork.id}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="row-between gap-8">
                      <strong className="t-sm protected-artwork-title">{artwork.title}</strong>
                      <span className="badge badge-accent">{protectionLabel(artwork.protection_level)}</span>
                    </div>
                    {artwork.description && <div className="t-xs c-mid protected-artwork-meta">{artwork.description}</div>}
                    <div className="t-xs c-low protected-artwork-meta">
                      {artwork.original_filename} · {artwork.mime_type.replace('image/', '').toUpperCase()} · {formatFileSize(artwork.file_size_bytes)}
                    </div>
                    <div className="artwork-publication-control">
                      <div className="row-between gap-8">
                        <label className="t-xs c-low" htmlFor={`artwork-visibility-${artwork.id}`}>Publication</label>
                        <span className="badge badge-accent">{visibilityLabel(artwork.visibility ?? 'private')}</span>
                      </div>
                      <select
                        id={`artwork-visibility-${artwork.id}`}
                        value={visibilityDrafts[artwork.id] ?? artwork.visibility ?? 'private'}
                        onChange={(event) => {
                          setVisibilityDrafts((current) => ({
                            ...current,
                            [artwork.id]: event.target.value as ArtworkVisibility,
                          }));
                          setVisibilityErrors((current) => ({ ...current, [artwork.id]: '' }));
                        }}
                        disabled={savingVisibilityId === artwork.id}
                      >
                        <option value="private">Private</option>
                        <option value="portfolio" disabled={artwork.status !== 'ready' || !artwork.protected_storage_path}>Protected Portfolio</option>
                        <option value="discover" disabled={artwork.status !== 'ready' || !artwork.protected_storage_path}>Portfolio + Discover</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void handleSaveVisibility(artwork)}
                        disabled={
                          savingVisibilityId === artwork.id
                          || ((visibilityDrafts[artwork.id] ?? artwork.visibility ?? 'private') === (artwork.visibility ?? 'private'))
                          || ((visibilityDrafts[artwork.id] ?? artwork.visibility ?? 'private') !== 'private'
                            && (artwork.status !== 'ready' || !artwork.protected_storage_path))
                        }
                      >
                        {savingVisibilityId === artwork.id ? 'Saving…' : 'Save publication'}
                      </button>
                      {artwork.status !== 'ready' && (
                        <span className="t-xs c-low">Publishing is available after protection is ready.</span>
                      )}
                      {visibilityErrors[artwork.id] && (
                        <span className="t-xs protection-artwork-error" role="alert">{visibilityErrors[artwork.id]}</span>
                      )}
                    </div>
                    <div className="row-between protected-artwork-meta">
                      <span className="t-xs c-low">Uploaded {formatArtworkDate(artwork.created_at)}</span>
                      <span className={`t-xs${artwork.status === 'failed' || (artwork.status === 'ready' && previewUnavailableIds.has(artwork.id)) ? ' protection-artwork-error' : artwork.status === 'ready' ? ' c-success' : ' c-low'}`}>
                        {artwork.status === 'original_uploaded' ? 'Uploaded' : artwork.status === 'processing' ? 'Processing' : artwork.status === 'ready' && !previewUnavailableIds.has(artwork.id) ? 'Protected / Ready' : artwork.status === 'ready' ? 'Protected preview unavailable' : 'Protection Failed'}
                      </span>
                    </div>
                    {artwork.status === 'ready' && settingsByArtwork[artwork.id] && (
                      <div className="t-xs c-low protected-artwork-meta">
                        Delivery: {settingsByArtwork[artwork.id].canvas_tiling ? 'tiled canvas' : 'protected image'}
                        {settingsByArtwork[artwork.id].right_click_shield ? ' · right-click shield' : ''}
                      </div>
                    )}
                    <div className="protected-artwork-actions">
                      <button
                        type="button"
                        className="link-sm"
                        onClick={() => setEditingArtwork({ id: artwork.id, title: artwork.title, description: artwork.description ?? '' })}
                        disabled={savingMetadataId !== null || deletingId === artwork.id}
                      >
                        Edit
                      </button>
                      {artwork.status === 'failed' && (
                        <button type="button" className="link-sm" onClick={() => void handleRetryProtection(artwork)} disabled={processingArtworkId === artwork.id || deletingId === artwork.id}>
                          {processingArtworkId === artwork.id ? 'Retrying…' : 'Retry protection'}
                        </button>
                      )}
                      <button type="button" className="link-sm protected-artwork-delete" onClick={() => void handleDelete(artwork)} disabled={deletingId === artwork.id || processingArtworkId === artwork.id}>
                        {deletingId === artwork.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {previewError && <div className="card t-xs protection-artwork-error" role="alert">{previewError}</div>}
      {preview && (
        <div className="protected-artwork-modal-backdrop" role="presentation" onClick={() => setPreview(null)}>
          <section className="protected-artwork-modal ag-liquid-glass-strong" role="dialog" aria-modal="true" aria-label={preview.artwork.title} onClick={(event) => event.stopPropagation()}>
            <div className="row-between gap-10" style={{ marginBottom: 12 }}>
              <span className="t-sm fw-700">{preview.artwork.title}</span>
              <button type="button" className="link-sm" onClick={() => setPreview(null)}>Close</button>
            </div>
            <img src={preview.url} alt={preview.artwork.title} />
            <div className="t-xs c-low" style={{ marginTop: 10 }}>Authorized preview link expires shortly.</div>
          </section>
        </div>
      )}

      <div className="row-between" style={{ marginBottom: 12 }}>
        <span className="section-title">Shield Settings</span>
      </div>
      {artworks.length > 0 && (
        <label className="t-xs c-low" style={{ display: 'block', marginBottom: 10 }}>
          Artwork
          <select
            value={activeArtworkId ?? ''}
            onChange={(event) => handleActiveArtworkChange(event.target.value)}
            disabled={settingsLoading || settingsSaving || Boolean(processingArtworkId)}
            style={{ display: 'block', width: '100%', marginTop: 6, padding: '9px 10px', color: 'var(--ag-text-hi)', background: 'var(--ag-surface-2)', border: '1px solid var(--ag-border)', borderRadius: 'var(--ag-r-sm)' }}
          >
            {artworks.map((artwork) => <option value={artwork.id} key={artwork.id}>{artwork.title}</option>)}
          </select>
        </label>
      )}
      {settingsLoading && <div className="t-xs c-low" role="status" style={{ marginBottom: 10 }}>Loading saved shield settings…</div>}
      {settingsError && <div className="card t-xs protection-artwork-error" role="alert" style={{ marginBottom: 10 }}>{settingsError}</div>}
      {artworks.length === 0 && <div className="t-xs c-low" style={{ marginBottom: 10 }}>Upload an artwork to configure its protection settings.</div>}
      {SETTINGS.map((setting, i) => (
        <div className="card" key={setting.key} style={{ marginBottom: i === SETTINGS.length - 1 ? 10 : 10, padding: '14px 16px' }}>
          <div className="row-between">
            <div className="row gap-10">
              <Icon name={setting.icon} style={{ width: 17, height: 17, stroke: 'var(--ag-accent)' }} />
              <div>
                <div className="t-sm fw-600">{setting.title}</div>
                <div className="t-xs c-low">{setting.subtitle}</div>
              </div>
            </div>
            <ToggleSwitch
              checked={toggles[setting.key]}
              onChange={(checked) => void handleToggleChange(setting.key, checked)}
              ariaLabel={setting.title}
            />
          </div>
        </div>
      ))}

      <div className="row-between" style={{ margin: '10px 0' }}>
        <span className="section-title">Protection Level</span>
      </div>
      <div style={{ marginBottom: 20 }}>
        <SegmentedControl
          ariaLabel="Protection level"
          value={level}
          onChange={(nextLevel: ProtectionLevel) => void handleProtectionLevelChange(nextLevel)}
          options={[
            { value: 'standard', label: 'Standard' },
            { value: 'enhanced', label: 'Enhanced' },
            { value: 'maximum', label: 'Maximum' },
          ]}
        />
      </div>

      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="section-title">Security Snapshot</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <div className="card" style={{ flex: 1, padding: 12, textAlign: 'center' }}>
          <div className="mono fw-700" style={{ fontSize: 17, color: 'var(--ag-danger)' }}>
            {blockedToday}
          </div>
          <div className="t-xs c-low">Blocked today</div>
        </div>
        <div className="card" style={{ flex: 1, padding: 12, textAlign: 'center' }}>
          <div className="mono fw-700" style={{ fontSize: 17 }}>
            {protectedWorks}
          </div>
          <div className="t-xs c-low">Protected works</div>
        </div>
        <div className="card" style={{ flex: 1, padding: 12, textAlign: 'center' }}>
          <div className="mono fw-700" style={{ fontSize: 17, color: 'var(--ag-success)' }}>
            {scanHealthLabel}
          </div>
          <div className="t-xs c-low">Scan health</div>
        </div>
      </div>

      <div className="section-title" style={{ marginBottom: 10 }}>
        Recent Scan Log
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 6 }}>
        {eventsLoading && <div className="t-xs c-low" role="status">Loading recent protection events…</div>}
        {!eventsLoading && eventsError && <div className="t-xs protection-artwork-error" role="alert">{eventsError}</div>}
        {!eventsLoading && !eventsError && events.length === 0 && <div className="t-xs c-low">No protection events have been recorded yet.</div>}
        {!eventsLoading && !eventsError && events.map((entry) => (
          <div className="row gap-10" key={entry.id}>
            <Icon
              name={entry.event_type === 'blocked' || entry.event_type === 'protection_processing_failed' ? 'alert' : 'check-circle'}
              style={{ width: 15, height: 15, stroke: entry.event_type === 'blocked' || entry.event_type === 'protection_processing_failed' ? 'var(--ag-danger)' : 'var(--ag-success)' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t-xs c-hi fw-600">{eventLabel(entry)}</div>
              <div className="t-xs c-low">{artworks.find((artwork) => artwork.id === entry.artwork_id)?.title ?? 'Artwork'} · {formatEventDate(entry.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
      {toast}
    </ScreenShell>
  );
}

export function ProtectionPage() {
  const { user } = useAuth();
  if (user?.role !== 'artist') return <Navigate to="/home" replace />;
  return <ProtectionPageContent />;
}
