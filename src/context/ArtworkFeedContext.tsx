import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ARTWORK_FEED } from '../data/mockData';
import type { ArtworkPost } from '../data/mockData';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  createDiscoverArtworkComment,
  listDiscoverArtworkComments,
  listDiscoverArtworkEngagement,
  listDiscoverArtworks,
  setDiscoverArtworkLike,
} from '../lib/supabaseArtworks';
import type { ArtworkComment } from '../data/mockData';

/**
 * ---------------------------------------------------------------------------
 * MOCK ARTWORK FEED STATE ONLY
 * ---------------------------------------------------------------------------
 * Mock mode uses ARTWORK_FEED with session-only likes/comments. Supabase mode
 * loads only published protected artwork and does not expose mock engagement.
 * ---------------------------------------------------------------------------
 */

interface ArtworkFeedContextValue {
  posts: ArtworkPost[];
  getPost: (id: string) => ArtworkPost | undefined;
  toggleLike: (id: string) => Promise<void>;
  addComment: (id: string, authorName: string, authorInitials: string, text: string) => Promise<void>;
  loadComments: (id: string) => Promise<void>;
  likePendingIds: string[];
  likeErrors: Record<string, string>;
  commentLoading: boolean;
  commentError?: string;
  commentsLoadedFor: string | null;
  commentPending: boolean;
  isSupabaseSource: boolean;
  loading: boolean;
  error?: string;
  refresh: () => void;
}

const ArtworkFeedContext = createContext<ArtworkFeedContextValue | undefined>(undefined);

