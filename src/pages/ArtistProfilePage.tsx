import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { BottomNav } from '../components/ui/BottomNav';
import { IconButton } from '../components/ui/IconButton';
import { OptionsMenu } from '../components/ui/OptionsMenu';
import { ArtTile } from '../components/ui/ArtTile';
import { Icon } from '../assets/icons';
import { ARTISTS, CURRENT_ARTIST } from '../data/mockData';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useMockToast } from '../components/ui/MockToast';
import { getPublicProfile, initialsFor, usernameFromEmail, type PublicProfile } from '../lib/supabaseData';
import { isSupabaseConfigured } from '../lib/supabase';
import { isVerifiedArtistStatus } from '../types/auth';
import { createPublicPortfolioSignedUrl, listPublicArtistArtworks, type PublicArtworkRecord } from '../lib/supabaseArtworks';
import { listArtistReviews, type ArtistReview } from '../lib/supabaseReviews';
import {
  CommissionPostForm,
  EMPTY_COMMISSION_POST_DRAFT,
  validateCommissionPostDraft,
  type CommissionPostDraft,
} from '../components/CommissionPostForm';
import {
  createCommissionPostApplication,
  createCommissionPostComment,
  createCommissionPost,
  deleteCommissionPostComment,
  deleteCommissionPost,
  listCommissionPostComments,
  listCommissionPostEngagementSummaries,
  listOpenCommissionPosts,
  listMyCommissionPosts,
  listPostApplicationsForOwner,
  rejectCommissionPostApplication,
  selectCommissionPostApplicant,
  updateCommissionPost,
  type CommissionPostEngagementSummary,
  type CommissionPost,
  type CommissionPostComment,
  type OwnerCommissionPostApplication,
} from '../lib/supabaseCommissionPosts';
import { ProtectedArtworkDisplay } from '../components/ui/ProtectedArtworkDisplay';
import './MarketplacePage.css';
import './ArtistProfilePage.css';

interface ArtistProfileView {
  name: string;
  handle: string;
  initials: string;
  avatarStyle: CSSProperties;
  avatarDataUrl?: string | null;
  tags: string[];
  bio: string;
  verified: boolean;
  acceptingCommissions?: boolean | null;
  verificationStatus?: string;
  coverGradient?: string;
  rating?: number;
  reviewCount?: number;
  completed?: number;
  responseTime?: string;
  startingPrice?: number;
  portfolio?: (1 | 2 | 3 | 4 | 5 | 6)[];
  realPortfolio?: PublicArtworkRecord[];
  pricing: { tier: string; price: number }[];
  source: 'mock' | 'supabase';
}

function formatArtistPostBudget(post: CommissionPost): string {
  const format = (amount: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount);
  const currency = post.currency ? `${post.currency} ` : '';
  if (post.budget_min !== null && post.budget_max !== null) {
    return `${currency}${format(post.budget_min)}–${format(post.budget_max)}`;
  }
  if (post.budget_min !== null) return `From ${currency}${format(post.budget_min)}`;
  if (post.budget_max !== null) return `Up to ${currency}${format(post.budget_max)}`;
  return 'Budget not specified';
}

