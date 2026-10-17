import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { BottomNav } from '../components/ui/BottomNav';
import { IconButton } from '../components/ui/IconButton';
import { ArtTile } from '../components/ui/ArtTile';
import { ArtworkCard } from '../components/ui/ArtworkCard';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Icon } from '../assets/icons';
import { ARTISTS, DISCOVER_CATEGORIES } from '../data/mockData';
import { useMockToast } from '../components/ui/MockToast';
import { useArtworkFeed } from '../context/ArtworkFeedContext';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { listArtistProfiles } from '../lib/supabaseData';
import { listMarketplaceArtistReviewSummaries, listMarketplaceArtistServiceSummaries } from '../lib/supabaseMarketplace';
import { adaptSupabaseArtist, loadMockMarketplaceArtists, type MarketplaceArtist } from '../lib/marketplaceArtists';
import {
  createCommissionPostComment,
  createCommissionPostApplication,
  deleteCommissionPost,
  deleteCommissionPostComment,
  listCommissionPostComments,
  listCommissionPostEngagementSummaries,
  listPostApplicationsForOwner,
  rejectCommissionPostApplication,
  selectCommissionPostApplicant,
  listMyCommissionPosts,
  listMyCommissionPostApplications,
  listOpenCommissionPosts,
  withdrawCommissionPostApplication,
  updateCommissionPost,
  type CommissionPost,
  type CommissionPostComment,
  type OwnerCommissionPostApplication,
  type CommissionPostInput,
  type CommissionPostApplicationStatus,
  type MyCommissionPostApplication,
} from '../lib/supabaseCommissionPosts';
import './MarketplacePage.css';

const CATEGORIES = ['All', 'Character', 'Chibi', 'Concept Art', 'Portrait'];
type MarketTab = 'commissions' | 'discover';
type PriceFilter = 'all' | 'under-40' | '40-100' | 'over-100';
type RatingFilter = 'all' | '4.5' | '4.8';
type LikesFilter = 'all' | '100' | '200';
type CommissionSort = 'default' | 'price-low' | 'price-high';
type DiscoverSort = 'newest' | 'oldest' | 'popular';
type CommissionFeedSort = 'newest' | 'oldest' | 'budget-low' | 'budget-high';
type CommissionFeedBudgetFilter = 'all' | 'specified' | 'unspecified';
type CommissionFeedDateFilter = 'all' | 'today' | 'week' | 'month';

interface CommissionPostDraft {
  title: string;
  description: string;
  budgetMin: string;
  budgetMax: string;
  currency: string;
}

const APPLICATION_STATUS_STYLE: Record<CommissionPostApplicationStatus, string> = {
  PENDING: 'badge-warning',
  WITHDRAWN: 'badge-accent',
  SELECTED: 'badge-success',
  REJECTED: 'badge-danger',
};

function postedAgeInHours(label: string): number {
  const match = label.match(/(\d+)\s*(h|d)/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const amount = Number(match[1]);
  return match[2].toLowerCase() === 'd' ? amount * 24 : amount;
}

function formatPublicRequestBudget(post: CommissionPost): string {
  const formatAmount = (amount: number) => new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(amount);
  const currency = post.currency ? `${post.currency} ` : '';
  if (post.budget_min === null && post.budget_max === null) return 'Budget not specified';
  if (post.budget_min !== null && post.budget_max !== null) {
    return `${currency}${formatAmount(post.budget_min)} – ${formatAmount(post.budget_max)}`;
  }
  if (post.budget_min !== null) return `${currency}${formatAmount(post.budget_min)}+`;
  if (post.budget_max !== null) return `Up to ${currency}${formatAmount(post.budget_max)}`;
  return 'Budget not specified';
}

function formatPublicRequestDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Date unavailable';
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) return 'Posted just now';
  if (elapsedMinutes < 60) return `Posted ${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Posted ${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) return `Posted ${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;
  return `Posted ${new Date(timestamp).toLocaleDateString()}`;
}

function formatApplicationCreatedAt(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString()
    : 'Date unavailable';
}

function formatCommentCreatedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Date unavailable';
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d ago`;
  return new Date(timestamp).toLocaleString();
}

function friendlyApplicationError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The request could not be completed.';
  const normalized = message.toLowerCase();
  if (normalized.includes('not open') || normalized.includes('closed') || normalized.includes('application_post_not_open')) {
    return 'This commission request is no longer open. Refresh the feed and try another request.';
  }
  if (normalized.includes('already applied') || normalized.includes('application_already_exists')) {
    return 'You have already applied to this commission request. Your application status has been refreshed.';
  }
  if (normalized.includes('not authorized') || normalized.includes('not your')
    || normalized.includes('application_role_not_eligible') || normalized.includes('application_own_post')) {
    return 'You are not authorized to change this application.';
  }
  if (normalized.includes('only pending') || normalized.includes('application_not_pending')) {
    return 'Only a pending application can be withdrawn. Your application status has been refreshed.';
  }
  if (normalized.includes('message is required') || normalized.includes('application_invalid_message')) {
    return 'Add an application message before submitting.';
  }
  return 'The request could not be completed. Refresh the feed and try again.';
}

function sortPostsByBudget(posts: CommissionPost[], direction: 1 | -1): CommissionPost[] {
  const currencyOrder: string[] = [];
  const groups = new Map<string, CommissionPost[]>();
  for (const post of posts) {
    const currency = post.currency ?? '';
    if (!groups.has(currency)) {
      currencyOrder.push(currency);
      groups.set(currency, []);
    }
    groups.get(currency)?.push(post);
  }

  return currencyOrder.flatMap((currency) => {
    const group = groups.get(currency) ?? [];
    return group
      .map((post, index) => ({ post, index }))
      .sort((a, b) => {
        const aBudget = a.post.budget_min ?? a.post.budget_max;
        const bBudget = b.post.budget_min ?? b.post.budget_max;
        if (aBudget === null && bBudget === null) return a.index - b.index;
        if (aBudget === null) return 1;
        if (bBudget === null) return -1;
        const difference = direction * (aBudget - bBudget);
        return difference || a.index - b.index;
      })
      .map(({ post }) => post);
  });
}

export function MarketplacePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<MarketTab>('commissions');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeDiscoverTag, setActiveDiscoverTag] = useState('All');
  const [search, setSearch] = useState('');
  const [commissionPostSearch, setCommissionPostSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [artistFilter, setArtistFilter] = useState('All');
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('all');
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [openSlotsOnly, setOpenSlotsOnly] = useState(false);
  const [likesFilter, setLikesFilter] = useState<LikesFilter>('all');
  const [commissionSort, setCommissionSort] = useState<CommissionSort>('default');
  const [discoverSort, setDiscoverSort] = useState<DiscoverSort>('newest');
  const { toast, showToast } = useMockToast();
  const {
    posts,
    toggleLike,
    isSupabaseSource: isRealArtworkFeed,
    loading: artworksLoading,
    error: artworksError,
    refresh: refreshArtworks,
    likePendingIds,
    likeErrors,
  } = useArtworkFeed();
  const [realArtists, setRealArtists] = useState<MarketplaceArtist[]>([]);
  const [realServiceSummariesAvailable, setRealServiceSummariesAvailable] = useState(false);
  const [realReviewSummariesAvailable, setRealReviewSummariesAvailable] = useState(false);
  const [artistsLoading, setArtistsLoading] = useState(false);
  const [artistsError, setArtistsError] = useState<string | undefined>();
  const [commissionPosts, setCommissionPosts] = useState<CommissionPost[]>([]);
  const [myPostApplications, setMyPostApplications] = useState<MyCommissionPostApplication[]>([]);
  const [commissionPostsLoading, setCommissionPostsLoading] = useState(false);
  const [commissionPostsError, setCommissionPostsError] = useState(false);
  const [myCommissionPostsError, setMyCommissionPostsError] = useState(false);
  const [commissionPostEngagementError, setCommissionPostEngagementError] = useState(false);
  const [selectedPublicRequest, setSelectedPublicRequest] = useState<CommissionPost | null>(null);
  const [myPostsOnly, setMyPostsOnly] = useState(false);
  const [postFilterOpen, setPostFilterOpen] = useState(false);
  const [postBudgetFilter, setPostBudgetFilter] = useState<CommissionFeedBudgetFilter>('all');
  const [postCurrencyFilter, setPostCurrencyFilter] = useState('all');
  const [postDateFilter, setPostDateFilter] = useState<CommissionFeedDateFilter>('all');
  const [commissionFeedSort, setCommissionFeedSort] = useState<CommissionFeedSort>('newest');
  const [editingPost, setEditingPost] = useState<CommissionPost | null>(null);
  const [postDraft, setPostDraft] = useState<CommissionPostDraft | null>(null);
  const [postActionError, setPostActionError] = useState<string | null>(null);
  const [savingPost, setSavingPost] = useState(false);
  const [postEngagement, setPostEngagement] = useState<Record<string, { commentCount: number; applicationCount: number }>>({});
  const [openPostMenuId, setOpenPostMenuId] = useState<string | null>(null);
  const [pendingDeletePost, setPendingDeletePost] = useState<CommissionPost | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [postDeleteError, setPostDeleteError] = useState<string | null>(null);
  const [applicationMessage, setApplicationMessage] = useState('');
  const [submittingApplication, setSubmittingApplication] = useState(false);
  const [withdrawingApplicationId, setWithdrawingApplicationId] = useState<string | null>(null);
  const [applicationActionError, setApplicationActionError] = useState<string | null>(null);
  const [applicantsPost, setApplicantsPost] = useState<CommissionPost | null>(null);
  const [postApplicants, setPostApplicants] = useState<OwnerCommissionPostApplication[]>([]);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [applicantsError, setApplicantsError] = useState<string | null>(null);
  const [rejectingApplicationId, setRejectingApplicationId] = useState<string | null>(null);
  const [selectingApplicant, setSelectingApplicant] = useState<OwnerCommissionPostApplication | null>(null);
  const [viewingApplicant, setViewingApplicant] = useState<OwnerCommissionPostApplication | null>(null);
  const [selectionAmount, setSelectionAmount] = useState('');
  const [selectionCurrency, setSelectionCurrency] = useState('');
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selectingCommissionPostId, setSelectingCommissionPostId] = useState<string | null>(null);
  const [commentsPost, setCommentsPost] = useState<CommissionPost | null>(null);
  const [postComments, setPostComments] = useState<CommissionPostComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadError, setCommentsLoadError] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentValidationError, setCommentValidationError] = useState<string | null>(null);
  const [commentSubmitError, setCommentSubmitError] = useState<string | null>(null);
  const [commentPosted, setCommentPosted] = useState(false);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentPostNoLongerOpen, setCommentPostNoLongerOpen] = useState(false);
  const [openCommentMenuId, setOpenCommentMenuId] = useState<string | null>(null);
  const [commentPendingDelete, setCommentPendingDelete] = useState<CommissionPostComment | null>(null);
  const [commentDeleteError, setCommentDeleteError] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const commentSubmissionInFlight = useRef(false);
  const commentDeleteInFlight = useRef(false);
  const commentMenuRootRef = useRef<HTMLElement>(null);
  const commentsRequestId = useRef(0);
  const postDeleteInFlight = useRef(false);

  const isRealCommissionFeed = isSupabaseConfigured
    && (user?.role === 'artist' || user?.role === 'client');

  useEffect(() => {
    commentsRequestId.current += 1;
    setCommissionPosts([]);
    setCommissionPostsLoading(false);
    setCommissionPostsError(false);
    setMyCommissionPostsError(false);
    setMyPostApplications([]);
    setPostEngagement({});
    setCommissionPostEngagementError(false);
    setSelectedPublicRequest(null);
    setEditingPost(null);
    setPostDraft(null);
    setPostActionError(null);
    setApplicantsPost(null);
    setPostApplicants([]);
    setApplicantsLoading(false);
    setApplicantsError(null);
    setPendingDeletePost(null);
    setPostDeleteError(null);
    setCommentsPost(null);
    setPostComments([]);
    setCommentsLoading(false);
    setCommentsLoadError(false);
    setCommentDraft('');
    setCommentValidationError(null);
    setCommentSubmitError(null);
    setOpenCommentMenuId(null);
    setCommentPendingDelete(null);
    setCommentDeleteError(null);
    setViewingApplicant(null);
    setSelectingApplicant(null);
    setSelectionError(null);
    setApplicationMessage('');
    setApplicationActionError(null);
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!isRealCommissionFeed || activeTab !== 'commissions' || !user?.id) return;
    let active = true;
    setCommissionPostsLoading(true);
    setCommissionPostsError(false);
    setMyCommissionPostsError(false);
    setCommissionPostEngagementError(false);
    setCommissionPosts([]);
    setPostEngagement({});
    setMyPostApplications([]);
    setApplicationActionError(null);
    setMyPostsOnly(false);
    setCommissionPostSearch('');
    setPostBudgetFilter('all');
    setPostCurrencyFilter('all');
    setPostDateFilter('all');
    setCommissionFeedSort('newest');
    setApplicantsPost(null);
    setPostApplicants([]);
    setApplicantsError(null);
    const postsPromise = Promise.allSettled([
      listOpenCommissionPosts(),
      listMyCommissionPosts(),
    ]);
    void postsPromise
      .then(async (postsResult) => {
        if (!active) return;
        const [openPostsResult, myPostsResult] = postsResult;
        const openPosts = openPostsResult.status === 'fulfilled' ? openPostsResult.value : [];
        const myPosts = myPostsResult.status === 'fulfilled' ? myPostsResult.value : [];
        setCommissionPostsError(openPostsResult.status === 'rejected');
        setMyCommissionPostsError(myPostsResult.status === 'rejected');
        const postsById = new Map<string, CommissionPost>();
        for (const post of openPosts) postsById.set(post.id, post);
        for (const post of myPosts) {
          if (post.owner_id === user.id && post.owner_role === user.role) postsById.set(post.id, post);
        }
        const posts = [...postsById.values()];
        setCommissionPosts(posts);
        setCommissionPostsLoading(false);
        const [applicationsResult, summariesResult] = await Promise.allSettled([
          listMyCommissionPostApplications(),
          listCommissionPostEngagementSummaries(posts.map((post) => post.id)),
        ]);
        if (!active) return;
        if (applicationsResult.status === 'fulfilled') {
          setMyPostApplications(applicationsResult.value);
          setApplicationActionError(null);
        } else {
          setApplicationActionError('Application status unavailable.');
        }
        const summaries = summariesResult.status === 'fulfilled' ? summariesResult.value : [];
        const summariesByPost = new Map(summaries.map((summary) => [summary.commission_post_id, summary]));
        const summariesIncomplete = posts.some((post) => !summariesByPost.has(post.id));
        setCommissionPostEngagementError(
          summariesResult.status === 'rejected'
          || summariesIncomplete,
        );
        if (summariesResult.status === 'fulfilled') {
          setPostEngagement(Object.fromEntries(summaries.map((summary) => [summary.commission_post_id, {
            commentCount: Number(summary.comment_count),
            applicationCount: Number(summary.application_count),
          }])));
        }
      })
      .finally(() => {
        if (active) setCommissionPostsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, isRealCommissionFeed, user?.id, user?.role]);

  useEffect(() => {
    if (!openCommentMenuId) return;
    const closeMenuOnOutsideClick = (event: MouseEvent) => {
      if (commentMenuRootRef.current && !commentMenuRootRef.current.contains(event.target as Node)) {
        setOpenCommentMenuId(null);
      }
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenCommentMenuId(null);
    };
    document.addEventListener('mousedown', closeMenuOnOutsideClick);
    document.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenuOnOutsideClick);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [openCommentMenuId]);

  useEffect(() => {
    if (!openPostMenuId) return;
    const closeMenuOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.commission-post-menu-wrap')) {
        setOpenPostMenuId(null);
      }
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPostMenuId(null);
    };
    document.addEventListener('mousedown', closeMenuOnOutsideClick);
    document.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenuOnOutsideClick);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [openPostMenuId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      setRealArtists([]);
      setRealServiceSummariesAvailable(false);
      setRealReviewSummariesAvailable(false);
      setArtistsLoading(false);
      return;
    }
    let active = true;
    setArtistsLoading(true);
    setArtistsError(undefined);
    setRealServiceSummariesAvailable(false);
    setRealReviewSummariesAvailable(false);
    setPriceFilter('all');
    setRatingFilter('all');
    Promise.allSettled([
      listArtistProfiles(user.id),
      listMarketplaceArtistServiceSummaries(),
      listMarketplaceArtistReviewSummaries(),
    ])
      .then(([profilesResult, summariesResult, reviewSummariesResult]) => {
        if (!active) return;
        const serviceSummariesAvailable = summariesResult.status === 'fulfilled';
        const reviewSummariesAvailable = reviewSummariesResult.status === 'fulfilled';
        setRealServiceSummariesAvailable(serviceSummariesAvailable);
        setRealReviewSummariesAvailable(reviewSummariesAvailable);
        if (!serviceSummariesAvailable) setPriceFilter('all');
        if (!reviewSummariesAvailable) setRatingFilter('all');
        if (profilesResult.status === 'rejected') {
          setRealArtists([]);
          setArtistsError(profilesResult.reason instanceof Error ? profilesResult.reason.message : 'Could not load artists.');
          return;
        }
        const summaries = summariesResult.status === 'fulfilled' ? summariesResult.value : [];
        const summariesByArtistId = new Map(summaries.map((summary) => [summary.artist_id, summary]));
        const reviewSummaries = reviewSummariesResult.status === 'fulfilled' ? reviewSummariesResult.value : [];
        const reviewSummariesByArtistId = new Map(reviewSummaries.map((summary) => [summary.artist_id, summary]));
        setRealArtists(profilesResult.value.map((profile) => adaptSupabaseArtist(
          profile,
          summariesByArtistId.get(profile.id),
          reviewSummariesByArtistId.get(profile.id),
        )));
      })
      .finally(() => {
        if (active) setArtistsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const marketplaceArtists = isSupabaseConfigured ? realArtists : loadMockMarketplaceArtists(ARTISTS);
  const isRealArtistSource = isSupabaseConfigured;

  useEffect(() => {
    setPriceFilter('all');
    setRatingFilter('all');
    setOpenSlotsOnly(false);
  }, [isRealArtistSource]);

  useEffect(() => {
    if (!isRealArtistSource) return;
    if (!realServiceSummariesAvailable) setPriceFilter('all');
    if (!realReviewSummariesAvailable) setRatingFilter('all');
  }, [isRealArtistSource, realReviewSummariesAvailable, realServiceSummariesAvailable]);

  const filteredArtists = useMemo(() => {
    const matchingArtists = marketplaceArtists.filter((artist) => {
      const matchesCategory =
        activeCategory === 'All' || artist.tags.some((tag) => tag.toLowerCase().includes(activeCategory.toLowerCase()));
      const matchesSearch =
        !search.trim() ||
        artist.name.toLowerCase().includes(search.toLowerCase()) ||
        artist.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
      const matchesArtist = artistFilter === 'All' || artist.id === artistFilter;
      const matchesPrice = priceFilter === 'all' || (artist.source === 'mock'
        ? (priceFilter === 'under-40' && artist.startingPrice < 40)
          || (priceFilter === '40-100' && artist.startingPrice >= 40 && artist.startingPrice <= 100)
          || (priceFilter === 'over-100' && artist.startingPrice > 100)
        : artist.hasMultipleServiceCurrencies === false
          && artist.minimumServiceCurrency === 'PHP'
          && artist.minimumServicePrice !== undefined
          && ((priceFilter === 'under-40' && artist.minimumServicePrice < 2500)
            || (priceFilter === '40-100' && artist.minimumServicePrice >= 2500 && artist.minimumServicePrice <= 5000)
            || (priceFilter === 'over-100' && artist.minimumServicePrice > 5000)));
      const matchesRating = ratingFilter === 'all'
        || (artist.source === 'mock'
          ? artist.rating !== undefined
            && ((ratingFilter === '4.5' && artist.rating >= 4.5)
              || (ratingFilter === '4.8' && artist.rating >= 4.8))
          : artist.rating !== undefined
            && ((ratingFilter === '4.5' && artist.rating >= 4.5)
              || (ratingFilter === '4.8' && artist.rating >= 4.8)));
      return matchesCategory && matchesSearch && matchesArtist && matchesPrice && matchesRating
        // This marketplace artist list is still mock data; its verified flag is
        // intentionally isolated from real Supabase profile verification.
        && (!verifiedOnly || artist.verified === true) && (!isRealArtistSource || !openSlotsOnly || !artist.unavailableFields.has('slots')) && (!openSlotsOnly || artist.slots > 0);
    });
    if (commissionSort === 'default') return matchingArtists;
    if (!isRealArtistSource) {
      return [...matchingArtists].sort((a, b) => commissionSort === 'price-low'
        ? a.startingPrice - b.startingPrice
        : b.startingPrice - a.startingPrice);
    }

    const direction = commissionSort === 'price-low' ? 1 : -1;
    return matchingArtists
      .map((artist, index) => ({ artist, index }))
      .sort((a, b) => {
        const aPrice = a.artist.hasMultipleServiceCurrencies === false
          && a.artist.minimumServiceCurrency === 'PHP'
          && a.artist.minimumServicePrice !== undefined
          ? a.artist.minimumServicePrice
          : undefined;
        const bPrice = b.artist.hasMultipleServiceCurrencies === false
          && b.artist.minimumServiceCurrency === 'PHP'
          && b.artist.minimumServicePrice !== undefined
          ? b.artist.minimumServicePrice
          : undefined;

        if (aPrice !== undefined && bPrice !== undefined) {
          const priceDifference = direction * (aPrice - bPrice);
          if (priceDifference !== 0) return priceDifference;
          const nameDifference = a.artist.name.localeCompare(b.artist.name, undefined, { sensitivity: 'base' });
          return nameDifference !== 0 ? nameDifference : a.index - b.index;
        }
        if (aPrice !== undefined) return -1;
        if (bPrice !== undefined) return 1;
        return a.index - b.index;
      })
      .map(({ artist }) => artist);
  }, [activeCategory, artistFilter, commissionSort, isRealArtistSource, marketplaceArtists, openSlotsOnly, priceFilter, ratingFilter, search, verifiedOnly]);

  const filteredArtworks = useMemo(() => {
    const matchingArtworks = posts.filter((post) => {
      const matchesTag =
        activeDiscoverTag === 'All' || post.tags.some((tag) => tag.toLowerCase().includes(activeDiscoverTag.toLowerCase()));
      const term = search.trim().toLowerCase();
      const matchesSearch =
        !term ||
        post.artistName.toLowerCase().includes(term) ||
        (post.title?.toLowerCase().includes(term) ?? false) ||
        post.artistHandle.toLowerCase().includes(term) ||
        post.caption.toLowerCase().includes(term) ||
        post.tags.some((tag) => tag.toLowerCase().includes(term));
      const matchesArtist = artistFilter === 'All' || post.artistId === artistFilter;
      const matchesLikes = likesFilter === 'all'
        || (likesFilter === '100' && post.likes >= 100)
        || (likesFilter === '200' && post.likes >= 200);
      return matchesTag && matchesSearch && matchesArtist && matchesLikes;
    });
    return [...matchingArtworks].sort((a, b) => {
      if (discoverSort === 'popular') return b.likes - a.likes;
      if (isRealArtworkFeed) {
        return discoverSort === 'oldest'
          ? Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? '')
          : Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '');
      }
      const ageDifference = postedAgeInHours(a.postedLabel) - postedAgeInHours(b.postedLabel);
      return discoverSort === 'oldest' ? -ageDifference : ageDifference;
    });
  }, [activeDiscoverTag, artistFilter, discoverSort, isRealArtworkFeed, likesFilter, posts, search]);

  const isDiscover = activeTab === 'discover';
  const artistsWithPosts = marketplaceArtists.filter((artist) => posts.some((post) => post.artistId === artist.id));
  const commissionPostsForView = useMemo(() => {
    const base = myPostsOnly
      ? commissionPosts.filter((post) => post.owner_id === user?.id && post.owner_role === user?.role)
      : commissionPosts.filter((post) => post.status === 'OPEN');
    const term = commissionPostSearch.trim().toLowerCase();
    const dateBoundary = postDateFilter === 'today' ? 24 * 60 * 60 * 1000
      : postDateFilter === 'week' ? 7 * 24 * 60 * 60 * 1000
        : postDateFilter === 'month' ? 30 * 24 * 60 * 60 * 1000 : null;
    const cutoff = dateBoundary === null ? null : Date.now() - dateBoundary;
    const filtered = base.filter((post) => {
      const matchesSearch = !term
        || post.title.toLowerCase().includes(term)
        || post.description.toLowerCase().includes(term)
        || (post.owner_name ?? '').toLowerCase().includes(term);
      const hasBudget = post.budget_min !== null || post.budget_max !== null;
      const matchesBudget = postBudgetFilter === 'all'
        || (postBudgetFilter === 'specified' && hasBudget)
        || (postBudgetFilter === 'unspecified' && !hasBudget);
      const matchesCurrency = postCurrencyFilter === 'all'
        || (post.currency ?? 'unspecified') === postCurrencyFilter;
      const matchesDate = cutoff === null || Date.parse(post.created_at) >= cutoff;
      return matchesSearch && matchesBudget && matchesCurrency && matchesDate;
    });
    if (commissionFeedSort === 'newest') {
      return [...filtered].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    }
    if (commissionFeedSort === 'oldest') {
      return [...filtered].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    }
    return sortPostsByBudget(filtered, commissionFeedSort === 'budget-low' ? 1 : -1);
  }, [commissionFeedSort, commissionPostSearch, commissionPosts, myPostsOnly, postBudgetFilter, postCurrencyFilter, postDateFilter, user?.id]);
  const applicationsByPostId = useMemo(
    () => new Map(myPostApplications.map((application) => [application.commission_post_id, application])),
    [myPostApplications],
  );
  const selectedPublicRequestApplication = selectedPublicRequest
    ? applicationsByPostId.get(selectedPublicRequest.id)
    : undefined;
  const postCurrencies = useMemo(
    () => [...new Set(commissionPosts.map((post) => post.currency).filter((currency): currency is string => Boolean(currency)))].sort(),
    [commissionPosts],
  );
  const beginEditingPost = (post: CommissionPost) => {
    setEditingPost(post);
    setPostActionError(null);
    setPostDraft({
      title: post.title,
      description: post.description,
      budgetMin: post.budget_min === null ? '' : String(post.budget_min),
      budgetMax: post.budget_max === null ? '' : String(post.budget_max),
      currency: post.currency ?? '',
    });
  };
  const savePost = async () => {
    if (!editingPost || !postDraft) return;
    const title = postDraft.title.trim();
    const description = postDraft.description.trim();
    const budgetMin = postDraft.budgetMin.trim() ? Number(postDraft.budgetMin) : null;
    const budgetMax = postDraft.budgetMax.trim() ? Number(postDraft.budgetMax) : null;
    const currency = postDraft.currency.trim().toUpperCase() || null;
    if (!title || !description) {
      setPostActionError('Title and description are required.');
      return;
    }
    if ((budgetMin !== null && (!Number.isFinite(budgetMin) || budgetMin <= 0))
      || (budgetMax !== null && (!Number.isFinite(budgetMax) || budgetMax <= 0))
      || (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax)
      || (currency !== null && !/^[A-Z]{3}$/.test(currency))) {
      setPostActionError('Check the budget and currency values.');
      return;
    }
    const input: CommissionPostInput = { title, description, budgetMin, budgetMax, currency };
    setSavingPost(true);
    setPostActionError(null);
    try {
      const updated = await updateCommissionPost(editingPost.id, input);
      setCommissionPosts((current) => current.map((post) => post.id === updated.id ? updated : post));
      setSelectedPublicRequest(updated);
      setEditingPost(null);
      setPostDraft(null);
    } catch (error) {
      setPostActionError(error instanceof Error ? error.message : 'Could not update this commission request.');
    } finally {
      setSavingPost(false);
    }
  };
  const deletePublicPost = async () => {
    const post = pendingDeletePost;
    if (!post || !user || post.owner_id !== user.id || post.owner_role !== user.role
      || post.status !== 'OPEN' || postDeleteInFlight.current) return;
    postDeleteInFlight.current = true;
    setDeletingPostId(post.id);
    setPostDeleteError(null);
    try {
      await deleteCommissionPost(post.id);
      setCommissionPosts((current) => current.filter((item) => item.id !== post.id));
      setPostEngagement((current) => {
        const next = { ...current };
        delete next[post.id];
        return next;
      });
      setPendingDeletePost(null);
      setOpenPostMenuId(null);
      setSelectedPublicRequest((current) => current?.id === post.id ? null : current);
      setApplicantsPost((current) => current?.id === post.id ? null : current);
      setCommentsPost((current) => current?.id === post.id ? null : current);
      showToast('Commission request deleted');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setPostDeleteError(message.includes('POST_HAS_COMMISSION')
        ? 'This post cannot be deleted because a commission was created from it.'
        : message.includes('POST_NOT_OPEN')
          ? 'This request can no longer be deleted because it is no longer open or has been selected.'
        : message.includes('POST_NOT_FOUND')
          ? 'This request has already been deleted.'
          : 'Could not delete this request. Please try again.');
    } finally {
      postDeleteInFlight.current = false;
      setDeletingPostId(null);
    }
  };
  const refreshMyApplications = async () => {
    const applications = await listMyCommissionPostApplications();
    setMyPostApplications(applications);
  };
  const refreshPublicPosts = async () => {
    const [openPosts, myPosts] = await Promise.all([listOpenCommissionPosts(), listMyCommissionPosts()]);
    const postsById = new Map<string, CommissionPost>();
    for (const post of openPosts) postsById.set(post.id, post);
    for (const post of myPosts) postsById.set(post.id, post);
    setCommissionPosts([...postsById.values()]);
    setCommissionPostsError(false);
    setMyCommissionPostsError(false);
  };
  const submitApplication = async () => {
    if (!selectedPublicRequest || !user || selectedPublicRequest.owner_id === user.id
      || selectedPublicRequest.owner_role === user.role || submittingApplication) return;
    const message = applicationMessage.trim();
    if (!message) {
      setApplicationActionError('Application message is required.');
      return;
    }

    setSubmittingApplication(true);
    setApplicationActionError(null);
    try {
      const application = await createCommissionPostApplication(selectedPublicRequest.id, message);
      const ownApplication: MyCommissionPostApplication = {
        id: application.id,
        commission_post_id: application.commission_post_id,
        applicant_id: application.applicant_id,
        applicant_role: application.applicant_role,
        status: application.status,
        created_at: application.created_at,
      };
      setMyPostApplications((current) => [
        ownApplication,
        ...current.filter((item) => item.commission_post_id !== ownApplication.commission_post_id),
      ]);
      setPostEngagement((current) => ({
        ...current,
        [selectedPublicRequest.id]: {
          commentCount: current[selectedPublicRequest.id]?.commentCount ?? 0,
          applicationCount: (current[selectedPublicRequest.id]?.applicationCount ?? 0) + 1,
        },
      }));
      setApplicationMessage('');
      setSelectedPublicRequest(null);
      showToast('Application submitted');
    } catch (error) {
      const refreshResults = await Promise.allSettled([
        refreshMyApplications(),
        refreshPublicPosts(),
      ]);
      const refreshError = refreshResults.find((result) => result.status === 'rejected');
      setApplicationActionError(
        `${friendlyApplicationError(error)}${refreshError ? ' Could not refresh current request status.' : ''}`,
      );
    } finally {
      setSubmittingApplication(false);
    }
  };
  const withdrawApplication = async (application: MyCommissionPostApplication) => {
    if (!user || application.applicant_id !== user.id || application.applicant_role !== user.role
      || application.status !== 'PENDING' || withdrawingApplicationId) return;
    setWithdrawingApplicationId(application.id);
    setApplicationActionError(null);
    try {
      const withdrawn = await withdrawCommissionPostApplication(application.id);
      setMyPostApplications((current) => current.map((item) => item.id === withdrawn.id
        ? { ...item, status: withdrawn.status, created_at: withdrawn.created_at }
        : item));
      showToast('Application withdrawn');
    } catch (error) {
      let refreshFailed = false;
      try {
        await refreshMyApplications();
      } catch {
        refreshFailed = true;
      }
      setApplicationActionError(
        `${friendlyApplicationError(error)}${refreshFailed ? ' Could not refresh application status.' : ''}`,
      );
    } finally {
      setWithdrawingApplicationId(null);
    }
  };
  const openApplicants = async (post: CommissionPost) => {
    if (!user || post.owner_id !== user.id || post.owner_role !== user.role || applicantsLoading) return;
    setSelectedPublicRequest(post);
    setEditingPost(null);
    setApplicantsPost(post);
    setPostApplicants([]);
    setApplicantsError(null);
    setApplicantsLoading(true);
    try {
      setPostApplicants(await listPostApplicationsForOwner(post.id));
    } catch (error) {
      setApplicantsError(error instanceof Error ? error.message : 'Could not load applicants for this request.');
    } finally {
      setApplicantsLoading(false);
    }
  };
  const rejectPostApplication = async (application: OwnerCommissionPostApplication) => {
    if (!user || !applicantsPost || applicantsPost.owner_id !== user.id || applicantsPost.owner_role !== user.role
      || applicantsPost.status !== 'OPEN' || application.status !== 'PENDING' || rejectingApplicationId) return;
    setRejectingApplicationId(application.id);
    setApplicantsError(null);
    try {
      const rejected = await rejectCommissionPostApplication(application.id);
      setPostApplicants((current) => current.map((item) => item.id === rejected.id
        ? { ...item, status: rejected.status, updated_at: rejected.updated_at }
        : item));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setApplicantsError(message.includes('APPLICATION_NOT_PENDING')
        ? 'This request is no longer pending. Refresh the request list to see its latest status.'
        : 'Could not reject this request. Please try again.');
    } finally {
      setRejectingApplicationId(null);
    }
  };
  const openPostComments = async (post: CommissionPost) => {
    if (!isRealCommissionFeed || !user || commentsLoading) return;
    const canRead = post.owner_id === user.id || (post.status === 'OPEN' && post.owner_role !== user.role);
    if (!canRead) return;

    setCommentsPost(post);
    setPostComments([]);
    setCommentsLoading(true);
    setCommentsLoadError(false);
    setCommentDraft('');
    setCommentValidationError(null);
    setCommentSubmitError(null);
    setCommentPosted(false);
    setCommentPostNoLongerOpen(false);
    setOpenCommentMenuId(null);
    setCommentPendingDelete(null);
    setCommentDeleteError(null);
    const requestId = ++commentsRequestId.current;
    try {
      const comments = await listCommissionPostComments(post.id);
      if (requestId === commentsRequestId.current) setPostComments(comments);
    } catch {
      if (requestId === commentsRequestId.current) setCommentsLoadError(true);
    } finally {
      if (requestId === commentsRequestId.current) setCommentsLoading(false);
    }
  };
  const closePostComments = () => {
    if (commentSubmitting || deletingCommentId !== null) return;
    commentsRequestId.current += 1;
    setCommentsPost(null);
    setPostComments([]);
    setCommentDraft('');
    setCommentValidationError(null);
    setCommentSubmitError(null);
    setCommentPosted(false);
    setCommentPostNoLongerOpen(false);
    setOpenCommentMenuId(null);
    setCommentPendingDelete(null);
    setCommentDeleteError(null);
  };
  const submitPostComment = async () => {
    if (commentSubmissionInFlight.current || !commentsPost || !user || commentsLoading) return;
    const canComment = commentsPost.status === 'OPEN'
      && !commentPostNoLongerOpen
      && (commentsPost.owner_id === user.id || commentsPost.owner_role !== user.role);
    if (!canComment) return;

    const body = commentDraft.trim();
    if (!body) {
      setCommentValidationError('Write a comment before sending.');
      setCommentSubmitError(null);
      return;
    }
    if (Array.from(body).length > 2000) {
      setCommentValidationError('Comments must be 2000 characters or fewer.');
      setCommentSubmitError(null);
      return;
    }

    commentSubmissionInFlight.current = true;
    setCommentSubmitting(true);
    setCommentValidationError(null);
    setCommentSubmitError(null);
    setCommentPosted(false);
    try {
      const comment = await createCommissionPostComment(commentsPost.id, body);
      setPostComments((current) => [...current, comment]);
      setPostEngagement((current) => ({
        ...current,
        [commentsPost.id]: {
          commentCount: (current[commentsPost.id]?.commentCount ?? 0) + 1,
          applicationCount: current[commentsPost.id]?.applicationCount ?? 0,
        },
      }));
      setCommentDraft('');
      setCommentPosted(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('COMMENT_POST_NOT_OPEN')) {
        setCommentPostNoLongerOpen(true);
        let refreshFailed = false;
        try {
          if (commentsPost.owner_id === user.id) {
            const posts = await listMyCommissionPosts();
            const refreshedPost = posts.find((post) => post.id === commentsPost.id);
            if (refreshedPost) {
              setCommentsPost(refreshedPost);
              setCommissionPosts((current) => current.map((post) => post.id === refreshedPost.id ? refreshedPost : post));
              setSelectedPublicRequest((current) => current?.id === refreshedPost.id ? refreshedPost : current);
            }
          } else {
            const posts = await listOpenCommissionPosts();
            const stillOpen = posts.some((post) => post.id === commentsPost.id);
            if (!stillOpen) {
              setCommissionPosts((current) => current.filter((post) => post.id !== commentsPost.id));
            }
          }
        } catch {
          refreshFailed = true;
        }
        setCommentSubmitError(
          `This commission request is no longer open. Comments are now read-only.${refreshFailed ? ' Could not refresh the latest request status.' : ''}`,
        );
      } else {
        setCommentSubmitError('Couldn’t post your comment. Please try again.');
      }
    } finally {
      commentSubmissionInFlight.current = false;
      setCommentSubmitting(false);
    }
  };
  const canDeletePostComment = (comment: CommissionPostComment, post: CommissionPost) => (
    user?.id === comment.author_id
    || (user?.id === post.owner_id && user.role === post.owner_role)
  );
  const deletePostComment = async () => {
    if (!commentPendingDelete || commentDeleteInFlight.current || !commentsPost) return;
    if (!canDeletePostComment(commentPendingDelete, commentsPost)) {
      setCommentDeleteError('You are not authorized to delete this comment.');
      return;
    }
    commentDeleteInFlight.current = true;
    setDeletingCommentId(commentPendingDelete.id);
    setCommentDeleteError(null);
    try {
      await deleteCommissionPostComment(commentPendingDelete.id);
      setPostComments((current) => current.filter((comment) => comment.id !== commentPendingDelete.id));
      setPostEngagement((current) => ({
        ...current,
        [commentsPost.id]: {
          commentCount: Math.max(0, (current[commentsPost.id]?.commentCount ?? 0) - 1),
          applicationCount: current[commentsPost.id]?.applicationCount ?? 0,
        },
      }));
      setOpenCommentMenuId(null);
      setCommentPendingDelete(null);
    } catch {
      setCommentDeleteError('Could not delete this comment. Please try again.');
    } finally {
      commentDeleteInFlight.current = false;
      setDeletingCommentId(null);
    }
  };
  const openApplicantSelection = (application: OwnerCommissionPostApplication) => {
    if (!user || !applicantsPost || applicantsPost.owner_id !== user.id
      || applicantsPost.owner_role !== user.role || applicantsPost.status !== 'OPEN'
      || application.status !== 'PENDING') return;
    setSelectingApplicant(application);
    setSelectionAmount('');
    setSelectionCurrency(applicantsPost.currency ?? '');
    setSelectionError(null);
  };
  const refreshSelectionState = async (postId: string) => {
    const [applicationsResult, postsResult] = await Promise.allSettled([
      listPostApplicationsForOwner(postId),
      listMyCommissionPosts(),
    ]);
    if (applicationsResult.status === 'fulfilled') {
      setPostApplicants(applicationsResult.value);
      setSelectingApplicant((current) => current
        ? applicationsResult.value.find((application) => application.id === current.id) ?? current
        : current);
    }
    if (postsResult.status === 'fulfilled') {
      const updatedPost = postsResult.value.find((post) => post.id === postId);
      if (updatedPost) {
        setCommissionPosts((current) => current.map((post) => post.id === postId ? updatedPost : post));
        setApplicantsPost(updatedPost);
        setSelectedPublicRequest((current) => current?.id === postId ? updatedPost : current);
      }
    }
    return applicationsResult.status === 'fulfilled' && postsResult.status === 'fulfilled';
  };
  const submitArtistSelection = async () => {
    if (
      !user
      || !applicantsPost
      || applicantsPost.owner_id !== user.id
      || applicantsPost.owner_role !== user.role
      || applicantsPost.status !== 'OPEN'
      || !selectingApplicant
      || selectingApplicant.status !== 'PENDING'
      || selectingCommissionPostId
    ) return;

    const amount = Number(selectionAmount);
    const currency = selectionCurrency.trim();
    if (!selectionAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
      setSelectionError('Enter a final agreed amount greater than zero.');
      return;
    }
    if (Math.round(amount * 100) / 100 !== amount) {
      setSelectionError('Final agreed amount cannot have more than two decimal places.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      setSelectionError('Currency must be exactly three uppercase letters.');
      return;
    }
    if (applicantsPost.currency && currency !== applicantsPost.currency) {
      setSelectionError(`Currency must match the post currency (${applicantsPost.currency}).`);
      return;
    }
    if (applicantsPost.budget_min !== null && amount < applicantsPost.budget_min) {
      setSelectionError(`Final agreed amount must be at least ${applicantsPost.budget_min}.`);
      return;
    }
    if (applicantsPost.budget_max !== null && amount > applicantsPost.budget_max) {
      setSelectionError(`Final agreed amount cannot exceed ${applicantsPost.budget_max}.`);
      return;
    }

    const postId = applicantsPost.id;
    setSelectingCommissionPostId(postId);
    setSelectionError(null);
    try {
      await selectCommissionPostApplicant(
        postId,
        selectingApplicant.id,
        amount,
        currency,
      );
      const selectedPost = { ...applicantsPost, status: 'SELECTED' as const };
      setCommissionPosts((current) => current.map((post) => post.id === postId ? selectedPost : post));
      setSelectedPublicRequest((current) => current?.id === postId ? selectedPost : current);
      setPostApplicants((current) => current.map((application) => ({
        ...application,
        status: application.id === selectingApplicant.id
          ? 'SELECTED'
          : application.status === 'PENDING' ? 'REJECTED' : application.status,
      })));
      setSelectingApplicant(null);
      setApplicantsPost(null);
      setSelectedPublicRequest(null);
      showToast('Applicant selected. Commission request created.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const refreshSucceeded = await refreshSelectionState(postId);
      const normalized = message.toUpperCase();
      const friendlyMessage = normalized.includes('SELECTION_POST_NOT_OPEN')
        || normalized.includes('SELECTION_ALREADY_COMPLETED')
        ? 'This commission post is no longer available for selection. The latest post and applicant status has been loaded.'
        : normalized.includes('SELECTION_APPLICATION_NOT_PENDING')
          || normalized.includes('SELECTION_APPLICATION_NOT_FOUND')
          ? 'This request is no longer pending. The latest applicant status has been loaded.'
          : 'Could not select this applicant. Please try again.';
      setSelectionError(`${friendlyMessage}${refreshSucceeded ? '' : ' Could not refresh the latest post and applicant status.'}`);
    } finally {
      setSelectingCommissionPostId(null);
    }
  };
  const isPostOwner = (post: CommissionPost) => Boolean(
    user && post.owner_id === user.id && post.owner_role === user.role,
  );
  const commissionFeedLoadError = myPostsOnly
    ? myCommissionPostsError
    : commissionPostsError;
  const commissionFilterCount = (postBudgetFilter !== 'all' ? 1 : 0)
    + (postCurrencyFilter !== 'all' ? 1 : 0)
    + (postDateFilter !== 'all' ? 1 : 0);
  const resetCommissionFilters = () => {
    setPostBudgetFilter('all');
    setPostCurrencyFilter('all');
    setPostDateFilter('all');
  };
  const activeFilterCount = isDiscover
    ? (activeDiscoverTag !== 'All' ? 1 : 0) + (artistFilter !== 'All' ? 1 : 0) + (likesFilter !== 'all' ? 1 : 0)
    : (activeCategory !== 'All' ? 1 : 0) + (artistFilter !== 'All' ? 1 : 0) + (priceFilter !== 'all' ? 1 : 0)
      + (verifiedOnly ? 1 : 0)
      + (ratingFilter !== 'all' ? 1 : 0)
      + (!isRealArtistSource && openSlotsOnly ? 1 : 0);

  const resetFilters = () => {
    setArtistFilter('All');
    setPriceFilter('all');
    setRatingFilter('all');
    setVerifiedOnly(false);
    setOpenSlotsOnly(false);
    setLikesFilter('all');
    setActiveCategory('All');
    setActiveDiscoverTag('All');
  };

  const filterPanel = filtersOpen ? (
    <div className="market-filter-panel ag-liquid-glass" role="region" aria-label="Marketplace filters">
      <div className="row-between market-filter-heading">
        <span className="t-sm fw-700">Filter results</span>
        <button type="button" className="link-sm" onClick={resetFilters} disabled={activeFilterCount === 0}>
          Clear filters
        </button>
      </div>
      <div className="market-filter-grid">
        <label className="market-filter-field">
          <span className="t-xs c-low">Artist</span>
          <select value={artistFilter} onChange={(event) => setArtistFilter(event.target.value)}>
            <option value="All">All artists</option>
            {(isDiscover ? artistsWithPosts : marketplaceArtists).map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}
          </select>
        </label>
          {isDiscover && !isRealArtworkFeed ? (
          <label className="market-filter-field">
            <span className="t-xs c-low">Popularity</span>
            <select value={likesFilter} onChange={(event) => setLikesFilter(event.target.value as LikesFilter)}>
              <option value="all">Any likes</option>
              <option value="100">100+ likes</option>
              <option value="200">200+ likes</option>
            </select>
          </label>
        ) : (
          <>
            <label className="market-filter-field">
              <span className="t-xs c-low">Starting price</span>
              <select value={priceFilter} onChange={(event) => setPriceFilter(event.target.value as PriceFilter)}>
                <option value="all">Any price</option>
                <option value="under-40" disabled={isRealArtistSource && !realServiceSummariesAvailable}>{isRealArtistSource ? 'Under PHP 2,500' : 'Under ₱40'}</option>
                <option value="40-100" disabled={isRealArtistSource && !realServiceSummariesAvailable}>{isRealArtistSource ? 'PHP 2,500–5,000' : '₱40–₱100'}</option>
                <option value="over-100" disabled={isRealArtistSource && !realServiceSummariesAvailable}>{isRealArtistSource ? 'Over PHP 5,000' : 'Over ₱100'}</option>
              </select>
              {isRealArtistSource && (
                <span className="t-xs c-low">
                  PHP price ranges apply only to single-currency PHP service summaries.
                  {!realServiceSummariesAvailable && ` ${artistsLoading ? 'Service summaries are loading; numeric ranges are disabled.' : 'Service summaries are unavailable; numeric ranges are disabled.'}`}
                </span>
              )}
            </label>
            <label className="market-filter-field">
              <span className="t-xs c-low">Minimum rating</span>
              <select value={ratingFilter} onChange={(event) => setRatingFilter(event.target.value as RatingFilter)}>
                <option value="all">Any rating</option>
                <option value="4.5" disabled={isRealArtistSource && !realReviewSummariesAvailable}>4.5+ stars</option>
                <option value="4.8" disabled={isRealArtistSource && !realReviewSummariesAvailable}>4.8+ stars</option>
              </select>
              {isRealArtistSource && !realReviewSummariesAvailable && (
                <span className="t-xs c-low">
                  {artistsLoading ? 'Review summaries are loading; rating thresholds are disabled.' : 'Review summaries are unavailable; rating thresholds are disabled.'}
                </span>
              )}
            </label>
          </>
        )}
      </div>
      {!isDiscover && !isRealArtistSource && (
        <div className="market-filter-checks">
          <label><input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} /> Verified artists</label>
          <label><input type="checkbox" checked={openSlotsOnly} onChange={(event) => setOpenSlotsOnly(event.target.checked)} /> Has open slots</label>
        </div>
      )}
      {!isDiscover && isRealArtistSource && (
        <div className="market-filter-checks">
          <label><input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} /> Verified artists</label>
        </div>
      )}
    </div>
  ) : null;

  const sortControl = (
    <label className="market-sort-control">
      <span className="t-xs c-low">Sort by</span>
      <select
        aria-label="Sort marketplace results"
        value={isDiscover ? discoverSort : commissionSort}
        onChange={(event) => {
          if (isDiscover) setDiscoverSort(event.target.value as DiscoverSort);
          else setCommissionSort(event.target.value as CommissionSort);
        }}
      >
        {isDiscover ? (
          <>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="popular">Most popular</option>
          </>
        ) : (
          <>
            <option value="default">Featured</option>
            <option value="price-low">Price: Low to High</option>
            <option value="price-high">Price: High to Low</option>
          </>
        )}
      </select>
    </label>
  );

  const commissionPostFilterPanel = postFilterOpen ? (
    <div className="market-filter-panel commission-post-filter-panel ag-liquid-glass" role="region" aria-label="Commission post filters">
      <div className="row-between market-filter-heading">
        <span className="t-sm fw-700">Filter commission posts</span>
        <button type="button" className="link-sm" onClick={resetCommissionFilters} disabled={commissionFilterCount === 0}>
          Clear filters
        </button>
      </div>
      <div className="market-filter-grid">
        <label className="market-filter-field">
          <span className="t-xs c-low">Budget</span>
          <select value={postBudgetFilter} onChange={(event) => setPostBudgetFilter(event.target.value as CommissionFeedBudgetFilter)}>
            <option value="all">Any budget</option>
            <option value="specified">Budget specified</option>
            <option value="unspecified">Budget not specified</option>
          </select>
        </label>
        {postCurrencies.length > 0 && (
          <label className="market-filter-field">
            <span className="t-xs c-low">Currency</span>
            <select value={postCurrencyFilter} onChange={(event) => setPostCurrencyFilter(event.target.value)}>
              <option value="all">All currencies</option>
              {postCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              {commissionPosts.some((post) => !post.currency) && <option value="unspecified">Not specified</option>}
            </select>
          </label>
        )}
        <label className="market-filter-field">
          <span className="t-xs c-low">Posted</span>
          <select value={postDateFilter} onChange={(event) => setPostDateFilter(event.target.value as CommissionFeedDateFilter)}>
            <option value="all">Any time</option>
            <option value="today">Past 24 hours</option>
            <option value="week">Past 7 days</option>
            <option value="month">Past 30 days</option>
          </select>
        </label>
      </div>
    </div>
  ) : null;

  return (
    <ScreenShell
      contentClassName="market-content-inner"
      header={
        <div className="px-hd market-px-hd">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <span className="h-title">Marketplace</span>
            {!isRealCommissionFeed && <IconButton icon="sliders" onClick={() => setFiltersOpen((open) => !open)} ariaLabel="Filters" />}
          </div>
          <div style={{ marginBottom: 14 }}>
            <SegmentedControl
              ariaLabel="Marketplace section"
              value={activeTab}
              onChange={(nextTab: MarketTab) => setActiveTab(nextTab)}
              options={[
                { value: 'commissions', label: 'Commissions' },
                { value: 'discover', label: 'Discover' },
              ]}
            />
          </div>
          {isRealCommissionFeed && activeTab === 'commissions' ? (
            <div className="search-bar ag-liquid-glass-soft" style={{ marginBottom: 14 }}>
              <Icon name="search" style={{ width: 16, height: 16 }} />
              <input
                type="text"
                placeholder="Search commission requests"
                value={commissionPostSearch}
                onChange={(event) => setCommissionPostSearch(event.target.value)}
                aria-label="Search commission posts by title or description"
              />
            </div>
          ) : (
            <>
              <div className="search-bar ag-liquid-glass-soft" style={{ marginBottom: 14 }}>
                <Icon name="search" style={{ width: 16, height: 16 }} />
                <input
                  type="text"
                  placeholder={isDiscover ? 'Search artworks, artists, tags' : 'Search artists, styles, tags'}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={isDiscover ? 'Search artworks, artists, tags' : 'Search artists, styles, tags'}
                />
              </div>
              <div className="chip-row">
                {(isDiscover ? DISCOVER_CATEGORIES : CATEGORIES).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`chip${cat === (isDiscover ? activeDiscoverTag : activeCategory) ? ' chip-active' : ''}`}
                    onClick={() => (isDiscover ? setActiveDiscoverTag(cat) : setActiveCategory(cat))}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              {sortControl}
              {filterPanel}
            </>
          )}
        </div>
      }
      footer={<BottomNav active="market" />}
    >
      {isDiscover ? (
        <>
          <div className="row-between" style={{ margin: '6px 0 14px' }}>
            <span className="section-title">Discover Feed</span>
            <span className="t-xs c-low">{filteredArtworks.length} artworks</span>
          </div>

          {!isRealArtworkFeed && (
            <div className="artwork-feed-notice" role="note">
              Demo feed · likes and comments are session-only.
            </div>
          )}
          {isRealArtworkFeed && artworksLoading && (
            <div className="card t-sm c-mid" role="status">Loading published protected artwork…</div>
          )}
          {isRealArtworkFeed && !user && (
            <div className="card t-sm c-mid" role="status">Sign in to view and interact with published artwork.</div>
          )}
          {isRealArtworkFeed && !artworksLoading && artworksError && (
            <div className="card t-sm c-mid" role="alert">
              <div>Could not load published artwork: {artworksError}</div>
              <button type="button" className="link-sm" onClick={refreshArtworks}>Try again</button>
            </div>
          )}
          {(!isRealArtworkFeed || (user && !artworksLoading && !artworksError)) && filteredArtworks.length === 0 && (
            <div className="card t-sm c-mid" style={{ textAlign: 'center', marginBottom: 14 }}>
              {isRealArtworkFeed ? 'No published artwork matches these filters yet.' : 'No artworks match that search.'}
            </div>
          )}

          <div className="artwork-masonry">
            {(!isRealArtworkFeed || (user && !artworksLoading && !artworksError)) && filteredArtworks.map((post) => (
              <ArtworkCard
                key={post.id}
                post={post}
                onOpen={(id) => navigate(`/market/artwork/${id}`)}
                onToggleLike={toggleLike}
                likePending={likePendingIds.includes(post.id)}
                likeError={likeErrors[post.id]}
              />
            ))}
          </div>
        </>
      ) : isRealCommissionFeed ? (
        <section className="commission-feed" aria-label="Commission feed">
          <div className="commission-feed-heading">COMMISSION FEED</div>
          <div className="commission-feed-tabs" role="tablist" aria-label="Commission posts">
            <button type="button" role="tab" aria-selected={!myPostsOnly} className={!myPostsOnly ? 'active' : ''} onClick={() => setMyPostsOnly(false)}>
              All Posts
            </button>
            <button type="button" role="tab" aria-selected={myPostsOnly} className={myPostsOnly ? 'active' : ''} onClick={() => setMyPostsOnly(true)}>
              My Posts
            </button>
          </div>

          <div className="commission-feed-toolbar">
            <button type="button" className="btn btn-ghost btn-sm commission-feed-filter" aria-expanded={postFilterOpen} onClick={() => setPostFilterOpen((open) => !open)}>
              <Icon name="sliders" style={{ width: 14, height: 14 }} />
              Filter
              {commissionFilterCount > 0 && <span className="badge badge-accent">{commissionFilterCount}</span>}
            </button>
          </div>
          {commissionPostFilterPanel}
          {applicationActionError && (
            <div className="t-xs c-low commission-application-feed-error" role="status">{applicationActionError}</div>
          )}
          {commissionPostEngagementError && (
            <div className="t-xs c-low commission-engagement-unavailable" role="status">
              Some engagement details are temporarily unavailable.
            </div>
          )}

          {commissionPostsLoading ? (
            <div className="card t-sm c-mid commission-feed-state" role="status">Loading commissions…</div>
          ) : commissionFeedLoadError ? (
            <div className="card t-sm c-mid commission-feed-state" role="alert">
              {myPostsOnly
                ? user?.role === 'artist' ? 'Could not load your public posts.' : 'Could not load your public requests.'
                : 'Could not load commission requests.'}
            </div>
          ) : commissionPostsForView.length === 0 ? (
            <div className="card t-sm c-mid commission-feed-state commission-feed-empty" role="status">
              {myPostsOnly
                ? user?.role === 'artist' ? 'You haven’t created a public post yet.' : 'You haven’t posted a commission request yet.'
                : 'No public commission requests yet.'}
            </div>
          ) : (
            <div className="commission-post-feed">
              {commissionPostsForView.map((post) => {
                const isCurrentOwner = isPostOwner(post);
                const application = applicationsByPostId.get(post.id);
                const canApply = Boolean(user && !isCurrentOwner && post.owner_role !== user.role);
                const canReadComments = Boolean(user && (
                  isCurrentOwner || (post.status === 'OPEN' && post.owner_role !== user.role)
                ));
                const displayName = post.owner_name ?? (isCurrentOwner ? user?.name : 'User');
                const avatar = post.owner_avatar_data_url ?? (isCurrentOwner ? user?.avatarDataUrl : null);
                const ownerUsername = post.owner_username ?? (isCurrentOwner ? user?.username : null);
                const engagement = postEngagement[post.id];
                return (
                  <article className="commission-post-card ag-liquid-glass-soft" key={post.id}>
                    <div className="commission-post-card-header">
                      <div className="commission-post-author">
                        <div className="avatar avatar-md commission-post-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>
                          {!avatar && displayName.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="commission-post-author-copy">
                          <div className="t-sm fw-700 commission-post-author-name">{displayName}</div>
                          <div className="t-xs c-low">
                            {ownerUsername ? `@${ownerUsername} · ` : ''}{post.owner_role === 'client' ? 'Client' : 'Artist'} · {formatPublicRequestDate(post.created_at)}
                          </div>
                        </div>
                      </div>
                      {post.status !== 'OPEN' && (
                        <span className="badge badge-accent">{post.status}</span>
                      )}
                      {isCurrentOwner && post.status === 'OPEN' && (
                        <div className="commission-post-menu-wrap">
                          <IconButton
                            icon="dots"
                            ariaLabel={`Options for ${post.title}`}
                            onClick={() => setOpenPostMenuId((current) => current === post.id ? null : post.id)}
                          />
                          {openPostMenuId === post.id && (
                            <div className="card commission-post-menu" role="menu">
                              <button
                                type="button"
                                className="commission-post-menu-item"
                                role="menuitem"
                                onClick={() => {
                                  setSelectedPublicRequest(post);
                                  beginEditingPost(post);
                                  setOpenPostMenuId(null);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="commission-post-menu-item c-danger"
                                role="menuitem"
                                onClick={() => {
                                  setPendingDeletePost(post);
                                  setPostDeleteError(null);
                                  setOpenPostMenuId(null);
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
                      <div className="commission-post-budget">{formatPublicRequestBudget(post)}</div>
                    )}
                    <div className="commission-post-engagement" aria-label="Post engagement">
                      <button
                        type="button"
                        className="commission-post-comment-count"
                        onClick={() => { if (canReadComments) void openPostComments(post); }}
                        disabled={!canReadComments}
                        aria-label={`Comments for ${post.title}: ${engagement ? engagement.commentCount : 'count unavailable'}`}
                      >
                        <Icon name="chat" />{engagement ? engagement.commentCount : '—'}
                      </button>
                      {isCurrentOwner ? (
                        <button
                          type="button"
                          className="commission-post-comment-count"
                          aria-label={`View requests for ${post.title}${engagement ? `: ${engagement.applicationCount} requests` : ''}`}
                          title="View requests"
                          onClick={() => void openApplicants(post)}
                        >
                          <Icon name="user" />
                          {engagement && engagement.applicationCount > 0 ? engagement.applicationCount : ''}
                        </button>
                      ) : canApply && post.status === 'OPEN' ? (
                        <button
                          type="button"
                          className="commission-post-comment-count"
                          aria-label={application
                            ? `${application.status === 'PENDING' ? 'View pending request' : `View ${application.status.toLowerCase()} request`} for ${post.title}`
                            : `${user?.role === 'artist' ? 'Apply to' : 'Request'} ${post.title}`}
                          title={application ? `Request status: ${application.status}` : user?.role === 'artist' ? 'Apply for this commission' : 'Request this commission'}
                          onClick={() => {
                            setSelectedPublicRequest(post);
                            setEditingPost(null);
                            setApplicationMessage('');
                            setApplicationActionError(null);
                          }}
                        >
                          <Icon name={application ? 'user' : 'send'} />
                          {engagement && engagement.applicationCount > 0 ? engagement.applicationCount : ''}
                        </button>
                      ) : null}
                    </div>
                    <div className="commission-post-meta">
                      <span className="t-xs c-low">{formatPublicRequestDate(post.created_at)}</span>
                      {application && !isCurrentOwner && (
                        <span className={`badge ${APPLICATION_STATUS_STYLE[application.status]}`}>
                          {application.status === 'PENDING' ? 'Request · Pending' : application.status[0] + application.status.slice(1).toLowerCase()}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {commentsPost && user?.role && (
            <div
              className="account-dialog-backdrop public-request-backdrop"
              role="presentation"
              onClick={closePostComments}
            >
              <section
                className="account-dialog commission-comments-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="commission-comments-title"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!(event.target instanceof Element) || !event.target.closest('.commission-comment-menu-wrap')) {
                    setOpenCommentMenuId(null);
                  }
                }}
                ref={commentMenuRootRef}
              >
                <div className="row-between commission-applicants-heading">
                  <div className="commission-comments-heading-copy">
                    <h2 id="commission-comments-title" className="t-sm fw-700" style={{ margin: '0 0 4px' }}>Comments</h2>
                    <div className="t-xs c-low commission-comments-post-title">{commentsPost.title}</div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn commission-comments-close"
                    onClick={closePostComments}
                    disabled={commentSubmitting || deletingCommentId !== null}
                    aria-label="Close comments"
                    title="Close comments"
                  >
                    <Icon name="x" style={{ width: 15, height: 15 }} />
                  </button>
                </div>

                <div className="commission-comments-list" aria-busy={commentsLoading}>
                  {commentsLoading ? (
                    <div className="card t-sm c-mid commission-applicants-state" role="status">Loading comments…</div>
                  ) : commentsLoadError ? (
                    <div className="commission-comments-load-error" role="alert">
                      <div className="t-sm c-mid">Couldn’t load comments.</div>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openPostComments(commentsPost)}>
                        Try again
                      </button>
                    </div>
                  ) : postComments.length === 0 ? (
                    <div className="card t-sm c-mid commission-applicants-state">No comments yet.</div>
                  ) : (
                    postComments.map((comment) => (
                      <article className="commission-comment-card" key={comment.id}>
                        <div className="commission-comment-header">
                          <div className="commission-comment-author">
                            <div
                              className="avatar avatar-sm commission-post-avatar"
                              style={comment.author_avatar_data_url ? { backgroundImage: `url(${comment.author_avatar_data_url})` } : undefined}
                            >
                              {!comment.author_avatar_data_url && comment.author_name.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="commission-comment-author-copy">
                              <div className="t-sm fw-700 commission-post-author-name">{comment.author_name}</div>
                              <div className="t-xs c-low">
                                {comment.author_username ? `@${comment.author_username} · ` : ''}
                                {comment.author_role === 'client' ? 'Client' : 'Artist'}
                                {' · '}{formatCommentCreatedAt(comment.created_at)}
                              </div>
                            </div>
                          </div>
                          <div className="commission-comment-menu-wrap">
                            <IconButton
                              icon="dots"
                              ariaLabel={`Comment options by ${comment.author_name}`}
                              style={{ width: 34, height: 34, flexShrink: 0 }}
                              onClick={() => setOpenCommentMenuId((current) => current === comment.id ? null : comment.id)}
                            />
                            {openCommentMenuId === comment.id && (
                              <div className="card commission-comment-menu" role="menu">
                                {canDeletePostComment(comment, commentsPost) ? (
                                  <button
                                    type="button"
                                    className="commission-comment-menu-item c-danger"
                                    role="menuitem"
                                    onClick={() => {
                                      setCommentPendingDelete(comment);
                                      setCommentDeleteError(null);
                                      setOpenCommentMenuId(null);
                                    }}
                                  >
                                    Delete
                                  </button>
                                ) : (
                                  <div className="commission-comment-menu-empty" role="status">No actions available</div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="commission-comment-body">{comment.body}</p>
                      </article>
                    ))
                  )}
                </div>

                {commentsPost.status === 'OPEN'
                && (commentsPost.owner_id === user.id || commentsPost.owner_role !== user.role) ? (
                  <form
                    className="commission-comment-composer"
                    onSubmit={(event) => { event.preventDefault(); void submitPostComment(); }}
                    aria-busy={commentSubmitting}
                  >
                    <label className="field-label" htmlFor="commission-post-comment-body">Write a comment</label>
                    <textarea
                      id="commission-post-comment-body"
                      className="textarea-field"
                      rows={3}
                      maxLength={4000}
                      value={commentDraft}
                      onChange={(event) => {
                        setCommentDraft(event.target.value);
                        setCommentValidationError(null);
                        setCommentSubmitError(null);
                        setCommentPosted(false);
                      }}
                      disabled={commentSubmitting || commentPostNoLongerOpen}
                      aria-describedby="commission-post-comment-limit"
                    />
                    <div id="commission-post-comment-limit" className="t-xs c-low commission-comment-limit">
                      {Array.from(commentDraft).length}/2000 characters
                    </div>
                    {commentValidationError && <div className="field-error" role="alert">{commentValidationError}</div>}
                    {commentSubmitError && <div className="field-error" role="alert">{commentSubmitError}</div>}
                    {commentPosted && <div className="t-xs c-success" role="status">Comment posted.</div>}
                    {commentPostNoLongerOpen && !commentSubmitError && (
                      <div className="t-xs c-low" role="status">This post is no longer open. Comments are read-only.</div>
                    )}
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={commentSubmitting || commentsLoading || commentPostNoLongerOpen}
                    >
                      {commentSubmitting ? 'Sending…' : 'Send'}
                    </button>
                  </form>
                ) : (
                  <div className="commission-comments-read-only t-xs c-low" role="status">
                    Comments are read-only because this post is no longer open.
                  </div>
                )}
                {commentPendingDelete && (
                  <div className="commission-comment-delete-backdrop" role="presentation">
                    <section
                      className="account-dialog commission-comment-delete-dialog"
                      role="alertdialog"
                      aria-modal="true"
                      aria-labelledby="commission-comment-delete-title"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <h3 id="commission-comment-delete-title" className="t-sm fw-700">Delete this comment?</h3>
                      <p className="t-sm c-mid">This comment will be permanently removed.</p>
                      {commentDeleteError && <div className="field-error" role="alert">{commentDeleteError}</div>}
                      <div className="commission-comment-delete-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={deletingCommentId !== null}
                          onClick={() => { setCommentPendingDelete(null); setCommentDeleteError(null); }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={deletingCommentId !== null}
                          onClick={() => void deletePostComment()}
                        >
                          {deletingCommentId ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </section>
                  </div>
                )}
              </section>
            </div>
          )}

          {selectedPublicRequest && (
            <div className="account-dialog-backdrop public-request-backdrop" role="presentation" onClick={() => { if (!savingPost && !submittingApplication) { setSelectedPublicRequest(null); setEditingPost(null); } }}>
              <section className="account-dialog public-request-dialog" role="dialog" aria-modal="true" aria-labelledby="commission-post-dialog-title" onClick={(event) => event.stopPropagation()}>
                <div className="commission-post-author">
                  {(() => {
                    const avatar = selectedPublicRequest.owner_avatar_data_url
                      ?? (isPostOwner(selectedPublicRequest) ? user?.avatarDataUrl : null);
                    const name = selectedPublicRequest.owner_name
                      ?? (isPostOwner(selectedPublicRequest) ? user?.name : 'User');
                    return (
                      <>
                        <div className="avatar avatar-md commission-post-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>
                          {!avatar && (name || 'C').slice(0, 1).toUpperCase()}
                        </div>
                        <div className="commission-post-author-copy">
                          <div className="t-sm fw-700 commission-post-author-name">{name}</div>
                          <div className="t-xs c-low">
                            {selectedPublicRequest.owner_username ? `@${selectedPublicRequest.owner_username} · ` : ''}
                            {selectedPublicRequest.owner_role === 'client' ? 'Client' : 'Artist'} · {formatPublicRequestDate(selectedPublicRequest.created_at)}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                  <button
                    type="button"
                    className="icon-btn commission-post-dialog-close"
                    disabled={submittingApplication}
                    onClick={() => { setSelectedPublicRequest(null); setEditingPost(null); setApplicantsPost(null); }}
                    aria-label="Close commission post"
                    title="Close commission post"
                  >
                    <Icon name="x" style={{ width: 15, height: 15 }} />
                  </button>
                </div>
                {editingPost && postDraft ? (
                  <div className="commission-post-edit-form">
                    <label className="field-label" htmlFor="market-post-title">Title</label>
                    <input id="market-post-title" className="input-field" value={postDraft.title} onChange={(event) => setPostDraft((draft) => draft ? { ...draft, title: event.target.value } : draft)} />
                    <label className="field-label" htmlFor="market-post-description">Description</label>
                    <textarea id="market-post-description" className="textarea-field" rows={5} value={postDraft.description} onChange={(event) => setPostDraft((draft) => draft ? { ...draft, description: event.target.value } : draft)} />
                    <div className="commission-post-budget-fields">
                      <label className="market-filter-field"><span className="t-xs c-low">Minimum budget</span><input className="input-field" type="number" min="0.01" step="0.01" value={postDraft.budgetMin} onChange={(event) => setPostDraft((draft) => draft ? { ...draft, budgetMin: event.target.value } : draft)} /></label>
                      <label className="market-filter-field"><span className="t-xs c-low">Maximum budget</span><input className="input-field" type="number" min="0.01" step="0.01" value={postDraft.budgetMax} onChange={(event) => setPostDraft((draft) => draft ? { ...draft, budgetMax: event.target.value } : draft)} /></label>
                    </div>
                    <label className="field-label" htmlFor="market-post-currency">Currency</label>
                    <input id="market-post-currency" className="input-field" maxLength={3} value={postDraft.currency} onChange={(event) => setPostDraft((draft) => draft ? { ...draft, currency: event.target.value.toUpperCase() } : draft)} />
                    {postActionError && <div className="field-error" role="alert">{postActionError}</div>}
                    <div className="commission-post-actions">
                      <button type="button" className="btn btn-primary btn-sm" disabled={savingPost} onClick={() => void savePost()}>{savingPost ? 'Saving…' : 'Save Changes'}</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={savingPost} onClick={() => { setEditingPost(null); setPostDraft(null); setPostActionError(null); }}>Cancel Edit</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 id="commission-post-dialog-title" className="commission-post-title">{selectedPublicRequest.title}</h2>
                    <p className="commission-post-description">{selectedPublicRequest.description}</p>
                    {(selectedPublicRequest.budget_min !== null || selectedPublicRequest.budget_max !== null) && (
                      <div className="commission-post-budget">{formatPublicRequestBudget(selectedPublicRequest)}</div>
                    )}
                    <div className="commission-post-meta">
                      <span className="t-xs c-low">{formatPublicRequestDate(selectedPublicRequest.created_at)}</span>
                      {selectedPublicRequestApplication && <span className={`badge ${APPLICATION_STATUS_STYLE[selectedPublicRequestApplication.status]}`}>Your request: {selectedPublicRequestApplication.status}</span>}
                      {selectedPublicRequest.status !== 'OPEN' && <span className="badge badge-accent">{selectedPublicRequest.status}</span>}
                    </div>
                    {postActionError && <div className="field-error" role="alert">{postActionError}</div>}
                    {isPostOwner(selectedPublicRequest) && (
                      <section className="commission-post-requests" aria-labelledby="commission-post-requests-title">
                        <div className="row-between commission-post-requests-heading">
                          <h3 id="commission-post-requests-title" className="t-sm fw-700">
                            Requests from {selectedPublicRequest.owner_role === 'client' ? 'Artists' : 'Clients'}
                          </h3>
                          {postEngagement[selectedPublicRequest.id] && (
                            <span className="t-xs c-low">
                              {postEngagement[selectedPublicRequest.id].applicationCount} {postEngagement[selectedPublicRequest.id].applicationCount === 1 ? 'request' : 'requests'}
                            </span>
                          )}
                        </div>
                        {applicantsLoading ? (
                          <div className="card t-sm c-mid commission-applicants-state" role="status">Loading requests…</div>
                        ) : applicantsError ? (
                          <div className="field-error" role="alert">{applicantsError}</div>
                        ) : postApplicants.length === 0 ? (
                          <div className="card t-sm c-mid commission-applicants-state">0 requests</div>
                        ) : (
                          <div className="commission-applicants-list">
                            {postApplicants.map((application) => (
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
                                    <div className="t-xs c-low">@{application.applicant_username}</div>
                                    <div className="t-xs c-low">{application.applicant_role === 'client' ? 'Client' : 'Artist'}</div>
                                  </div>
                                  <span className={`badge ${APPLICATION_STATUS_STYLE[application.status]}`}>
                                    {application.status[0] + application.status.slice(1).toLowerCase()}
                                  </span>
                                </div>
                                <p className="commission-applicant-message">{application.message}</p>
                                <div className="t-xs c-low">Applied {formatApplicationCreatedAt(application.created_at)}</div>
                                {application.status === 'PENDING' && selectedPublicRequest.status === 'OPEN' && (
                                  <div className="commission-applicant-actions">
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => {
                                        if (application.applicant_role === 'artist') {
                                          navigate(`/market/artist/${application.applicant_id}`);
                                        } else {
                                          setViewingApplicant(application);
                                        }
                                      }}
                                    >
                                      View Profile
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      disabled={rejectingApplicationId !== null || selectingCommissionPostId !== null}
                                      onClick={() => void rejectPostApplication(application)}
                                    >
                                      {rejectingApplicationId === application.id ? 'Rejecting…' : 'Reject'}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm"
                                      disabled={selectingCommissionPostId !== null || rejectingApplicationId !== null}
                                      onClick={() => openApplicantSelection(application)}
                                    >
                                      Accept
                                    </button>
                                  </div>
                                )}
                              </article>
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                    {user && !isPostOwner(selectedPublicRequest) && selectedPublicRequest.owner_role !== user.role && (
                      selectedPublicRequestApplication?.status === 'PENDING' ? (
                        <div className="commission-application-controls">
                          <div className="t-sm fw-600">Application pending</div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={withdrawingApplicationId !== null}
                            onClick={() => void withdrawApplication(selectedPublicRequestApplication)}
                          >
                            {withdrawingApplicationId === selectedPublicRequestApplication.id ? 'Withdrawing…' : 'Withdraw Application'}
                          </button>
                        </div>
                      ) : selectedPublicRequestApplication ? (
                        <div className="commission-application-controls">
                          <span className={`badge ${APPLICATION_STATUS_STYLE[selectedPublicRequestApplication.status]}`}>
                          Your application: {selectedPublicRequestApplication.status[0] + selectedPublicRequestApplication.status.slice(1).toLowerCase()}
                          </span>
                        </div>
                      ) : selectedPublicRequest.status === 'OPEN' ? (
                        <div className="commission-application-form">
                          <label className="field-label" htmlFor="commission-application-message">
                            {user.role === 'artist' ? 'Application message' : 'Request message'}
                          </label>
                          <textarea
                            id="commission-application-message"
                            className="textarea-field"
                            rows={4}
                            required
                            value={applicationMessage}
                            onChange={(event) => setApplicationMessage(event.target.value)}
                            placeholder={user.role === 'artist'
                              ? 'Introduce your approach to this commission request.'
                              : 'Tell the Artist why you are interested in this commission.'}
                          />
                          <div className="commission-post-actions">
                            <button type="button" className="btn btn-primary btn-sm" disabled={submittingApplication || !applicationMessage.trim()} onClick={() => void submitApplication()}>
                              {submittingApplication ? 'Submitting…' : user.role === 'artist' ? 'Apply for Commission' : 'Request Commission'}
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={submittingApplication} onClick={() => { setApplicationMessage(''); setApplicationActionError(null); setSelectedPublicRequest(null); }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null
                    )}
                  </>
                )}
              </section>
            </div>
          )}
          {pendingDeletePost && (
            <div
              className="account-dialog-backdrop commission-post-delete-backdrop"
              role="presentation"
              onClick={() => { if (!deletingPostId) setPendingDeletePost(null); }}
            >
              <section
                className="account-dialog commission-post-delete-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="commission-post-delete-title"
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="commission-post-delete-title" className="t-sm fw-700">Delete this commission post?</h2>
                <p className="t-sm c-mid">
                  The post and its applications and comments will be permanently removed. This cannot be undone.
                </p>
                {postDeleteError && <div className="field-error" role="alert">{postDeleteError}</div>}
                <div className="commission-post-delete-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={deletingPostId !== null}
                    onClick={() => { setPendingDeletePost(null); setPostDeleteError(null); }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={deletingPostId !== null}
                    onClick={() => void deletePublicPost()}
                  >
                    {deletingPostId ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </section>
            </div>
          )}
          {viewingApplicant && (
            <div
              className="account-dialog-backdrop commission-selection-backdrop"
              role="presentation"
              onClick={() => setViewingApplicant(null)}
            >
              <section
                className="account-dialog commission-applicant-profile-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="commission-applicant-profile-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="row-between commission-applicants-heading">
                  <div>
                    <h2 id="commission-applicant-profile-title" className="t-sm fw-700">Applicant Profile</h2>
                    <div className="t-xs c-low">Public profile details</div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn commission-post-dialog-close"
                    aria-label="Close applicant profile"
                    onClick={() => setViewingApplicant(null)}
                  >
                    <Icon name="x" style={{ width: 15, height: 15 }} />
                  </button>
                </div>
                <div className="commission-post-author">
                  <div
                    className="avatar avatar-md commission-post-avatar"
                    style={viewingApplicant.applicant_avatar_data_url
                      ? { backgroundImage: `url(${viewingApplicant.applicant_avatar_data_url})` }
                      : undefined}
                  >
                    {!viewingApplicant.applicant_avatar_data_url
                      && viewingApplicant.applicant_name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="commission-post-author-copy">
                    <div className="t-sm fw-700">{viewingApplicant.applicant_name}</div>
                    <div className="t-xs c-low">@{viewingApplicant.applicant_username}</div>
                    <div className="t-xs c-low">{viewingApplicant.applicant_role === 'client' ? 'Client' : 'Artist'}</div>
                  </div>
                </div>
              </section>
            </div>
          )}
          {selectingApplicant && applicantsPost && isPostOwner(applicantsPost) && (
            <div
              className="account-dialog-backdrop commission-selection-backdrop"
              role="presentation"
              onClick={() => {
                if (!selectingCommissionPostId) {
                  setSelectingApplicant(null);
                  setSelectionError(null);
                }
              }}
            >
              <section
                className="account-dialog commission-selection-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="commission-selection-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="row-between commission-applicants-heading">
                  <div>
                    <h2 id="commission-selection-title" className="t-sm fw-700" style={{ margin: '0 0 4px' }}>
                      Select {selectingApplicant.applicant_role === 'artist' ? 'Artist' : 'Client'}
                    </h2>
                    <div className="t-xs c-low">{applicantsPost.title}</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={selectingCommissionPostId !== null}
                    onClick={() => { setSelectingApplicant(null); setSelectionError(null); }}
                  >
                    Cancel
                  </button>
                </div>
                <div className="commission-selection-artist">
                  <div
                    className="avatar avatar-md commission-post-avatar"
                    style={selectingApplicant.applicant_avatar_data_url ? { backgroundImage: `url(${selectingApplicant.applicant_avatar_data_url})` } : undefined}
                  >
                    {!selectingApplicant.applicant_avatar_data_url && selectingApplicant.applicant_name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="t-sm fw-700">{selectingApplicant.applicant_name}</div>
                    <div className="t-xs c-low">@{selectingApplicant.applicant_username} · {selectingApplicant.applicant_role === 'artist' ? 'Artist' : 'Client'}</div>
                  </div>
                </div>
                <div className="card commission-selection-budget">
                  <div className="t-xs c-low">Post budget range</div>
                  <div className="t-sm fw-700">
                    {applicantsPost.budget_min === null && applicantsPost.budget_max === null
                      ? 'Not specified'
                      : formatPublicRequestBudget(applicantsPost)}
                  </div>
                  <div className="t-xs c-low">Enter the final agreed amount; the post budget is a limit, not an automatic price.</div>
                </div>
                <div className="commission-selection-fields">
                  <label className="field-label" htmlFor="commission-selection-amount">Final agreed amount</label>
                  <input
                    id="commission-selection-amount"
                    className="input-field"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={selectionAmount}
                    onChange={(event) => setSelectionAmount(event.target.value)}
                    disabled={selectingCommissionPostId !== null}
                    required
                  />
                  <label className="field-label" htmlFor="commission-selection-currency">Currency</label>
                  <input
                    id="commission-selection-currency"
                    className="input-field"
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    maxLength={3}
                    value={applicantsPost.currency ?? selectionCurrency}
                    onChange={(event) => setSelectionCurrency(event.target.value.toUpperCase())}
                    disabled={Boolean(applicantsPost.currency) || selectingCommissionPostId !== null}
                    required
                  />
                  {selectionError && <div className="field-error" role="alert">{selectionError}</div>}
                  <div className="t-sm c-mid commission-selection-warning">
                    Selecting this applicant will create a real commission request.
                  </div>
                  <div className="commission-selection-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={selectingCommissionPostId !== null || selectingApplicant.status !== 'PENDING' || applicantsPost.status !== 'OPEN'}
                      onClick={() => void submitArtistSelection()}
                    >
                      {selectingCommissionPostId ? 'Creating request…' : 'Confirm Selection'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={selectingCommissionPostId !== null}
                      onClick={() => { setSelectingApplicant(null); setSelectionError(null); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </section>
      ) : (
        <>
          {artistsLoading && <div className="card t-sm c-mid" role="status">Loading artists…</div>}
          {!artistsLoading && artistsError && <div className="card t-sm protection-artwork-error" role="alert">Could not load real artists: {artistsError}</div>}
          {!artistsLoading && !artistsError && marketplaceArtists.length === 0 && <div className="card t-sm c-mid" role="status">No registered artist accounts found.</div>}
          <div className="row-between" style={{ margin: '6px 0 12px' }}>
            <span className="section-title">Featured Artists</span>
          </div>
          <div className="chip-row" style={{ gap: 14, marginBottom: 22 }}>
            {marketplaceArtists.map((artist) => (
              <button
                key={artist.id}
                type="button"
                className="chip-btn"
                style={{ textAlign: 'center', width: 74, flexShrink: 0 }}
                onClick={() => navigate(`/market/artist/${artist.id}`)}
              >
                  <div className="avatar avatar-lg" style={{ margin: '0 auto 8px', ...artist.avatarStyle }}>
                  {artist.initials}
                </div>
                <div className="t-xs fw-600" style={{ whiteSpace: 'nowrap' }}>
                  {artist.name.split(' ')[0]} {artist.name.split(' ')[1]?.[0]}.
                </div>
                <div className="t-xs c-low">{artist.tags[0]}</div>
              </button>
            ))}
          </div>

          <div className="row-between" style={{ marginBottom: 12 }}>
            <span className="section-title">{isRealArtistSource ? 'Artists' : 'Open Commission Slots'}</span>
          </div>

          {filteredArtists.length === 0 && (
            <div className="card t-sm c-mid" style={{ textAlign: 'center', marginBottom: 14 }}>
              No artists match the current search and filters.
            </div>
          )}

          <div className="artist-grid">
            {filteredArtists.map((artist) => (
              <button
                key={artist.id}
                type="button"
                className="tap-card card"
                onClick={() => navigate(`/market/artist/${artist.id}`)}
              >
                {artist.source === 'supabase' ? (
                  <>
                    <div className="row gap-10" style={{ marginBottom: 12 }}>
                      <div
                        className="avatar avatar-md"
                        style={{
                          flexShrink: 0,
                          ...(artist.avatarDataUrl
                            ? { backgroundImage: `url(${artist.avatarDataUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                            : {}),
                        }}
                      >
                        {!artist.avatarDataUrl && artist.initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row gap-8">
                          <span className="t-sm fw-700">{artist.name}</span>
                          {artist.verified && <Icon name="check-circle" style={{ width: 14, height: 14, stroke: 'var(--ag-sky)', flexShrink: 0 }} />}
                        </div>
                        {artist.handle && artist.handle !== '@' && <div className="t-xs c-low" style={{ marginTop: 3 }}>{artist.handle}</div>}
                        {!artist.unavailableFields.has('rating') && artist.rating !== undefined && artist.reviewCount !== undefined ? (
                          <div className="row gap-8" style={{ marginTop: 5, flexWrap: 'wrap' }}>
                            <Icon name="star" style={{ width: 12, height: 12, stroke: 'none', fill: 'var(--ag-amber)' }} />
                            <span className="t-xs fw-600">{artist.rating.toFixed(1)}</span>
                            <span className="t-xs c-low">· {artist.reviewCount} reviews</span>
                          </div>
                        ) : realReviewSummariesAvailable ? (
                          <div className="t-xs c-low" style={{ marginTop: 5 }}>No reviews yet.</div>
                        ) : null}
                        <div className="t-xs c-low" style={{ marginTop: 5 }}>
                          {artist.tags.join(' · ')}
                        </div>
                      </div>
                    </div>
                    {artist.activeServiceCount !== undefined && artist.activeServiceCount > 0 && (
                      <div className="t-xs c-low" style={{ lineHeight: 1.4 }}>
                        {artist.hasMultipleServiceCurrencies
                          ? `Multiple currencies · ${artist.activeServiceCount} service${artist.activeServiceCount === 1 ? '' : 's'}`
                          : artist.minimumServicePrice !== undefined && artist.minimumServiceCurrency
                            ? `From ${artist.minimumServiceCurrency} ${artist.minimumServicePrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} · ${artist.activeServiceCount} service${artist.activeServiceCount === 1 ? '' : 's'}`
                            : `${artist.activeServiceCount} service${artist.activeServiceCount === 1 ? '' : 's'}`}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="row gap-10" style={{ marginBottom: 12 }}>
                      <ArtTile variant={artist.portfolio[0]} size={56} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row-between">
                          <span className="t-sm fw-700">{artist.name}</span>
                          {!artist.unavailableFields.has('slots') && <span className={`badge ${artist.slots >= 2 ? 'badge-success' : 'badge-warning'}`}>
                            {artist.slots} slot{artist.slots === 1 ? '' : 's'}
                          </span>}
                        </div>
                        <div className="t-xs c-low" style={{ margin: '3px 0 6px' }}>
                          {artist.tags.join(' · ')}
                        </div>
                        {!artist.unavailableFields.has('rating') && artist.rating !== undefined && artist.reviewCount !== undefined && <div className="row gap-8">
                          <Icon name="star" style={{ width: 12, height: 12, stroke: 'none', fill: 'var(--ag-amber)' }} />
                          <span className="t-xs fw-600">{artist.rating.toFixed(1)}</span>
                          <span className="t-xs c-low">({artist.reviewCount})</span>
                        </div>}
                      </div>
                    </div>
                    <div className="row-between">
                      {!artist.unavailableFields.has('startingPrice') && <><span className="t-xs c-low">Starting at</span><span className="mono fw-700" style={{ color: 'var(--ag-accent-soft)' }}>₱{artist.startingPrice}</span></>}
                    </div>
                  </>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {toast}
    </ScreenShell>
  );
}
