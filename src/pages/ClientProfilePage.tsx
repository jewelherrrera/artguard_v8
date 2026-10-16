import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { BottomNav } from '../components/ui/BottomNav';
import { IconButton } from '../components/ui/IconButton';
import { Icon } from '../assets/icons';
import {
  CommissionPostForm,
  commissionPostDraftFromPost,
  EMPTY_COMMISSION_POST_DRAFT,
  validateCommissionPostDraft,
  type CommissionPostDraft,
} from '../components/CommissionPostForm';
import { useAuth } from '../context/AuthContext';
import { CLIENT_COMMISSION_REQUESTS } from '../data/mockData';
import type { CommissionRequest } from '../data/mockData';
import { useMockToast } from '../components/ui/MockToast';
import { usernameFromEmail } from '../lib/supabaseData';
import { isSupabaseConfigured } from '../lib/supabase';
import './MarketplacePage.css';
import './ClientProfilePage.css';
import { listMyCommissions, type MyCommission } from '../lib/supabaseRevisions';
import {
  createCommissionPost,
  deleteCommissionPost,
  listCommissionPostComments,
  listCommissionPostEngagementSummaries,
  listPostApplicationsForOwner,
  listMyCommissionPosts,
  rejectCommissionPostApplication,
  selectCommissionPostApplicant,
  type CommissionPostComment,
  type CommissionPostEngagementSummary,
  type OwnerCommissionPostApplication,
  updateCommissionPost,
  type CommissionPost,
  type CommissionPostStatus,
} from '../lib/supabaseCommissionPosts';

const PUBLIC_POST_STATUS: Record<Exclude<CommissionPostStatus, 'CANCELLED'>, { label: string; badge: string }> = {
  OPEN: { label: 'OPEN', badge: 'badge-success' },
  CLOSED: { label: 'CLOSED', badge: 'badge-accent' },
  SELECTED: { label: 'SELECTED', badge: 'badge-warning' },
};

function formatBudgetRange(post: CommissionPost): string | null {
  const format = (amount: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount);
  if (post.budget_min === null && post.budget_max === null) return null;
  if (post.budget_min !== null && post.budget_max !== null) {
    return `${format(post.budget_min)} – ${format(post.budget_max)}${post.currency ? ` ${post.currency}` : ''}`;
  }
  if (post.budget_min !== null) {
    return `From ${format(post.budget_min)}${post.currency ? ` ${post.currency}` : ''}`;
  }
  if (post.budget_max !== null) {
    return `Up to ${format(post.budget_max)}${post.currency ? ` ${post.currency}` : ''}`;
  }
  return null;
}

function formatPostedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString();
}

const STATUS_LABEL: Record<CommissionRequest['status'], { label: string; badge: string }> = {
  open: { label: 'Open', badge: 'badge-success' },
  'in-review': { label: 'In review', badge: 'badge-warning' },
  booked: { label: 'Booked', badge: 'badge-accent' },
};

const COMMISSION_STATUS_BADGE: Record<MyCommission['status'], string> = {
  REQUESTED: 'badge-warning',
  ACCEPTED: 'badge-accent',
  REJECTED: 'badge-danger',
  IN_PROGRESS: 'badge-warning',
  REVISION_REQUESTED: 'badge-warning',
  COMPLETED: 'badge-success',
  CANCELLED: 'badge-danger',
};

function formatCommissionAmount(commission: MyCommission): string | null {
  if (commission.amount === null) return null;
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(commission.amount);
  return `${amount}${commission.currency ? ` ${commission.currency}` : ''}`;
}