export function ArtistProfilePage() {
  const { artistId } = useParams<{ artistId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { startConversation } = useChat();
  const { toast, showToast } = useMockToast();
  const [startingConversation, setStartingConversation] = useState(false);
  const [messageError, setMessageError] = useState<string>();

  const isSelf = !artistId;
  const isRealSelf = isSelf && isSupabaseConfigured && user?.role === 'artist';
  const publicArtist = artistId ? ARTISTS.find((a) => a.id === artistId) : undefined;
  const [realProfile, setRealProfile] = useState<PublicProfile | null>(null);
  const isViewingOwnProfile = isSelf || Boolean(user && realProfile?.id === user.id);
  const [realProfileLoading, setRealProfileLoading] = useState(Boolean((artistId && !publicArtist) || isRealSelf));
  const [realProfileError, setRealProfileError] = useState<string | undefined>();
  const [realPortfolio, setRealPortfolio] = useState<PublicArtworkRecord[]>([]);
  const [portfolioUrls, setPortfolioUrls] = useState<Record<string, string>>({});
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioError, setPortfolioError] = useState<string | undefined>();
  const [portfolioUnavailableIds, setPortfolioUnavailableIds] = useState<Set<string>>(new Set());
  const [commissionPosts, setCommissionPosts] = useState<CommissionPost[]>([]);
  const deletedArtistPostIdsRef = useRef<{ profileId: string | null; ids: Set<string> }>({
    profileId: null,
    ids: new Set(),
  });
  const [commissionPostsLoading, setCommissionPostsLoading] = useState(false);
  const [commissionPostsError, setCommissionPostsError] = useState(false);
  const [commissionPostEngagementError, setCommissionPostEngagementError] = useState(false);
  const [commissionPostEngagement, setCommissionPostEngagement] = useState<Record<string, CommissionPostEngagementSummary>>({});
  const [artistPostDraft, setArtistPostDraft] = useState<CommissionPostDraft>(EMPTY_COMMISSION_POST_DRAFT);
  const [artistPostFormOpen, setArtistPostFormOpen] = useState(false);
  const [editingArtistPostId, setEditingArtistPostId] = useState<string | null>(null);
  const [artistPostFormError, setArtistPostFormError] = useState<string | null>(null);
  const [savingArtistPost, setSavingArtistPost] = useState(false);
  const [artistPostMenuId, setArtistPostMenuId] = useState<string | null>(null);
  const [pendingArtistPostDelete, setPendingArtistPostDelete] = useState<CommissionPost | null>(null);
  const [artistPostDeleteError, setArtistPostDeleteError] = useState<string | null>(null);
  const [deletingArtistPost, setDeletingArtistPost] = useState(false);
  const [artistPostComments, setArtistPostComments] = useState<CommissionPostComment[]>([]);
  const [commentsForArtistPost, setCommentsForArtistPost] = useState<CommissionPost | null>(null);
  const [artistPostCommentsLoading, setArtistPostCommentsLoading] = useState(false);
  const [artistPostCommentsError, setArtistPostCommentsError] = useState<string | null>(null);
  const [artistPostCommentMenuId, setArtistPostCommentMenuId] = useState<string | null>(null);
  const [artistPostCommentDraft, setArtistPostCommentDraft] = useState('');
  const [artistPostCommentSaving, setArtistPostCommentSaving] = useState(false);
  const [artistPostApplications, setArtistPostApplications] = useState<OwnerCommissionPostApplication[]>([]);
  const [requestsForArtistPost, setRequestsForArtistPost] = useState<CommissionPost | null>(null);
  const [artistPostApplicationsLoading, setArtistPostApplicationsLoading] = useState(false);
  const [artistPostApplicationsError, setArtistPostApplicationsError] = useState<string | null>(null);
  const [selectingArtistPostApplication, setSelectingArtistPostApplication] = useState<OwnerCommissionPostApplication | null>(null);
  const [artistPostSelectionAmount, setArtistPostSelectionAmount] = useState('');
  const [artistPostSelectionCurrency, setArtistPostSelectionCurrency] = useState('');
  const [artistPostSelectionError, setArtistPostSelectionError] = useState<string | null>(null);
  const [artistPostSelectionSaving, setArtistPostSelectionSaving] = useState(false);
  const [requestingArtistPost, setRequestingArtistPost] = useState<CommissionPost | null>(null);
  const [artistPostApplicationMessage, setArtistPostApplicationMessage] = useState('');
  const [artistPostApplicationError, setArtistPostApplicationError] = useState<string | null>(null);
  const [artistPostApplicationSaving, setArtistPostApplicationSaving] = useState(false);
  const [artistReviews, setArtistReviews] = useState<ArtistReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState(false);
  const [reviewsDialogOpen, setReviewsDialogOpen] = useState(false);

  useEffect(() => {
    const profileId = artistId ?? (isRealSelf ? user?.id : undefined);
    if (!profileId || publicArtist || !isSupabaseConfigured) {
      setRealProfile(null);
      setRealProfileLoading(false);
      return;
    }
    let active = true;
    setRealProfile(null);
    setRealProfileLoading(true);
    setRealProfileError(undefined);
    getPublicProfile(profileId)
      .then((profile) => {
        if (!active) return;
        if (profile?.role === 'artist') setRealProfile(profile);
        else setRealProfileError('Artist not found.');
      })
      .catch((error) => {
        if (active) setRealProfileError(error instanceof Error ? error.message : 'Could not load this artist profile.');
      })
      .finally(() => {
        if (active) setRealProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [artistId, isRealSelf, publicArtist, user?.id]);

  useEffect(() => {
    if (!realProfile || realProfile.role !== 'artist' || !isSupabaseConfigured) {
      setRealPortfolio([]);
      setPortfolioUrls({});
      setPortfolioError(undefined);
      setPortfolioLoading(false);
      setPortfolioUnavailableIds(new Set());
      return;
    }

    let active = true;
    setPortfolioLoading(true);
    setPortfolioError(undefined);
    setPortfolioUrls({});
    setPortfolioUnavailableIds(new Set());
    void listPublicArtistArtworks(realProfile.id)
      .then(async (artworks) => {
        if (!active) return;
        setRealPortfolio(artworks);
        const signedEntries = await Promise.all(artworks.map(async (artwork) => {
          try {
            return [artwork.id, await createPublicPortfolioSignedUrl(realProfile.id, artwork)] as const;
          } catch {
            return null;
          }
        }));
        if (!active) return;
        setPortfolioUrls(Object.fromEntries(signedEntries.filter((entry): entry is readonly [string, string] => entry !== null)));
        setPortfolioUnavailableIds(new Set(artworks
          .filter((artwork) => !signedEntries.some((entry) => entry?.[0] === artwork.id))
          .map((artwork) => artwork.id)));
      })
      .catch((error) => {
        if (!active) return;
        setRealPortfolio([]);
        setPortfolioError(error instanceof Error ? error.message : 'Could not load this artist portfolio.');
      })
      .finally(() => {
        if (active) setPortfolioLoading(false);
      });

    return () => {
      active = false;
    };
  }, [realProfile]);

  useEffect(() => {
    const profileId = realProfile?.role === 'artist'
      ? realProfile.id
      : isRealSelf ? user?.id : null;
    if (!profileId || !isSupabaseConfigured) {
      setCommissionPosts([]);
      setCommissionPostEngagement({});
      setCommissionPostsLoading(false);
      setCommissionPostsError(false);
      setCommissionPostEngagementError(false);
      return;
    }
    if (deletedArtistPostIdsRef.current.profileId !== profileId) {
      deletedArtistPostIdsRef.current = { profileId, ids: new Set() };
    }

    let active = true;
    setCommissionPostsLoading(true);
    setCommissionPostsError(false);
    setCommissionPostEngagementError(false);
    setCommissionPosts([]);
    setCommissionPostEngagement({});
    const isOwner = profileId === user?.id;
    void Promise.all([
      listOpenCommissionPosts(),
      isOwner ? listMyCommissionPosts() : Promise.resolve([] as CommissionPost[]),
    ])
      .then(async ([openPosts, myPosts]) => {
        const postsById = new Map<string, CommissionPost>();
        for (const post of openPosts) {
          if (post.owner_id === profileId && post.owner_role === 'artist') postsById.set(post.id, post);
        }
        for (const post of myPosts) {
          if (post.owner_id === profileId
            && post.owner_role === 'artist'
            && post.status !== 'CANCELLED'
            && post.status !== 'SELECTED') {
            postsById.set(post.id, post);
          }
        }
        const posts = [...postsById.values()].filter((post) =>
          !deletedArtistPostIdsRef.current.ids.has(post.id),
        );
        if (active) setCommissionPosts(posts);
        try {
          const summaries = await listCommissionPostEngagementSummaries(posts.map((post) => post.id));
          if (active) {
            setCommissionPostEngagement(Object.fromEntries(
              summaries.map((summary) => [summary.commission_post_id, summary]),
            ));
            setCommissionPostEngagementError(posts.some((post) => !summaries.some((item) => item.commission_post_id === post.id)));
          }
        } catch {
          if (active) setCommissionPostEngagementError(true);
        }
      })
      .catch(() => {
        if (active) setCommissionPostsError(true);
      })
      .finally(() => {
        if (active) setCommissionPostsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isRealSelf, realProfile, user?.id]);

  useEffect(() => {
    if (!realProfile || realProfile.role !== 'artist' || !isSupabaseConfigured) {
      setArtistReviews([]);
      setReviewsLoading(false);
      setReviewsError(false);
      return;
    }

    let active = true;
    setReviewsLoading(true);
    setReviewsError(false);
    setArtistReviews([]);
    void listArtistReviews(realProfile.id)
      .then((reviews) => {
        if (active) setArtistReviews(reviews);
      })
      .catch(() => {
        if (!active) return;
        setArtistReviews([]);
        setReviewsError(true);
      })
      .finally(() => {
        if (active) setReviewsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [realProfile]);

  if (!isSelf && !publicArtist && realProfileLoading) {
    return <ScreenShell header={<div className="px-hd row-between"><IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" /></div>}><div className="card t-sm c-mid" style={{ textAlign: 'center' }}>Loading artist profile…</div></ScreenShell>;
  }

  if (isRealSelf && realProfileLoading) {
    return <ScreenShell header={<div className="px-hd row-between"><span className="h-title" style={{ fontSize: 19 }}>Profile</span></div>} footer={<BottomNav active="profile" />}><div className="card t-sm c-mid" style={{ textAlign: 'center' }}>Loading artist profile…</div></ScreenShell>;
  }

  if (isRealSelf && (!realProfile || realProfileError)) {
    return <ScreenShell header={<div className="px-hd row-between"><span className="h-title" style={{ fontSize: 19 }}>Profile</span></div>} footer={<BottomNav active="profile" />}><div className="card t-sm c-mid" style={{ textAlign: 'center' }}>{realProfileError ?? 'Artist profile not found.'}</div></ScreenShell>;
  }

  if (!isSelf && !publicArtist && (!realProfile || realProfileError)) {
    return (
      <ScreenShell
        header={
          <div className="px-hd row-between">
            <IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" />
          </div>
        }
      >
        <div className="card t-sm c-mid" style={{ textAlign: 'center' }}>
          {realProfileError ?? 'Artist not found.'}
        </div>
      </ScreenShell>
    );
  }

  // Normalize self vs public into one shape the JSX below can render.
  const profile: ArtistProfileView = isRealSelf
    ? {
        name: realProfile!.name,
        handle: `@${realProfile!.username}`,
        initials: realProfile!.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''),
        avatarStyle: realProfile!.avatar_data_url ? { backgroundImage: `url(${realProfile!.avatar_data_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {},
        avatarDataUrl: realProfile!.avatar_data_url,
        tags: realProfile!.interests ?? [],
        bio: realProfile!.bio ?? '',
        verified: isVerifiedArtistStatus(realProfile!.artist_verification_status),
        acceptingCommissions: realProfile!.accepting_commissions,
        verificationStatus: realProfile!.artist_verification_status ?? undefined,
        realPortfolio,
        pricing: [],
        source: 'supabase' as const,
      }
    : isSelf
    ? {
        name: user?.name || CURRENT_ARTIST.fullName,
        handle: `@${usernameFromEmail(user?.email)}`,
        initials: (user?.name || CURRENT_ARTIST.fullName).slice(0, 1).toUpperCase(),
        avatarStyle: {},
        avatarDataUrl: user?.avatarDataUrl,
        tags: user?.interests && user.interests.length > 0 ? user.interests : CURRENT_ARTIST.tags,
        rating: CURRENT_ARTIST.rating,
        reviewCount: CURRENT_ARTIST.reviewCount,
        completed: CURRENT_ARTIST.completed,
        responseTime: CURRENT_ARTIST.responseTime,
        bio: user?.bio || CURRENT_ARTIST.bio,
        portfolio: CURRENT_ARTIST.portfolio,
        pricing: CURRENT_ARTIST.pricing,
        verified: isVerifiedArtistStatus(user?.artistVerificationStatus),
        verificationStatus: user?.artistVerificationStatus,
        coverGradient: 'linear-gradient(160deg, #1D5C8C 0%, #2E86C9 45%, #E8B23D 100%)',
        startingPrice: CURRENT_ARTIST.pricing[0]?.price ?? 0,
        source: 'mock',
      }
    : publicArtist
      ? { ...publicArtist, verified: Boolean(publicArtist.verified), avatarDataUrl: undefined, verificationStatus: undefined, source: 'mock' as const }
      : {
          name: realProfile!.name,
          handle: `@${realProfile!.username}`,
          initials: realProfile!.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''),
          avatarStyle: realProfile!.avatar_data_url ? { backgroundImage: `url(${realProfile!.avatar_data_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {},
          avatarDataUrl: realProfile!.avatar_data_url,
          tags: realProfile!.interests ?? [],
          bio: realProfile!.bio ?? '',
          verified: isVerifiedArtistStatus(realProfile!.artist_verification_status),
          acceptingCommissions: realProfile!.accepting_commissions,
          verificationStatus: realProfile!.artist_verification_status ?? undefined,
          realPortfolio,
          pricing: [],
          source: 'supabase' as const,
        };

    const reviewAverage = artistReviews.length > 0
      ? artistReviews.reduce((total, review) => total + review.rating, 0) / artistReviews.length
      : null;
    const reviewCards = (reviews: ArtistReview[]) => reviews.map((review) => (
      <article className="card" key={review.review_id} style={{ padding: '14px 16px', minWidth: 0, overflowWrap: 'anywhere' }}>
        <div className="row gap-10" style={{ alignItems: 'flex-start', minWidth: 0 }}>
          <div
            className="avatar avatar-sm"
            aria-hidden="true"
            style={review.reviewer_avatar_data_url ? { backgroundImage: `url(${review.reviewer_avatar_data_url})`, backgroundSize: 'cover', backgroundPosition: 'center', flexShrink: 0 } : { flexShrink: 0 }}
          >
            {!review.reviewer_avatar_data_url && initialsFor(review.reviewer_display_name || 'Client')}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row-between" style={{ alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div className="t-sm fw-700" style={{ overflowWrap: 'anywhere' }}>{review.reviewer_display_name || 'Client'}</div>
                {review.reviewer_username && <div className="t-xs c-low" style={{ overflowWrap: 'anywhere' }}>@{review.reviewer_username}</div>}
              </div>
              <time className="t-xs c-low" dateTime={review.created_at} style={{ flexShrink: 0 }}>
                {new Date(review.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                {review.edited_at && <span> · Edited</span>}
              </time>
            </div>
            <div className="row gap-4" aria-label={`Rating: ${review.rating} out of 5`} style={{ marginTop: 7 }}>
              {[1, 2, 3, 4, 5].map((rating) => (
                <Icon key={rating} name="star" style={{ width: 13, height: 13, stroke: 'none', fill: rating <= review.rating ? 'var(--ag-amber)' : 'var(--ag-border)' }} />
              ))}
            </div>
            <div className="t-sm c-mid" style={{ marginTop: 8, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.review_text}</div>
          </div>
        </div>
      </article>
    ));
    const reviewPreview = artistReviews.slice(0, 3);

  const resetArtistPostForm = () => {
    setArtistPostDraft(EMPTY_COMMISSION_POST_DRAFT);
    setArtistPostFormOpen(false);
    setEditingArtistPostId(null);
    setArtistPostFormError(null);
  };

  const handleArtistPostSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validated = validateCommissionPostDraft(artistPostDraft);
    if (typeof validated === 'string') {
      setArtistPostFormError(validated);
      return;
    }
    setArtistPostFormError(null);
    setSavingArtistPost(true);
    try {
      const savedPost = editingArtistPostId
        ? await updateCommissionPost(editingArtistPostId, validated)
        : await createCommissionPost(validated);
      setCommissionPosts((current) => [
        savedPost,
        ...current.filter((post) => post.id !== savedPost.id),
      ]);
      if (!editingArtistPostId) {
        setCommissionPostEngagement((current) => ({
          ...current,
          [savedPost.id]: { commission_post_id: savedPost.id, comment_count: 0, application_count: 0 },
        }));
      }
      resetArtistPostForm();
      showToast(editingArtistPostId ? 'Public post updated' : 'Public post created');
    } catch (error) {
      setArtistPostFormError(error instanceof Error ? error.message : 'Could not save this public post.');
    } finally {
      setSavingArtistPost(false);
    }
  };

  const deleteArtistPost = async () => {
    const post = pendingArtistPostDelete;
    if (!post || !user || post.owner_id !== user.id || post.owner_role !== user.role
      || post.status !== 'OPEN' || deletingArtistPost) return;
    setDeletingArtistPost(true);
    setArtistPostDeleteError(null);
    try {
      await deleteCommissionPost(post.id);
      if (deletedArtistPostIdsRef.current.profileId !== post.owner_id) {
        deletedArtistPostIdsRef.current = { profileId: post.owner_id, ids: new Set() };
      }
      deletedArtistPostIdsRef.current.ids.add(post.id);
      setCommissionPosts((current) => current.filter((item) =>
        item.id !== post.id && !deletedArtistPostIdsRef.current.ids.has(item.id),
      ));
      setCommissionPostEngagement((current) => {
        const next = { ...current };
        delete next[post.id];
        return next;
      });
      setArtistPostMenuId(null);
      setPendingArtistPostDelete(null);
      if (commentsForArtistPost?.id === post.id) {
        setCommentsForArtistPost(null);
        setArtistPostComments([]);
        setArtistPostCommentsError(null);
      }
      if (requestsForArtistPost?.id === post.id) {
        setRequestsForArtistPost(null);
        setArtistPostApplications([]);
        setArtistPostApplicationsError(null);
        setSelectingArtistPostApplication(null);
        setArtistPostSelectionError(null);
      }
      showToast('Public post deleted');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setArtistPostDeleteError(message.includes('POST_HAS_COMMISSION')
        ? 'This post cannot be deleted because a commission was created from it.'
        : message.includes('POST_NOT_OPEN')
          ? 'This post can no longer be deleted because it is no longer open.'
          : message.includes('POST_NOT_FOUND')
            ? 'This post has already been deleted.'
            : 'Could not delete this public post. Please try again.');
    } finally {
      setDeletingArtistPost(false);
    }
  };

  const openArtistPostComments = async (post: CommissionPost) => {
    setCommentsForArtistPost(post);
    setArtistPostComments([]);
    setArtistPostCommentsError(null);
    setArtistPostCommentDraft('');
    setArtistPostCommentsLoading(true);
    try {
      const comments = await listCommissionPostComments(post.id);
      setArtistPostComments(comments);
    } catch (error) {
      setArtistPostCommentsError(error instanceof Error ? error.message : 'Could not load comments.');
    } finally {
      setArtistPostCommentsLoading(false);
    }
  };

  const submitArtistPostComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!commentsForArtistPost || !artistPostCommentDraft.trim() || artistPostCommentSaving) return;
    setArtistPostCommentSaving(true);
    setArtistPostCommentsError(null);
    try {
      const comment = await createCommissionPostComment(commentsForArtistPost.id, artistPostCommentDraft.trim());
      setArtistPostComments((current) => [...current, comment]);
      setArtistPostCommentDraft('');
      setCommissionPostEngagement((current) => {
        const summary = current[commentsForArtistPost.id];
        return summary ? {
          ...current,
          [commentsForArtistPost.id]: { ...summary, comment_count: summary.comment_count + 1 },
        } : current;
      });
    } catch (error) {
      setArtistPostCommentsError(error instanceof Error ? error.message : 'Could not add your comment.');
    } finally {
      setArtistPostCommentSaving(false);
    }
  };

  const deleteArtistPostComment = async (comment: CommissionPostComment) => {
    if (!commentsForArtistPost || !user
      || (comment.author_id !== user.id && commentsForArtistPost.owner_id !== user.id)) return;
    try {
      await deleteCommissionPostComment(comment.id);
      setArtistPostComments((current) => current.filter((item) => item.id !== comment.id));
      setCommissionPostEngagement((current) => {
        const summary = current[commentsForArtistPost.id];
        return summary ? {
          ...current,
          [commentsForArtistPost.id]: { ...summary, comment_count: Math.max(0, summary.comment_count - 1) },
        } : current;
      });
    } catch (error) {
      setArtistPostCommentsError(error instanceof Error ? error.message : 'Could not delete this comment.');
    }
  };

  const openArtistPostRequests = async (post: CommissionPost) => {
    setRequestsForArtistPost(post);
    setArtistPostApplications([]);
    setArtistPostApplicationsError(null);
    setArtistPostApplicationsLoading(true);
    setSelectingArtistPostApplication(null);
    try {
      setArtistPostApplications(await listPostApplicationsForOwner(post.id));
    } catch (error) {
      setArtistPostApplicationsError(error instanceof Error ? error.message : 'Could not load requests.');
    } finally {
      setArtistPostApplicationsLoading(false);
    }
  };

  const submitArtistPostApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requestingArtistPost || !user || user.role !== 'client' || !artistPostApplicationMessage.trim()) return;
    setArtistPostApplicationSaving(true);
    setArtistPostApplicationError(null);
    try {
      await createCommissionPostApplication(requestingArtistPost.id, artistPostApplicationMessage.trim());
      const summary = commissionPostEngagement[requestingArtistPost.id];
      if (summary) {
        setCommissionPostEngagement((current) => ({
          ...current,
          [requestingArtistPost.id]: {
            ...summary,
            application_count: summary.application_count + 1,
          },
        }));
      }
      setRequestingArtistPost(null);
      setArtistPostApplicationMessage('');
      showToast('Request sent to the Artist');
    } catch (error) {
      setArtistPostApplicationError(error instanceof Error ? error.message : 'Could not send this request.');
    } finally {
      setArtistPostApplicationSaving(false);
    }
  };

  const rejectArtistPostRequest = async (application: OwnerCommissionPostApplication) => {
    try {
      const rejected = await rejectCommissionPostApplication(application.id);
      setArtistPostApplications((current) => current.map((item) => item.id === rejected.id
        ? { ...item, status: 'REJECTED' }
        : item));
    } catch (error) {
      setArtistPostApplicationsError(error instanceof Error ? error.message : 'Could not reject this request.');
    }
  };

  const acceptArtistPostRequest = async (application: OwnerCommissionPostApplication) => {
    if (!requestsForArtistPost || artistPostSelectionSaving) return;
    const amount = Number(artistPostSelectionAmount);
    const currency = artistPostSelectionCurrency.trim().toUpperCase();
    if (!Number.isFinite(amount) || amount <= 0) {
      setArtistPostSelectionError('Enter an agreed amount greater than zero.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      setArtistPostSelectionError('Currency must be a three-letter code.');
      return;
    }
    setArtistPostSelectionSaving(true);
    setArtistPostSelectionError(null);
    try {
      await selectCommissionPostApplicant(requestsForArtistPost.id, application.id, amount, currency);
      setCommissionPosts((current) => current.map((post) => post.id === requestsForArtistPost.id
        ? { ...post, status: 'SELECTED' }
        : post));
      setRequestsForArtistPost((current) => current?.id === requestsForArtistPost.id
        ? { ...current, status: 'SELECTED' }
        : current);
      setArtistPostApplications((current) => current.map((item) => ({
        ...item,
        status: item.id === application.id ? 'SELECTED' : item.status === 'PENDING' ? 'REJECTED' : item.status,
      })));
      setSelectingArtistPostApplication(null);
      showToast('Client selected. Commission request created.');
    } catch (error) {
      setArtistPostSelectionError(error instanceof Error ? error.message : 'Could not accept this request.');
    } finally {
      setArtistPostSelectionSaving(false);
    }
  };

  const profileCover = (
    <div className="artist-cover" style={{ background: profile.coverGradient }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 16px)',
            }}
          />
          <div
            className="row-between"
            style={{ position: 'relative', padding: '0 18px', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
          >
            {isSelf ? (
              <span />
            ) : (
              <IconButton
                icon="chevron-l"
                onClick={() => navigate(-1)}
                ariaLabel="Back"
                style={{ background: 'rgba(0,0,0,0.25)', borderColor: 'rgba(255,255,255,0.2)' }}
              />
            )}
            {isSelf ? (
              <IconButton
                icon="dots"
                onClick={() => navigate('/profile/settings')}
                ariaLabel="Settings"
                style={{ background: 'rgba(0,0,0,0.25)', borderColor: 'rgba(255,255,255,0.2)' }}
              />
            ) : (
              <OptionsMenu
                ariaLabel="More options"
                triggerStyle={{ background: 'rgba(0,0,0,0.25)', borderColor: 'rgba(255,255,255,0.2)' }}
                items={[
                  { label: 'Report artist', onClick: () => showToast(`${profile.name} reported (mock)`) },
                  { label: 'Block artist', onClick: () => showToast(`${profile.name} blocked (mock)`), danger: true },
                ]}
              />
            )}
          </div>
          <div className="artist-cover-inner">
            <div
              className="avatar avatar-xl artist-avatar"
              style={{
                ...profile.avatarStyle,
                ...(profile.avatarDataUrl
                  ? { backgroundImage: `url(${profile.avatarDataUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : {}),
              }}
            >
              {!profile.avatarDataUrl && profile.initials}
            </div>
          </div>
    </div>
  );

  const handleMessageArtist = async () => {
    const recipientId = realProfile?.id;
    if (startingConversation || !recipientId || !user || recipientId === user.id) return;

    setStartingConversation(true);
    setMessageError(undefined);
    try {
      const conversationId = await startConversation(recipientId);
      if (!conversationId) {
        setMessageError('Could not start the conversation. Please try again.');
        return;
      }
      navigate(`/chat/${conversationId}`);
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : 'Could not start the conversation. Please try again.');
    } finally {
      setStartingConversation(false);
    }
  };

  return (
    <ScreenShell
      padContent={false}
      footer={
        isSelf ? (
          <BottomNav active="profile" />
        ) : profile.source === 'supabase' ? undefined : (
          <div className="sticky-action-bar">
            <div className="row-between" style={{ gap: 14 }}>
              <div>
                <div className="t-xs c-low">From</div>
                <div className="mono fw-700 sticky-action-price" style={{ fontSize: 17 }}>
                  ₱{profile.startingPrice}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto', padding: '14px 28px' }}
                onClick={() => navigate('/commission/start')}
              >
                Start a Real Commission
              </button>
            </div>
          </div>
        )
      }
    >
      {profileCover}
      <div className="app-content-inner artist-profile-content">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="row gap-8">
              <span style={{ fontSize: 19, fontWeight: 700 }}>{profile.name}</span>
              {profile.verified && (
                <Icon
                  name="check-circle"
                  style={{ width: 15, height: 15, stroke: 'var(--ag-sky)', fill: 'rgba(46,134,201,0.2)' }}
                />
              )}
              {isSelf && !profile.verified && profile.verificationStatus === 'pending' && (
                <span className="t-xs c-warning">Verification Pending</span>
              )}
              {isSelf && !profile.verified && profile.verificationStatus === 'rejected' && (
                <span className="t-xs c-danger">Verification Needs Revision</span>
              )}
            </div>
            <div className="t-xs c-low">
              {profile.handle} · {profile.tags.join(' · ')}
            </div>
          </div>
          {isViewingOwnProfile && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/profile/edit')}>
              Edit
            </button>
          )}
        </div>

        {profile.source === 'mock' && <div className="row gap-14" style={{ margin: '16px 0' }}>
          <div>
            <div className="row gap-8">
              <Icon name="star" style={{ width: 13, height: 13, stroke: 'none', fill: 'var(--ag-amber)' }} />
              <span className="t-sm fw-700">{profile.rating?.toFixed(1)}</span>
            </div>
            <div className="t-xs c-low">{profile.reviewCount} reviews</div>
          </div>
          <div style={{ width: 1, height: 26, background: 'var(--ag-border-soft)' }} />
          <div>
            <div className="t-sm fw-700 mono">{profile.completed}</div>
            <div className="t-xs c-low">Completed</div>
          </div>
          <div style={{ width: 1, height: 26, background: 'var(--ag-border-soft)' }} />
          <div>
            <div className="t-sm fw-700 mono">{profile.responseTime}</div>
            <div className="t-xs c-low">Response</div>
          </div>
        </div>}

        {profile.source === 'supabase' && reviewAverage !== null && (
          <div className="row gap-8" style={{ margin: '16px 0' }} aria-label={`Rating ${reviewAverage.toFixed(1)} out of 5 from ${artistReviews.length} ${artistReviews.length === 1 ? 'review' : 'reviews'}`}>
            <Icon name="star" style={{ width: 14, height: 14, stroke: 'none', fill: 'var(--ag-amber)' }} />
            <span className="t-sm fw-700">{reviewAverage.toFixed(1)}</span>
            <span className="t-xs c-low">· {artistReviews.length} {artistReviews.length === 1 ? 'review' : 'reviews'}</span>
          </div>
        )}

        <p className="t-xs c-mid" style={{ lineHeight: 1.6, marginBottom: isSelf ? 12 : 18 }}>
          {profile.bio}
        </p>

        {profile.source === 'supabase' && !isViewingOwnProfile && realProfile && (
          <div className="artist-profile-actions">
            <button
              type="button"
              className="btn btn-primary artist-profile-message-button"
              onClick={() => void handleMessageArtist()}
              disabled={startingConversation || !user || realProfile.id === user.id}
            >
              <Icon name="chat" style={{ width: 16, height: 16, stroke: '#fff' }} />
              {startingConversation ? 'Opening conversation…' : 'Message'}
            </button>
            {messageError && <div className="t-xs c-danger artist-profile-message-error" role="alert">{messageError}</div>}
          </div>
        )}

        {isSelf && profile.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
            {profile.tags.map((tag) => (
              <span className="chip" key={tag} style={{ fontSize: 11 }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {profile.source === 'mock' && <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="section-title">Protected Portfolio</span>
          <Icon name="grid" style={{ width: 14, height: 14, stroke: 'var(--ag-text-low)' }} />
        </div>}
        {profile.source === 'mock' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 20 }}>
          {profile.portfolio?.map((variant, i) => (
            <ArtTile key={i} variant={variant} style={{ aspectRatio: '1' }} />
          ))}
        </div>}

        {isSupabaseConfigured && (profile.source === 'supabase' || (isSelf && user?.role === 'artist')) && (
          <section className="artist-public-posts" aria-labelledby="artist-public-posts-title">
            <div className="row-between artist-public-posts-heading">
              <span id="artist-public-posts-title" className="section-title">Public Commission Posts</span>
              {isSelf && user?.role === 'artist' && profile.source === 'supabase' && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm artist-profile-new-post"
                  onClick={() => {
                    setEditingArtistPostId(null);
                    setArtistPostDraft(EMPTY_COMMISSION_POST_DRAFT);
                    setArtistPostFormError(null);
                    setArtistPostFormOpen((open) => !open);
                  }}
                >
                  NEW POST
                </button>
              )}
            </div>
            {isSelf && user?.role === 'artist' && artistPostFormOpen && (
              <CommissionPostForm
                form={artistPostDraft}
                heading={editingArtistPostId ? 'Edit Public Commission Post' : 'New Public Commission Post'}
                submitLabel={editingArtistPostId ? 'Save Changes' : 'Create Post'}
                error={artistPostFormError}
                saving={savingArtistPost}
                onChange={(field, value) => setArtistPostDraft((current) => ({ ...current, [field]: value }))}
                onSubmit={(event) => void handleArtistPostSubmit(event)}
                onCancel={resetArtistPostForm}
              />
            )}
            {commissionPostsLoading && <div className="card t-sm c-mid" role="status">Loading public commission posts...</div>}
            {!commissionPostsLoading && commissionPostsError && <div className="card t-sm c-danger" role="alert">Could not load public commission posts.</div>}
            {!commissionPostsLoading && !commissionPostsError && commissionPostEngagementError && (
              <div className="t-xs c-low" role="status">Some post counts are temporarily unavailable.</div>
            )}
            {!commissionPostsLoading && !commissionPostsError && commissionPosts.length === 0 && (
              <div className="card t-sm c-mid artist-public-posts-empty">No public commission posts yet.</div>
            )}
            {!commissionPostsLoading && !commissionPostsError && commissionPosts.length > 0 && (
              <div className="commission-post-feed">
                {commissionPosts.map((post) => {
                    const isOwner = Boolean(user && post.owner_id === user.id && post.owner_role === user.role);
                    const engagement = commissionPostEngagement[post.id];
                    const canRequest = Boolean(user?.role === 'client' && !isOwner && post.status === 'OPEN');
                    return (
                      <article className="commission-post-card" key={post.id}>
                        <div className="commission-post-card-header">
                          <div className="commission-post-author">
                            <div
                              className="avatar avatar-md commission-post-avatar"
                              style={profile.avatarDataUrl ? { backgroundImage: `url(${profile.avatarDataUrl})` } : undefined}
                            >
                              {!profile.avatarDataUrl && profile.initials}
                            </div>
                            <div className="commission-post-author-copy">
                              <div className="t-sm fw-700 commission-post-author-name">{profile.name}</div>
                              <div className="t-xs c-low">{profile.handle} · Artist</div>
                            </div>
                          </div>
                          {post.status !== 'OPEN' && <span className="badge badge-accent">{post.status}</span>}
                          {isOwner && post.status === 'OPEN' && (
                            <div className="commission-post-menu-wrap">
                              <IconButton
                                icon="dots"
                                ariaLabel={`Options for ${post.title}`}
                                onClick={() => setArtistPostMenuId((current) => current === post.id ? null : post.id)}
                              />
                              {artistPostMenuId === post.id && (
                                <div className="card commission-post-menu" role="menu">
                                  <button
                                    type="button"
                                    className="commission-post-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                      setEditingArtistPostId(post.id);
                                      setArtistPostDraft({
                                        title: post.title,
                                        description: post.description,
                                        budgetMin: post.budget_min === null ? '' : String(post.budget_min),
                                        budgetMax: post.budget_max === null ? '' : String(post.budget_max),
                                        currency: post.currency ?? '',
                                      });
                                      setArtistPostFormError(null);
                                      setArtistPostFormOpen(true);
                                      setArtistPostMenuId(null);
                                    }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="commission-post-menu-item c-danger"
                                    role="menuitem"
                                    onClick={() => {
                                      setPendingArtistPostDelete(post);
                                      setArtistPostDeleteError(null);
                                      setArtistPostMenuId(null);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <h2 className="commission-post-title">{post.title}</h2>
                        <p className="commission-post-description">{post.description}</p>
                        {(post.budget_min !== null || post.budget_max !== null) && (
                          <div className="commission-post-budget">{formatArtistPostBudget(post)}</div>
                        )}
                        <div className="commission-post-engagement" aria-label="Post engagement">
                          <button
                            type="button"
                            className="commission-post-comment-count"
                            aria-label={`Comments for ${post.title}: ${engagement?.comment_count ?? 'count unavailable'}`}
                            onClick={() => void openArtistPostComments(post)}
                          >
                            <Icon name="chat" />{engagement?.comment_count ?? '—'}
                          </button>
                          {isOwner ? (
                            <button
                              type="button"
                              className="commission-post-comment-count"
                              aria-label={`Requests for ${post.title}: ${engagement?.application_count ?? 'count unavailable'}`}
                              title="View requests"
                              onClick={() => void openArtistPostRequests(post)}
                            >
                              <Icon name="user" />{engagement?.application_count ?? ''}
                            </button>
                          ) : canRequest ? (
                            <button
                              type="button"
                              className="commission-post-comment-count"
                              aria-label={`Request ${post.title}`}
                              title="Request this commission"
                              onClick={() => {
                                setRequestingArtistPost(post);
                                setArtistPostApplicationMessage('');
                                setArtistPostApplicationError(null);
                              }}
                            >
                              <Icon name="send" />
                            </button>
                          ) : null}
                        </div>
                        <div className="commission-post-meta">
                          <span className="t-xs c-low">Posted {new Date(post.created_at).toLocaleDateString()}</span>
                        </div>
                      </article>
                    );
                })}
              </div>
            )}
          </section>
        )}

        {profile.source === 'supabase' && <div style={{ marginBottom: 20 }}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <span className="section-title">Protected Portfolio</span>
            <Icon name="grid" style={{ width: 14, height: 14, stroke: 'var(--ag-text-low)' }} />
          </div>
          {portfolioLoading && <div className="card t-sm c-mid" role="status">Loading portfolio...</div>}
          {!portfolioLoading && portfolioError && <div className="card t-sm protection-artwork-error" role="alert">Could not load portfolio.</div>}
          {!portfolioLoading && !portfolioError && realPortfolio.length === 0 && <div className="card t-sm c-mid">No artworks in portfolio yet.</div>}
          {!portfolioLoading && !portfolioError && realPortfolio.length > 0 && <div className="artist-protected-portfolio">
            {realPortfolio.map((artwork) => (
              <article className="card artist-protected-portfolio-card" key={artwork.id} style={{ padding: 0, overflow: 'hidden' }}>
                <div className="artist-protected-portfolio-image" style={{ background: 'var(--ag-surface-2)' }}>
                  {portfolioUrls[artwork.id] ? (
                    <ProtectedArtworkDisplay
                      src={portfolioUrls[artwork.id]}
                      alt={`${artwork.title} protected preview`}
                      settings={{
                        dynamic_cloaking: artwork.dynamic_cloaking,
                        canvas_tiling: artwork.canvas_tiling,
                        right_click_shield: artwork.right_click_shield,
                      }}
                      fitMode="contain"
                    />
                  ) : (
                    <span className="t-xs c-low" style={{ padding: 10, textAlign: 'center' }}>Preview unavailable</span>
                  )}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div className="t-sm fw-600">{artwork.title}</div>
                  {artwork.description && <div className="t-xs c-mid" style={{ marginTop: 4, lineHeight: 1.5 }}>{artwork.description}</div>}
                  {portfolioUnavailableIds.has(artwork.id) && <div className="t-xs protection-artwork-error" style={{ marginTop: 5 }}>Protected preview unavailable</div>}
                </div>
              </article>
            ))}
          </div>}
        </div>}

        {profile.source === 'supabase' && (
          <section style={{ marginBottom: 20 }} aria-labelledby="artist-reviews-title">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span id="artist-reviews-title" className="section-title">Reviews</span>
              {!reviewsLoading && !reviewsError && artistReviews.length > 3 && (
                <button type="button" className="link-sm" onClick={() => setReviewsDialogOpen(true)}>
                  SEE ALL
                </button>
              )}
            </div>
            {reviewsLoading && <div className="t-sm c-mid" role="status">Loading reviews...</div>}
            {!reviewsLoading && reviewsError && <div className="t-sm c-danger" role="alert">Could not load reviews.</div>}
            {!reviewsLoading && !reviewsError && artistReviews.length === 0 && <div className="t-sm c-mid">No reviews yet.</div>}
            {!reviewsLoading && !reviewsError && artistReviews.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {reviewCards(reviewPreview)}
              </div>
            )}
          </section>
        )}

        {profile.source === 'supabase' && reviewsDialogOpen && (
          <div className="account-dialog-backdrop" role="presentation" onClick={() => setReviewsDialogOpen(false)}>
            <section
              className="account-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="artist-reviews-dialog-title"
              onClick={(event) => event.stopPropagation()}
              style={{ width: 'min(100%, 640px)' }}
            >
              <div className="row-between" style={{ marginBottom: 14, gap: 12 }}>
                <h2 id="artist-reviews-dialog-title" style={{ margin: 0 }}>All Reviews</h2>
                <button type="button" className="link-sm" onClick={() => setReviewsDialogOpen(false)} aria-label="Close reviews">
                  Close
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 'min(65dvh, 560px)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
                {reviewCards(artistReviews)}
              </div>
            </section>
          </div>
        )}

        {commentsForArtistPost && (
          <div className="account-dialog-backdrop public-request-backdrop" role="presentation" onClick={() => setCommentsForArtistPost(null)}>
            <section
              className="account-dialog commission-comments-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="artist-post-comments-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="row-between" style={{ marginBottom: 14, gap: 12 }}>
                <h2 id="artist-post-comments-title" className="t-sm fw-700">Comments</h2>
                <button type="button" className="icon-btn commission-post-dialog-close" aria-label="Close comments" onClick={() => setCommentsForArtistPost(null)}>
                  <Icon name="x" />
                </button>
              </div>
              {artistPostCommentsLoading ? (
                <div className="card t-sm c-mid" role="status">Loading comments...</div>
              ) : artistPostCommentsError ? (
                <div className="field-error" role="alert">{artistPostCommentsError}</div>
              ) : artistPostComments.length === 0 ? (
                <div className="card t-sm c-mid commission-applicants-state">No comments yet.</div>
              ) : (
                <div className="commission-applicants-list">
                  {artistPostComments.map((comment) => (
                    <article className="commission-applicant-card" key={comment.id}>
                      <div className="row-between" style={{ gap: 8 }}>
                        <span className="t-sm fw-700">{comment.author_name}</span>
                        {(comment.author_id === user?.id || commentsForArtistPost.owner_id === user?.id) && (
                          <div className="commission-comment-menu-wrap">
                            <IconButton
                              icon="dots"
                              ariaLabel={`Options for comment by ${comment.author_name}`}
                              onClick={() => setArtistPostCommentMenuId((current) => current === comment.id ? null : comment.id)}
                            />
                            {artistPostCommentMenuId === comment.id && (
                              <div className="card commission-post-menu" role="menu">
                                <button
                                  type="button"
                                  className="commission-post-menu-item c-danger"
                                  role="menuitem"
                                  onClick={() => {
                                    setArtistPostCommentMenuId(null);
                                    void deleteArtistPostComment(comment);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="commission-applicant-message">{comment.body}</p>
                    </article>
                  ))}
                </div>
              )}
              {artistPostCommentsError && <div className="field-error" role="alert">{artistPostCommentsError}</div>}
              {user && (
                <form onSubmit={(event) => void submitArtistPostComment(event)} className="commission-comment-form">
                  <label className="field-label" htmlFor="artist-post-comment">Add a comment</label>
                  <textarea
                    id="artist-post-comment"
                    className="textarea-field"
                    rows={3}
                    value={artistPostCommentDraft}
                    onChange={(event) => setArtistPostCommentDraft(event.target.value)}
                    maxLength={2000}
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={artistPostCommentSaving || !artistPostCommentDraft.trim()}>
                    {artistPostCommentSaving ? 'Posting…' : 'Post Comment'}
                  </button>
                </form>
              )}
            </section>
          </div>
        )}

        {requestsForArtistPost && (
          <div className="account-dialog-backdrop public-request-backdrop" role="presentation" onClick={() => setRequestsForArtistPost(null)}>
            <section
              className="account-dialog commission-comments-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="artist-post-requests-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="row-between" style={{ marginBottom: 14, gap: 12 }}>
                <h2 id="artist-post-requests-title" className="t-sm fw-700">Requests for {requestsForArtistPost.title}</h2>
                <button type="button" className="icon-btn commission-post-dialog-close" aria-label="Close requests" onClick={() => setRequestsForArtistPost(null)}>
                  <Icon name="x" />
                </button>
              </div>
              {artistPostApplicationsLoading ? (
                <div className="card t-sm c-mid" role="status">Loading requests...</div>
              ) : artistPostApplicationsError ? (
                <div className="field-error" role="alert">{artistPostApplicationsError}</div>
              ) : artistPostApplications.length === 0 ? (
                <div className="card t-sm c-mid commission-applicants-state">No requests yet.</div>
              ) : (
                <div className="commission-applicants-list">
                  {artistPostApplications.map((application) => (
                    <article className="commission-applicant-card" key={application.id}>
                      <div className="commission-post-author">
                        <div
                          className="avatar avatar-md commission-post-avatar"
                          style={application.applicant_avatar_data_url ? { backgroundImage: `url(${application.applicant_avatar_data_url})` } : undefined}
                        >
                          {!application.applicant_avatar_data_url && application.applicant_name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="commission-post-author-copy">
                          <div className="t-sm fw-700">{application.applicant_name}</div>
                          <div className="t-xs c-low">@{application.applicant_username} · Client</div>
                        </div>
                        <span className="badge badge-accent">{application.status}</span>
                      </div>
                      <p className="commission-applicant-message">{application.message}</p>
                      {application.status === 'PENDING' && requestsForArtistPost.status === 'OPEN' && (
                        <div className="commission-applicant-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={artistPostSelectionSaving}
                            onClick={() => void rejectArtistPostRequest(application)}
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={artistPostSelectionSaving}
                            onClick={() => {
                              setSelectingArtistPostApplication(application);
                              setArtistPostSelectionAmount('');
                              setArtistPostSelectionCurrency(requestsForArtistPost.currency ?? '');
                              setArtistPostSelectionError(null);
                            }}
                          >
                            Accept
                          </button>
                        </div>
                      )}
                      {selectingArtistPostApplication?.id === application.id && (
                        <div className="commission-selection-confirmation">
                          <label className="field-label" htmlFor="artist-post-selection-amount">Agreed amount</label>
                          <input
                            id="artist-post-selection-amount"
                            className="input-field"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={artistPostSelectionAmount}
                            onChange={(event) => setArtistPostSelectionAmount(event.target.value)}
                          />
                          <label className="field-label" htmlFor="artist-post-selection-currency">Currency</label>
                          <input
                            id="artist-post-selection-currency"
                            className="input-field"
                            maxLength={3}
                            value={artistPostSelectionCurrency}
                            onChange={(event) => setArtistPostSelectionCurrency(event.target.value.toUpperCase())}
                          />
                          {artistPostSelectionError && <div className="field-error" role="alert">{artistPostSelectionError}</div>}
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={artistPostSelectionSaving}
                            onClick={() => void acceptArtistPostRequest(application)}
                          >
                            {artistPostSelectionSaving ? 'Accepting…' : 'Confirm'}
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {requestingArtistPost && (
          <div className="account-dialog-backdrop public-request-backdrop" role="presentation" onClick={() => { if (!artistPostApplicationSaving) setRequestingArtistPost(null); }}>
            <section
              className="account-dialog public-request-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="artist-post-request-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="row-between" style={{ marginBottom: 12 }}>
                <h2 id="artist-post-request-title" className="t-sm fw-700">Request Commission</h2>
                <button type="button" className="icon-btn commission-post-dialog-close" aria-label="Close request" onClick={() => setRequestingArtistPost(null)}>
                  <Icon name="x" />
                </button>
              </div>
              <div className="t-sm fw-700">{requestingArtistPost.title}</div>
              <p className="commission-post-description">{requestingArtistPost.description}</p>
              <form onSubmit={(event) => void submitArtistPostApplication(event)}>
                <label className="field-label" htmlFor="artist-post-application-message">Message</label>
                <textarea
                  id="artist-post-application-message"
                  className="textarea-field"
                  rows={4}
                  value={artistPostApplicationMessage}
                  onChange={(event) => setArtistPostApplicationMessage(event.target.value)}
                  maxLength={2000}
                  required
                />
                {artistPostApplicationError && <div className="field-error" role="alert">{artistPostApplicationError}</div>}
                <button type="submit" className="btn btn-primary btn-sm" disabled={artistPostApplicationSaving || !artistPostApplicationMessage.trim()}>
                  {artistPostApplicationSaving ? 'Sending…' : 'Send Request'}
                </button>
              </form>
            </section>
          </div>
        )}

        {pendingArtistPostDelete && (
          <div className="account-dialog-backdrop commission-post-delete-backdrop" role="presentation" onClick={() => { if (!deletingArtistPost) setPendingArtistPostDelete(null); }}>
            <section
              className="account-dialog commission-post-delete-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="artist-post-delete-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="artist-post-delete-title" className="t-sm fw-700">Delete this public post?</h2>
              <p className="t-sm c-mid">This post will be permanently removed.</p>
              {artistPostDeleteError && <div className="field-error" role="alert">{artistPostDeleteError}</div>}
              <div className="commission-post-delete-actions">
                <button type="button" className="btn btn-ghost btn-sm" disabled={deletingArtistPost} onClick={() => setPendingArtistPostDelete(null)}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={deletingArtistPost} onClick={() => void deleteArtistPost()}>
                  {deletingArtistPost ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </section>
          </div>
        )}

        {profile.source === 'mock' && <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="section-title">Commission Pricing</span>
        </div>}
        {profile.source === 'mock' && <div className="stack-grid" style={{ paddingBottom: 14 }}>
          {profile.pricing.map((tier) => (
            <div className="card" key={tier.tier} style={{ padding: '14px 16px' }}>
              <div className="row-between">
                <span className="t-sm fw-600">{tier.tier}</span>
                <span className="mono fw-700 c-accent">₱{tier.price}</span>
              </div>
            </div>
          ))}
        </div>}

        {isSelf && (
          <button
            type="button"
            className="tap-card card"
            style={{
              marginBottom: 20,
              background: 'var(--ag-grad-primary)',
              border: 'none',
              boxShadow: '0 8px 20px rgba(201,147,42,0.35)',
            }}
            onClick={() => navigate('/profile/premium')}
          >
            <div className="row gap-10">
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  background: 'rgba(22,33,59,0.14)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name="crown" style={{ width: 18, height: 18, stroke: 'var(--ag-ink)' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-sm fw-700" style={{ color: 'var(--ag-ink)' }}>
                  {user?.isPro ? 'ArtGuard Pro active' : 'Upgrade to Pro'}
                </div>
                <div className="t-xs" style={{ color: 'rgba(22,33,59,0.75)' }}>
                  {user?.isPro ? 'Your mock Pro benefits are enabled' : '0% transaction fees, advanced shielding'}
                </div>
              </div>
              <Icon name="chevron-r" style={{ width: 16, height: 16, stroke: 'var(--ag-ink)' }} />
            </div>
          </button>
        )}
      </div>
      {toast}
    </ScreenShell>
  );
}
