import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ARTWORK_FEED } from '../data/mockData';
import type { ArtworkPost } from '../data/mockData';

/**
 * ---------------------------------------------------------------------------
 * MOCK ARTWORK FEED STATE ONLY
 * ---------------------------------------------------------------------------
 * There is no backend for the Discover feed yet, so likes/comments live in
 * memory for the session (seeded from ARTWORK_FEED in mockData.ts). Marketplace
 * (the grid) and ArtworkDetailPage (the detail view) both read/write through
 * this context so a like or comment made in one place is reflected in the
 * other without a page reload, and survives navigating back and forth since
 * Ionic keeps the Marketplace page mounted in its view stack.
 * ---------------------------------------------------------------------------
 */

interface ArtworkFeedContextValue {
  posts: ArtworkPost[];
  getPost: (id: string) => ArtworkPost | undefined;
  toggleLike: (id: string) => void;
  addComment: (id: string, authorName: string, authorInitials: string, text: string) => void;
}

const ArtworkFeedContext = createContext<ArtworkFeedContextValue | undefined>(undefined);

export function ArtworkFeedProvider({ children }: { children: ReactNode }) {
  const [posts, setPosts] = useState<ArtworkPost[]>(() => ARTWORK_FEED.map((post) => ({ ...post, comments: [...post.comments] })));

  const toggleLike = useCallback((id: string) => {
    setPosts((prev) =>
      prev.map((post) => (post.id === id ? { ...post, liked: !post.liked, likes: post.liked ? post.likes - 1 : post.likes + 1 } : post))
    );
  }, []);

  const addComment = useCallback((id: string, authorName: string, authorInitials: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPosts((prev) =>
      prev.map((post) =>
        post.id === id
          ? {
              ...post,
              comments: [
                ...post.comments,
                { id: `local-${Date.now()}`, author: authorName, authorInitials, text: trimmed, time: 'Just now' },
              ],
            }
          : post
      )
    );
  }, []);

  const getPost = useCallback((id: string) => posts.find((post) => post.id === id), [posts]);

  const value = useMemo<ArtworkFeedContextValue>(() => ({ posts, getPost, toggleLike, addComment }), [posts, getPost, toggleLike, addComment]);

  return <ArtworkFeedContext.Provider value={value}>{children}</ArtworkFeedContext.Provider>;
}

export function useArtworkFeed(): ArtworkFeedContextValue {
  const ctx = useContext(ArtworkFeedContext);
  if (!ctx) throw new Error('useArtworkFeed must be used within an ArtworkFeedProvider');
  return ctx;
}