export function ArtworkFeedProvider({ children }: { children: ReactNode }) {
  const { user, initializing } = useAuth();
  const isSupabaseSource = isSupabaseConfigured;
  const [posts, setPosts] = useState<ArtworkPost[]>(() => isSupabaseConfigured
    ? []
    : ARTWORK_FEED.map((post) => ({ ...post, comments: [...post.comments] })));
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [likePendingIds, setLikePendingIds] = useState<string[]>([]);
  const [likeErrors, setLikeErrors] = useState<Record<string, string>>({});
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentError, setCommentError] = useState<string>();
  const [commentsLoadedFor, setCommentsLoadedFor] = useState<string | null>(null);
  const [commentPending, setCommentPending] = useState(false);
  const pendingLikes = useRef(new Set<string>());
  const pendingComments = useRef(new Set<string>());
  const commentsRequest = useRef(0);

  useEffect(() => {
    if (!isSupabaseSource) {
      setPosts(ARTWORK_FEED.map((post) => ({ ...post, comments: [...post.comments] })));
      setLoading(false);
      setError(undefined);
      return;
    }
    if (initializing) return;
    if (!user) {
      setPosts([]);
      setLoading(false);
      setError(undefined);
      return;
    }

    let active = true;
    setLoading(true);
    setError(undefined);
    setPosts([]);
    setLikeErrors({});
    setLikePendingIds([]);
    void Promise.all([listDiscoverArtworks(), listDiscoverArtworkEngagement()])
      .then(([artworks, engagements]) => {
        if (!active) return;
        const engagementByArtwork = new Map(engagements.map((item) => [item.artwork_id, item]));
        setPosts(artworks.map(({ record, previewUrl }) => {
          const engagement = engagementByArtwork.get(record.id);
          const artistInitials = record.artist_name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? '')
            .join('');
          return {
            id: record.id,
            title: record.title,
            createdAt: record.created_at,
            previewUrl,
            category: record.category,
            isSupabase: true,
            protectionSettings: {
              dynamic_cloaking: record.dynamic_cloaking,
              canvas_tiling: record.canvas_tiling,
              right_click_shield: record.right_click_shield,
            },
            artistId: record.artist_id,
            artistName: record.artist_name,
            artistHandle: `@${record.artist_username}`,
            artistInitials,
            avatarStyle: record.artist_avatar_data_url
              ? { backgroundImage: `url(${record.artist_avatar_data_url})` }
              : {},
            image: 1,
            aspectRatio: 1,
            caption: record.description ?? record.title,
            tags: [record.category],
            likes: engagement?.like_count ?? 0,
            liked: engagement?.liked_by_me ?? false,
            postedLabel: new Date(record.created_at).toLocaleDateString(),
            comments: [],
            commentCount: engagement?.comment_count ?? 0,
          };
        }));
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setPosts([]);
        setError(loadError instanceof Error ? loadError.message : 'Could not load published artwork.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [initializing, isSupabaseSource, refreshKey, user]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  const toggleLike = useCallback(async (id: string) => {
    if (pendingLikes.current.has(id)) return;
    const post = posts.find((item) => item.id === id);
    if (!post) return;
    if (isSupabaseSource && !user) {
      setLikeErrors((current) => ({ ...current, [id]: 'Sign in to like published artwork.' }));
      return;
    }

    pendingLikes.current.add(id);
    setLikePendingIds((current) => [...current, id]);
    setLikeErrors((current) => ({ ...current, [id]: '' }));
    try {
      if (isSupabaseSource) {
        const result = await setDiscoverArtworkLike(id, !post.liked);
        setPosts((current) => current.map((item) => item.id === id
          ? { ...item, likes: result.like_count, liked: result.liked_by_me }
          : item));
      } else {
        setPosts((current) => current.map((item) => (item.id === id
          ? { ...item, liked: !item.liked, likes: item.liked ? item.likes - 1 : item.likes + 1 }
          : item)));
      }
    } catch (error) {
      setLikeErrors((current) => ({
        ...current,
        [id]: error instanceof Error ? error.message : 'Could not update your like. Please try again.',
      }));
    } finally {
      pendingLikes.current.delete(id);
      setLikePendingIds((current) => current.filter((pendingId) => pendingId !== id));
    }
  }, [isSupabaseSource, posts, user]);

  const loadComments = useCallback(async (id: string) => {
    if (!isSupabaseSource) return;
    const requestId = ++commentsRequest.current;
    setCommentLoading(true);
    setCommentError(undefined);
    setCommentsLoadedFor(null);
    try {
      const comments = await listDiscoverArtworkComments(id);
      if (requestId !== commentsRequest.current) return;
      const mapped: ArtworkComment[] = comments.map((comment) => ({
        id: comment.id,
        author: comment.author_name,
        authorInitials: comment.author_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''),
        authorId: comment.author_id,
        authorUsername: comment.author_username,
        authorAvatarDataUrl: comment.author_avatar_data_url,
        text: comment.body,
        time: new Date(comment.created_at).toLocaleString(),
        createdAt: comment.created_at,
      }));
      setPosts((current) => current.map((post) => post.id === id
        ? { ...post, comments: mapped, commentCount: mapped.length }
        : post));
      setCommentsLoadedFor(id);
    } catch (error) {
      if (requestId === commentsRequest.current) {
        setCommentError(error instanceof Error ? error.message : 'Could not load comments.');
      }
    } finally {
      if (requestId === commentsRequest.current) setCommentLoading(false);
    }
  }, [isSupabaseSource]);

  const addComment = useCallback(async (id: string, authorName: string, authorInitials: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Comment cannot be empty.');
    if (Array.from(trimmed).length > 2000) throw new Error('Comments must be 2,000 characters or fewer.');
    if (pendingComments.current.has(id)) throw new Error('Your comment is already being submitted.');
    if (isSupabaseSource && !user) throw new Error('Sign in to comment on published artwork.');

    pendingComments.current.add(id);
    setCommentPending(true);
    setCommentError(undefined);
    try {
      let comment: ArtworkComment;
      if (isSupabaseSource) {
        const saved = await createDiscoverArtworkComment(id, trimmed);
        comment = {
          id: saved.id,
          author: saved.author_name,
          authorInitials: saved.author_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''),
          authorId: saved.author_id,
          authorUsername: saved.author_username,
          authorAvatarDataUrl: saved.author_avatar_data_url,
          text: saved.body,
          time: new Date(saved.created_at).toLocaleString(),
          createdAt: saved.created_at,
        };
      } else {
        comment = {
          id: `local-${Date.now()}`,
          author: authorName,
          authorInitials,
          text: trimmed,
          time: 'Just now',
        };
      }
      setPosts((current) => current.map((post) => post.id === id
        ? { ...post, comments: [...post.comments, comment], commentCount: (post.commentCount ?? post.comments.length) + 1 }
        : post));
    } finally {
      pendingComments.current.delete(id);
      setCommentPending(false);
    }
  }, [isSupabaseSource, user]);

  const getPost = useCallback((id: string) => posts.find((post) => post.id === id), [posts]);

  const value = useMemo<ArtworkFeedContextValue>(
    () => ({
      posts,
      getPost,
      toggleLike,
      addComment,
      loadComments,
      likePendingIds,
      likeErrors,
      commentLoading,
      commentError,
      commentsLoadedFor,
      commentPending,
      isSupabaseSource,
      loading,
      error,
      refresh,
    }),
    [
      posts, getPost, toggleLike, addComment, loadComments, likePendingIds, likeErrors,
      commentLoading, commentError, commentsLoadedFor, commentPending,
      isSupabaseSource, loading, error, refresh,
    ],
  );

  return <ArtworkFeedContext.Provider value={value}>{children}</ArtworkFeedContext.Provider>;
}

export function useArtworkFeed(): ArtworkFeedContextValue {
  const ctx = useContext(ArtworkFeedContext);
  if (!ctx) throw new Error('useArtworkFeed must be used within an ArtworkFeedProvider');
  return ctx;
}