export function ClientProfilePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast, showToast } = useMockToast();
  const isRealClient = isSupabaseConfigured && user?.role === 'client';

  const [requests, setRequests] = useState<CommissionRequest[]>(CLIENT_COMMISSION_REQUESTS);
  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [realTab, setRealTab] = useState<'direct' | 'public'>('direct');
  const [publicPosts, setPublicPosts] = useState<CommissionPost[]>([]);
  const [directRequests, setDirectRequests] = useState<MyCommission[]>([]);
  const [allDirectRequestsOpen, setAllDirectRequestsOpen] = useState(false);
  const deletedPublicPostIdsRef = useRef<{ ownerId: string | null; ids: Set<string> }>({
    ownerId: null,
    ids: new Set(),
  });
  const [publicPostsLoading, setPublicPostsLoading] = useState(true);
  const [directRequestsLoading, setDirectRequestsLoading] = useState(true);
  const [publicPostsLoadError, setPublicPostsLoadError] = useState(false);
  const [publicPostsEngagementError, setPublicPostsEngagementError] = useState(false);
  const [directRequestsLoadError, setDirectRequestsLoadError] = useState(false);
  const [publicPostForm, setPublicPostForm] = useState<CommissionPostDraft>(EMPTY_COMMISSION_POST_DRAFT);
  const [publicPostFormOpen, setPublicPostFormOpen] = useState(false);
  const [editingPublicPostId, setEditingPublicPostId] = useState<string | null>(null);
  const [publicPostFormError, setPublicPostFormError] = useState<string | null>(null);
  const [savingPublicPost, setSavingPublicPost] = useState(false);
  const [publicPostEngagement, setPublicPostEngagement] = useState<Record<string, CommissionPostEngagementSummary>>({});
  const [openPublicPostMenuId, setOpenPublicPostMenuId] = useState<string | null>(null);
  const [selectedPublicPost, setSelectedPublicPost] = useState<CommissionPost | null>(null);
  const [profilePostApplications, setProfilePostApplications] = useState<OwnerCommissionPostApplication[]>([]);
  const [selectingProfileApplication, setSelectingProfileApplication] = useState<OwnerCommissionPostApplication | null>(null);
  const [profileSelectionAmount, setProfileSelectionAmount] = useState('');
  const [profileSelectionCurrency, setProfileSelectionCurrency] = useState('');
  const [profileSelectionError, setProfileSelectionError] = useState<string | null>(null);
  const [profileSelectionLoading, setProfileSelectionLoading] = useState(false);
  const [rejectingProfileApplicationId, setRejectingProfileApplicationId] = useState<string | null>(null);
  const [profilePostComments, setProfilePostComments] = useState<CommissionPostComment[]>([]);
  const [profilePostDetailsLoading, setProfilePostDetailsLoading] = useState(false);
  const [profilePostDetailsError, setProfilePostDetailsError] = useState<string | null>(null);
  const [deletingPublicPostId, setDeletingPublicPostId] = useState<string | null>(null);
  const [pendingPublicPostDelete, setPendingPublicPostDelete] = useState<CommissionPost | null>(null);
  const [publicPostDeleteError, setPublicPostDeleteError] = useState<string | null>(null);
  const profilePostDeleteInFlight = useRef(false);

  const initials = (user?.name || 'C').slice(0, 1).toUpperCase();
  const visiblePublicPosts = publicPosts.filter(
    (post): post is CommissionPost & { status: Exclude<CommissionPostStatus, 'CANCELLED' | 'SELECTED'> } =>
      post.status !== 'CANCELLED'
      && post.status !== 'SELECTED'
      && !deletedPublicPostIdsRef.current.ids.has(post.id),
  );

  useEffect(() => {
    let active = true;
    setPublicPosts([]);
    setPublicPostEngagement({});
    setPublicPostsEngagementError(false);
    setSelectedPublicPost(null);
    setProfilePostApplications([]);
    setProfilePostComments([]);
    setDirectRequests([]);
    setDirectRequestsLoadError(false);
    if (!isRealClient || !user?.id) {
      setPublicPostsLoading(false);
      return () => { active = false; };
    }
    if (deletedPublicPostIdsRef.current.ownerId !== user.id) {
      deletedPublicPostIdsRef.current = { ownerId: user.id, ids: new Set() };
    }

    setPublicPostsLoading(true);
    setPublicPostsLoadError(false);
    void listMyCommissionPosts()
      .then(async (posts) => {
        const visiblePosts = posts.filter((post) =>
          post.status !== 'CANCELLED'
          && post.status !== 'SELECTED'
          && !deletedPublicPostIdsRef.current.ids.has(post.id),
        );
        if (active) setPublicPosts(visiblePosts);
        try {
          const summaries = await listCommissionPostEngagementSummaries(visiblePosts.map((post) => post.id));
          const summariesById = new Map(summaries.map((summary) => [summary.commission_post_id, summary]));
          if (visiblePosts.some((post) => !summariesById.has(post.id))) {
            throw new Error('Engagement summaries were not returned for every visible post.');
          }
          if (active) setPublicPostEngagement(Object.fromEntries(summaries.map((summary) => [summary.commission_post_id, summary])));
        } catch {
          if (active) setPublicPostsEngagementError(true);
        }
      })
      .catch(() => {
        if (active) setPublicPostsLoadError(true);
      })
      .finally(() => {
        if (active) setPublicPostsLoading(false);
      });

    setDirectRequestsLoading(true);
    setDirectRequestsLoadError(false);
    setDirectRequests([]);
    void listMyCommissions(user.id)
      .then((commissions) => {
        if (active) {
          setDirectRequests(
            commissions
              .filter((commission) => commission.isClient)
              .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)),
          );
        }
      })
      .catch(() => {
        if (active) setDirectRequestsLoadError(true);
      })
      .finally(() => {
        if (active) setDirectRequestsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isRealClient, user?.id]);

  useEffect(() => {
    if (!openPublicPostMenuId) return;
    const closeMenu = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.commission-post-menu-wrap')) {
        setOpenPublicPostMenuId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPublicPostMenuId(null);
    };
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openPublicPostMenuId]);

  const resetPublicPostForm = () => {
    setPublicPostForm(EMPTY_COMMISSION_POST_DRAFT);
    setPublicPostFormOpen(false);
    setEditingPublicPostId(null);
    setPublicPostFormError(null);
  };

  const handlePublicPostSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPublicPostFormError(null);
    const validated = validateCommissionPostDraft(publicPostForm);
    if (typeof validated === 'string') {
      setPublicPostFormError(validated);
      return;
    }

    setSavingPublicPost(true);
    try {
      if (editingPublicPostId) {
        const updated = await updateCommissionPost(editingPublicPostId, validated);
        setPublicPosts((current) => current.map((post) => post.id === updated.id ? updated : post));
        setSelectedPublicPost((current) => current?.id === updated.id ? updated : current);
        showToast('Public request updated');
      } else {
        const created = await createCommissionPost(validated);
        setPublicPosts((current) => [created, ...current]);
        setPublicPostEngagement((current) => ({
          ...current,
          [created.id]: { commission_post_id: created.id, comment_count: 0, application_count: 0 },
        }));
        showToast('Public request posted');
      }
      resetPublicPostForm();
    } catch (error) {
      setPublicPostFormError(error instanceof Error ? error.message : 'Could not save this public request.');
    } finally {
      setSavingPublicPost(false);
    }
  };

  const openPublicPostDetails = async (post: CommissionPost) => {
    setSelectedPublicPost(post);
    setProfilePostApplications([]);
    setProfilePostComments([]);
    setSelectingProfileApplication(null);
    setProfileSelectionError(null);
    setProfilePostDetailsError(null);
    setProfilePostDetailsLoading(true);
    try {
      const [applications, comments] = await Promise.all([
        listPostApplicationsForOwner(post.id),
        listCommissionPostComments(post.id),
      ]);
      setProfilePostApplications(applications);
      setProfilePostComments(comments);
    } catch (error) {
      setProfilePostDetailsError(error instanceof Error ? error.message : 'Could not load this request’s details.');
    } finally {
      setProfilePostDetailsLoading(false);
    }
  };

  const handleRejectProfileApplication = async (application: OwnerCommissionPostApplication) => {
    if (!selectedPublicPost || selectedPublicPost.status !== 'OPEN'
      || application.status !== 'PENDING' || rejectingProfileApplicationId) return;
    setRejectingProfileApplicationId(application.id);
    setProfilePostDetailsError(null);
    try {
      const rejected = await rejectCommissionPostApplication(application.id);
      setProfilePostApplications((current) => current.map((item) => item.id === rejected.id
        ? { ...item, status: rejected.status, updated_at: rejected.updated_at }
        : item));
    } catch {
      setProfilePostDetailsError('Could not reject this request. Please try again.');
    } finally {
      setRejectingProfileApplicationId(null);
    }
  };

  const handleAcceptProfileApplication = async () => {
    const post = selectedPublicPost;
    const application = selectingProfileApplication;
    if (!post || post.status !== 'OPEN' || !application || application.status !== 'PENDING' || profileSelectionLoading) return;
    const amount = Number(profileSelectionAmount);
    const currency = profileSelectionCurrency.trim().toUpperCase();
    if (!profileSelectionAmount.trim() || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) / 100 !== amount) {
      setProfileSelectionError('Enter a final agreed amount greater than zero with no more than two decimal places.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      setProfileSelectionError('Currency must be exactly three uppercase letters.');
      return;
    }
    if (post.currency && currency !== post.currency) {
      setProfileSelectionError(`Currency must match the post currency (${post.currency}).`);
      return;
    }
    if (post.budget_min !== null && amount < post.budget_min) {
      setProfileSelectionError(`Final agreed amount must be at least ${post.budget_min}.`);
      return;
    }
    if (post.budget_max !== null && amount > post.budget_max) {
      setProfileSelectionError(`Final agreed amount cannot exceed ${post.budget_max}.`);
      return;
    }

    setProfileSelectionLoading(true);
    setProfileSelectionError(null);
    try {
      await selectCommissionPostApplicant(post.id, application.id, amount, currency);
      const selected = { ...post, status: 'SELECTED' as const };
      setPublicPosts((current) => current.map((item) => item.id === post.id ? selected : item));
      setSelectedPublicPost(null);
      setProfilePostApplications((current) => current.map((item) => ({
        ...item,
        status: item.id === application.id ? 'SELECTED' : item.status === 'PENDING' ? 'REJECTED' : item.status,
      })));
      setSelectingProfileApplication(null);
      showToast('Artist selected. Commission request created.');
    } catch {
      setProfileSelectionError('Could not accept this request. Refresh the post and try again.');
    } finally {
      setProfileSelectionLoading(false);
    }
  };

  const handleDeletePublicPost = async () => {
    const post = pendingPublicPostDelete;
    if (!post || !user || post.owner_id !== user.id || post.owner_role !== user.role
      || post.status !== 'OPEN' || profilePostDeleteInFlight.current) return;
    profilePostDeleteInFlight.current = true;
    setDeletingPublicPostId(post.id);
    setPublicPostDeleteError(null);
    try {
      await deleteCommissionPost(post.id);
      if (deletedPublicPostIdsRef.current.ownerId !== user.id) {
        deletedPublicPostIdsRef.current = { ownerId: user.id, ids: new Set() };
      }
      deletedPublicPostIdsRef.current.ids.add(post.id);
      setPublicPosts((current) => current.filter((item) =>
        item.id !== post.id && !deletedPublicPostIdsRef.current.ids.has(item.id),
      ));
      setPublicPostEngagement((current) => {
        const next = { ...current };
        delete next[post.id];
        return next;
      });
      setOpenPublicPostMenuId(null);
      setPendingPublicPostDelete(null);
      setSelectedPublicPost((current) => current?.id === post.id ? null : current);
      if (selectedPublicPost?.id === post.id) {
        setProfilePostApplications([]);
        setProfilePostComments([]);
        setSelectingProfileApplication(null);
        setProfileSelectionError(null);
        setProfilePostDetailsError(null);
        setProfilePostDetailsLoading(false);
      }
      showToast('Public request deleted');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setPublicPostDeleteError(message.includes('POST_HAS_COMMISSION')
        ? 'This request cannot be deleted because a commission was created from it.'
        : message.includes('POST_NOT_OPEN')
          ? 'This request can no longer be deleted because it is no longer open.'
        : 'Could not delete this request. Please try again.');
    } finally {
      profilePostDeleteInFlight.current = false;
      setDeletingPublicPostId(null);
    }
  };

  const handlePost = (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const entry: CommissionRequest = {
      id: `req-${Date.now()}`,
      title: newTitle.trim(),
      description: newDescription.trim() || 'No additional details provided.',
      budgetLabel: 'Budget TBD',
      status: 'open',
      createdLabel: 'Posted just now',
    };
    setRequests((prev) => [entry, ...prev]);
    setNewTitle('');
    setNewDescription('');
    setComposing(false);
    showToast('Commission request posted (mock)');
  };

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between">
          <span className="h-title">My Profile</span>
          <IconButton icon="dots" onClick={() => navigate('/profile/settings')} ariaLabel="Settings" />
        </div>
      }
      footer={<BottomNav active="profile" />}
    >
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div
          className="avatar avatar-xl"
          style={{
            margin: '0 auto 10px',
            background: 'var(--ag-grad-accent)',
            backgroundImage: user?.avatarDataUrl ? `url(${user.avatarDataUrl})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {!user?.avatarDataUrl && initials}
        </div>
        <div style={{ fontSize: 19, fontWeight: 700 }}>{user?.name || 'Client'}</div>
        <div className="t-xs c-low" style={{ marginBottom: 10 }}>
          @{usernameFromEmail(user?.email)}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" style={{ margin: '0 auto' }} onClick={() => navigate('/profile/edit')}>
          Edit Profile
        </button>
      </div>

      {user?.bio && (
        <p className="t-xs c-mid card" style={{ lineHeight: 1.6, marginBottom: 20, padding: '12px 14px' }}>
          {user.bio}
        </p>
      )}

      {isRealClient ? (
        <>
          <div className="client-profile-request-heading">
            <span className="section-title">My Commission Requests</span>
            <div className="client-profile-request-header-actions">
              {realTab === 'direct' && directRequests.length > 3 && (
                <button
                  type="button"
                  className="link-sm tap-card client-profile-see-all"
                  onClick={() => setAllDirectRequestsOpen(true)}
                >
                  See All
                </button>
              )}
              {realTab === 'public' && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm client-profile-new-request"
                  onClick={() => {
                    if (editingPublicPostId) {
                      resetPublicPostForm();
                      return;
                    }
                    setEditingPublicPostId(null);
                    setPublicPostForm(EMPTY_COMMISSION_POST_DRAFT);
                    setPublicPostFormError(null);
                    setPublicPostFormOpen((open) => !open);
                  }}
                >
                  {publicPostFormOpen ? 'Cancel' : 'NEW POST'}
                </button>
              )}
            </div>
          </div>
          <div className="row gap-10" role="tablist" aria-label="Commission request types" style={{ marginBottom: 14 }}>
            <button type="button" className={`btn btn-sm ${realTab === 'direct' ? 'btn-primary' : 'btn-ghost'}`} role="tab" aria-selected={realTab === 'direct'} onClick={() => { setRealTab('direct'); resetPublicPostForm(); }}>
              Direct Requests
            </button>
            <button type="button" className={`btn btn-sm ${realTab === 'public' ? 'btn-primary' : 'btn-ghost'}`} role="tab" aria-selected={realTab === 'public'} onClick={() => setRealTab('public')}>
              Public Posts
            </button>
          </div>

          {realTab === 'direct' ? (
            directRequestsLoading ? (
              <div className="card t-sm c-mid" role="status">Loading direct requests...</div>
            ) : directRequestsLoadError ? (
              <div className="card t-sm c-mid" role="alert">Could not load your direct commission requests.</div>
            ) : directRequests.length === 0 ? (
              <div className="card t-sm c-mid">No direct commission requests yet.</div>
            ) : (
              <div className="stack-grid client-profile-direct-request-preview">
                {directRequests.slice(0, 3).map((commission) => (
                  <article className="card client-profile-direct-request-card" key={commission.id}>
                    <div className="client-profile-direct-request-heading">
                      <span className="t-sm fw-700 client-profile-direct-request-title">{commission.title}</span>
                      <span className={`badge ${COMMISSION_STATUS_BADGE[commission.status]}`}>{commission.status.replaceAll('_', ' ')}</span>
                    </div>
                    {commission.description && <p className="t-xs c-mid client-profile-direct-request-description">{commission.description}</p>}
                    <div className="client-profile-direct-request-meta">
                      <span className="t-xs c-low">With {commission.counterparty?.name ?? 'Artist profile unavailable'}</span>
                      <span className="t-xs c-low">{formatPostedDate(commission.created_at)}</span>
                    </div>
                    {formatCommissionAmount(commission) && (
                      <div className="t-xs fw-600 client-profile-direct-request-amount">{formatCommissionAmount(commission)}</div>
                    )}
                  </article>
                ))}
              </div>
            )
          ) : (
            <>
              {publicPostFormOpen && (
                <CommissionPostForm
                  form={publicPostForm}
                  heading={editingPublicPostId ? 'Edit Public Request' : 'New Public Request'}
                  submitLabel={editingPublicPostId ? 'Save Changes' : 'Post Request'}
                  error={publicPostFormError}
                  saving={savingPublicPost}
                  onChange={(field, value) => setPublicPostForm((current) => ({ ...current, [field]: value }))}
                  onSubmit={(event) => void handlePublicPostSubmit(event)}
                  onCancel={resetPublicPostForm}
                />
              )}

              {publicPostsLoading ? (
                <div className="card t-sm c-mid" role="status">Loading public requests...</div>
              ) : publicPostsLoadError ? (
                <div className="card t-sm c-mid" role="alert">Could not load your public commission requests.</div>
              ) : visiblePublicPosts.length === 0 ? (
                <div className="card t-sm c-mid client-profile-public-post-empty">
                  No public commission requests yet.
                </div>
              ) : (
                <>
                  {publicPostsEngagementError && (
                    <div className="t-xs c-low commission-engagement-unavailable" role="status">
                      Engagement counts are temporarily unavailable.
                    </div>
                  )}
                  <div className="stack-grid">
                    {visiblePublicPosts.map((post) => {
                      const engagement = publicPostEngagement[post.id];
                      const isPostOwner = Boolean(user && post.owner_id === user.id && post.owner_role === user.role);
                      return (
                        <article className="commission-post-card" key={post.id}>
                          <div className="commission-post-card-header">
                            <div className="commission-post-author">
                              <div
                                className="avatar avatar-md commission-post-avatar"
                                style={user?.avatarDataUrl ? { backgroundImage: `url(${user.avatarDataUrl})` } : undefined}
                              >
                                {!user?.avatarDataUrl && initials}
                              </div>
                              <div className="commission-post-author-copy">
                                <div className="t-sm fw-700 commission-post-author-name">{user?.name || 'Client'}</div>
                                <div className="t-xs c-low">@{usernameFromEmail(user?.email)} · Client · {formatPostedDate(post.created_at)}</div>
                              </div>
                            </div>
                            {isPostOwner && post.status === 'OPEN' && (
                              <div className="commission-post-menu-wrap">
                                <IconButton
                                  icon="dots"
                                  ariaLabel={`Options for ${post.title}`}
                                  onClick={() => setOpenPublicPostMenuId((current) => current === post.id ? null : post.id)}
                                />
                                {openPublicPostMenuId === post.id && (
                                  <div className="card commission-post-menu" role="menu">
                                    <button
                                      type="button"
                                      className="commission-post-menu-item"
                                      role="menuitem"
                                      onClick={() => {
                                        setEditingPublicPostId(post.id);
                                        setPublicPostForm(commissionPostDraftFromPost(post));
                                        setPublicPostFormError(null);
                                        setPublicPostFormOpen(true);
                                        setOpenPublicPostMenuId(null);
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="commission-post-menu-item c-danger"
                                      role="menuitem"
                                      onClick={() => {
                                        setPendingPublicPostDelete(post);
                                        setPublicPostDeleteError(null);
                                        setOpenPublicPostMenuId(null);
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                            {post.status !== 'OPEN' && (
                              <span className={`badge ${PUBLIC_POST_STATUS[post.status].badge}`}>{PUBLIC_POST_STATUS[post.status].label}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="client-profile-public-post-title"
                            onClick={() => void openPublicPostDetails(post)}
                          >
                            {post.title}
                          </button>
                          <p className="commission-post-description">{post.description}</p>
                          <div className="commission-post-budget">{formatBudgetRange(post) ?? 'Budget not specified'}</div>
                          <div className="commission-post-engagement" aria-label="Post engagement">
                            <button
                              type="button"
                              className="commission-post-comment-count"
                              aria-label={`Comments for ${post.title}: ${engagement ? engagement.comment_count : 'count unavailable'}`}
                              onClick={() => void openPublicPostDetails(post)}
                            >
                              <Icon name="chat" />{engagement ? engagement.comment_count : '—'}
                            </button>
                            <button
                              type="button"
                              className="commission-post-comment-count"
                              aria-label={`View requests for ${post.title}${engagement ? `: ${engagement.application_count} requests` : ''}`}
                              title="View requests"
                              onClick={() => void openPublicPostDetails(post)}
                            >
                              <Icon name="user" />
                              {engagement && engagement.application_count > 0 ? engagement.application_count : ''}
                            </button>
                          </div>
                          <div className="commission-post-meta">
                            <span className="badge badge-accent">{PUBLIC_POST_STATUS[post.status].label}</span>
                            <span className="t-xs c-low">Posted {formatPostedDate(post.created_at)}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <span className="section-title">My Commission Requests</span>
            <div className="client-profile-request-header-actions">
              {requests.length > 3 && (
                <button
                  type="button"
                  className="link-sm tap-card client-profile-see-all"
                  onClick={() => setAllDirectRequestsOpen(true)}
                >
                  See All
                </button>
              )}
              <button
                type="button"
                className="link-sm tap-card"
                style={{ width: 'auto' }}
                onClick={() => setComposing((c) => !c)}
              >
                {composing ? 'Cancel' : '+ New Request'}
              </button>
            </div>
          </div>

          {composing && (
            <form onSubmit={handlePost} className="card" style={{ marginBottom: 14 }}>
              <label className="field-label" htmlFor="req-title">
                Title
              </label>
              <div className="input-field" style={{ marginBottom: 12 }}>
                <Icon name="plus" style={{ width: 15, height: 15, stroke: 'var(--ag-text-low)' }} />
                <input
                  id="req-title"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Fantasy OC full body"
                />
              </div>
              <label className="field-label" htmlFor="req-desc">
                Details
              </label>
              <textarea
                id="req-desc"
                className="textarea-field"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Style, references, deadline…"
                rows={3}
                style={{ marginBottom: 14 }}
              />
              <button type="submit" className="btn btn-primary">
                Post Request
              </button>
            </form>
          )}

          <div className="stack-grid client-profile-direct-request-preview">
            {requests.slice(0, 3).map((req) => (
              <div className="card" key={req.id}>
                <div className="client-profile-direct-request-heading">
                  <span className="t-sm fw-700 client-profile-direct-request-title">{req.title}</span>
                  <span className={`badge ${STATUS_LABEL[req.status].badge}`}>{STATUS_LABEL[req.status].label}</span>
                </div>
                <p className="t-xs c-mid" style={{ lineHeight: 1.5, marginBottom: 8 }}>
                  {req.description}
                </p>
                <div className="client-profile-direct-request-meta">
                  <span className="t-xs c-low mono">{req.budgetLabel}</span>
                  <span className="t-xs c-low">{req.createdLabel}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {isRealClient && selectedPublicPost && (
        <div
          className="account-dialog-backdrop public-request-backdrop"
          role="presentation"
          onClick={() => { if (!profilePostDetailsLoading) setSelectedPublicPost(null); }}
        >
          <section
            className="account-dialog public-request-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-profile-public-post-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="row-between client-profile-public-post-dialog-heading">
              <div>
                <div className="t-xs c-low">Public commission request</div>
                {selectedPublicPost.status !== 'CANCELLED' && (
                  <span className={`badge ${PUBLIC_POST_STATUS[selectedPublicPost.status].badge}`}>
                    {PUBLIC_POST_STATUS[selectedPublicPost.status].label}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="icon-btn commission-post-dialog-close"
                aria-label="Close request"
                title="Close request"
                onClick={() => setSelectedPublicPost(null)}
              >
                <Icon name="x" style={{ width: 15, height: 15 }} />
              </button>
            </div>
            <h2 id="client-profile-public-post-title" className="commission-post-title">{selectedPublicPost.title}</h2>
            <p className="commission-post-description">{selectedPublicPost.description}</p>
            <div className="commission-post-budget">{formatBudgetRange(selectedPublicPost) ?? 'Budget not specified'}</div>
            <div className="commission-post-meta">
              <span className="t-xs c-low">Posted {formatPostedDate(selectedPublicPost.created_at)}</span>
              <span className="t-xs c-low">
                {publicPostEngagement[selectedPublicPost.id]?.comment_count ?? profilePostComments.length} comments
              </span>
              <span className="t-xs c-low">
                {publicPostEngagement[selectedPublicPost.id]?.application_count ?? profilePostApplications.length} requests
              </span>
            </div>
            {profilePostDetailsLoading ? (
              <div className="card t-sm c-mid" role="status">Loading comments and requests…</div>
            ) : profilePostDetailsError ? (
              <div className="field-error" role="alert">{profilePostDetailsError}</div>
            ) : (
              <>
                <section className="commission-post-requests" aria-labelledby="client-profile-requests-title">
                  <div className="row-between commission-post-requests-heading">
                    <h3 id="client-profile-requests-title" className="t-sm fw-700">Requests</h3>
                    <span className="t-xs c-low">{profilePostApplications.length} total</span>
                  </div>
                  {profilePostApplications.length === 0 ? (
                    <div className="card t-sm c-mid commission-applicants-state">0 requests</div>
                  ) : (
                    <div className="commission-applicants-list">
                      {profilePostApplications.map((application) => (
                        <article className="commission-applicant-card" key={application.id}>
                          <div className="commission-post-author">
                            <div
                              className="avatar avatar-md commission-post-avatar"
                              style={application.applicant_avatar_data_url ? { backgroundImage: `url(${application.applicant_avatar_data_url})` } : undefined}
                            >
                              {!application.applicant_avatar_data_url && application.applicant_name.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="commission-post-author-copy">
                              <div className="t-sm fw-700 commission-post-author-name">{application.applicant_name}</div>
                              <div className="t-xs c-low">@{application.applicant_username} · Artist</div>
                            </div>
                            <span className="badge badge-accent">{application.status}</span>
                          </div>
                          <p className="commission-applicant-message">{application.message}</p>
                          <div className="t-xs c-low">Applied {new Date(application.created_at).toLocaleString()}</div>
                          {application.status === 'PENDING' && selectedPublicPost.status === 'OPEN' && (
                            <div className="commission-applicant-actions">
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/market/artist/${application.applicant_id}`)}>
                                View Profile
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={rejectingProfileApplicationId !== null || profileSelectionLoading}
                                onClick={() => void handleRejectProfileApplication(application)}
                              >
                                {rejectingProfileApplicationId === application.id ? 'Rejecting…' : 'Reject'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={rejectingProfileApplicationId !== null || profileSelectionLoading}
                                onClick={() => {
                                  setSelectingProfileApplication(application);
                                  setProfileSelectionAmount('');
                                  setProfileSelectionCurrency(selectedPublicPost.currency ?? '');
                                  setProfileSelectionError(null);
                                }}
                              >
                                Accept
                              </button>
                            </div>
                          )}
                          {selectingProfileApplication?.id === application.id && selectedPublicPost.status === 'OPEN' && (
                            <div className="commission-selection-confirmation">
                              <div className="t-sm fw-700">Confirm final terms</div>
                              <label className="field-label" htmlFor="profile-selection-amount">Agreed amount</label>
                              <input
                                id="profile-selection-amount"
                                className="input-field"
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={profileSelectionAmount}
                                onChange={(event) => setProfileSelectionAmount(event.target.value)}
                                disabled={profileSelectionLoading}
                              />
                              <label className="field-label" htmlFor="profile-selection-currency">Currency</label>
                              <input
                                id="profile-selection-currency"
                                className="input-field"
                                maxLength={3}
                                value={profileSelectionCurrency}
                                onChange={(event) => setProfileSelectionCurrency(event.target.value.toUpperCase())}
                                disabled={profileSelectionLoading || Boolean(selectedPublicPost.currency)}
                              />
                              {profileSelectionError && <div className="field-error" role="alert">{profileSelectionError}</div>}
                              <div className="commission-selection-actions">
                                <button type="button" className="btn btn-ghost btn-sm" disabled={profileSelectionLoading} onClick={() => setSelectingProfileApplication(null)}>
                                  Cancel
                                </button>
                                <button type="button" className="btn btn-primary btn-sm" disabled={profileSelectionLoading} onClick={() => void handleAcceptProfileApplication()}>
                                  {profileSelectionLoading ? 'Accepting…' : 'Confirm Accept'}
                                </button>
                              </div>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <section className="commission-post-requests" aria-labelledby="client-profile-comments-title">
                  <div className="row-between commission-post-requests-heading">
                    <h3 id="client-profile-comments-title" className="t-sm fw-700">Comments</h3>
                    <span className="t-xs c-low">{profilePostComments.length}</span>
                  </div>
                  {profilePostComments.length === 0 ? (
                    <div className="card t-sm c-mid commission-applicants-state">No comments yet.</div>
                  ) : (
                    <div className="commission-applicants-list">
                      {profilePostComments.map((comment) => (
                        <article className="commission-comment-card" key={comment.id}>
                          <div className="commission-comment-author">
                            <div
                              className="avatar avatar-sm commission-post-avatar"
                              style={comment.author_avatar_data_url ? { backgroundImage: `url(${comment.author_avatar_data_url})` } : undefined}
                            >
                              {!comment.author_avatar_data_url && comment.author_name.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="commission-comment-author-copy">
                              <div className="t-sm fw-700">{comment.author_name}</div>
                              <div className="t-xs c-low">{comment.author_username ? `@${comment.author_username} · ` : ''}{new Date(comment.created_at).toLocaleString()}</div>
                            </div>
                          </div>
                          <p className="commission-comment-body">{comment.body}</p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        </div>
      )}
      {allDirectRequestsOpen && (
        <div
          className="account-dialog-backdrop client-profile-direct-requests-backdrop"
          role="presentation"
          onClick={() => setAllDirectRequestsOpen(false)}
        >
          <section
            className="account-dialog client-profile-direct-requests-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-profile-direct-requests-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="client-profile-direct-requests-dialog-header">
              <h2 id="client-profile-direct-requests-title" className="section-title">All Direct Commission Requests</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close all commission requests"
                title="Close"
                onClick={() => setAllDirectRequestsOpen(false)}
              >
                <Icon name="x" style={{ width: 16, height: 16 }} />
              </button>
            </div>
            <div className="client-profile-direct-requests-list">
              {isRealClient ? directRequests.map((commission) => (
                <article className="card client-profile-direct-request-card" key={commission.id}>
                  <div className="client-profile-direct-request-heading">
                    <span className="t-sm fw-700 client-profile-direct-request-title">{commission.title}</span>
                    <span className={`badge ${COMMISSION_STATUS_BADGE[commission.status]}`}>{commission.status.replaceAll('_', ' ')}</span>
                  </div>
                  {commission.description && <p className="t-xs c-mid client-profile-direct-request-description">{commission.description}</p>}
                  <div className="client-profile-direct-request-meta">
                    <span className="t-xs c-low">With {commission.counterparty?.name ?? 'Artist profile unavailable'}</span>
                    <span className="t-xs c-low">{formatPostedDate(commission.created_at)}</span>
                  </div>
                  {formatCommissionAmount(commission) && (
                    <div className="t-xs fw-600 client-profile-direct-request-amount">{formatCommissionAmount(commission)}</div>
                  )}
                </article>
              )) : requests.map((request) => (
                <article className="card client-profile-direct-request-card" key={request.id}>
                  <div className="client-profile-direct-request-heading">
                    <span className="t-sm fw-700 client-profile-direct-request-title">{request.title}</span>
                    <span className={`badge ${STATUS_LABEL[request.status].badge}`}>{STATUS_LABEL[request.status].label}</span>
                  </div>
                  <p className="t-xs c-mid client-profile-direct-request-description">{request.description}</p>
                  <div className="client-profile-direct-request-meta">
                    <span className="t-xs c-low mono">{request.budgetLabel}</span>
                    <span className="t-xs c-low">{request.createdLabel}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
      {isRealClient && pendingPublicPostDelete && (
        <div
          className="account-dialog-backdrop commission-post-delete-backdrop"
          role="presentation"
          onClick={() => { if (!deletingPublicPostId) setPendingPublicPostDelete(null); }}
        >
          <section
            className="account-dialog commission-post-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="client-profile-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="client-profile-delete-title" className="t-sm fw-700">Delete this commission post?</h2>
            <p className="t-sm c-mid">The post, its requests, and comments will be permanently removed.</p>
            {publicPostDeleteError && <div className="field-error" role="alert">{publicPostDeleteError}</div>}
            <div className="commission-post-delete-actions">
              <button type="button" className="btn btn-ghost btn-sm" disabled={deletingPublicPostId !== null} onClick={() => setPendingPublicPostDelete(null)}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={deletingPublicPostId !== null} onClick={() => void handleDeletePublicPost()}>
                {deletingPublicPostId ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </section>
        </div>
      )}
      {toast}
    </ScreenShell>
  );
}
