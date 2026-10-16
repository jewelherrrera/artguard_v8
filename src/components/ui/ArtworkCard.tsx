import type { KeyboardEvent } from 'react';
import { ArtTile } from './ArtTile';
import { ProtectedArtworkDisplay } from './ProtectedArtworkDisplay';
import { Icon } from '../../assets/icons';
import type { ArtworkPost } from '../../data/mockData';

interface ArtworkCardProps {
  post: ArtworkPost;
  onOpen: (id: string) => void;
  onToggleLike: (id: string) => void | Promise<void>;
  likePending?: boolean;
  likeError?: string;
}

/**
 * A single tile in the Discover masonry grid. The whole tile opens the
 * artwork detail view; the heart is a nested interactive control so it needs
 * its own click handler with stopPropagation (a real <button> can't nest
 * inside another <button>, so the tile itself is a keyboard-accessible div).
 */
export function ArtworkCard({ post, onOpen, onToggleLike, likePending = false, likeError }: ArtworkCardProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(post.id);
    }
  };

  return (
    <div
      className="artwork-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(post.id)}
      onKeyDown={handleKeyDown}
      aria-label={`Open artwork by ${post.artistName}`}
    >
      <ArtTile
        variant={post.image}
        style={{
          width: '100%',
          aspectRatio: post.isSupabase && post.previewUrl ? undefined : post.aspectRatio,
        }}
      >
        {post.previewUrl && (
          <ProtectedArtworkDisplay
            src={post.previewUrl}
            alt={`${post.title ?? 'Protected artwork'} by ${post.artistName}`}
            settings={post.protectionSettings}
            fitMode={post.isSupabase ? 'contain' : 'cover'}
          />
        )}
        <div className="artwork-thumb-overlay">
          <div className="artwork-thumb-artist">
            <div className="avatar avatar-xs" style={post.avatarStyle}>
              {post.artistInitials}
            </div>
            <span className="t-xs fw-600" style={{ color: '#fff' }}>
              {post.artistName}
            </span>
          </div>
          <div className="artwork-thumb-actions">
            <button
              type="button"
              className="artwork-like-btn"
              aria-pressed={post.liked}
              aria-label={post.liked ? 'Unlike artwork' : 'Like artwork'}
              disabled={likePending}
              onClick={(e) => {
                e.stopPropagation();
                void onToggleLike(post.id);
              }}
            >
              <Icon
                name="heart"
                style={{
                  width: 13,
                  height: 13,
                  stroke: post.liked ? 'var(--ag-coral)' : '#fff',
                  fill: post.liked ? 'var(--ag-coral)' : 'none',
                }}
              />
              {post.likes}
            </button>
            <span className="artwork-comment-pill" aria-label={`${post.commentCount ?? post.comments.length} comments`}>
              <Icon name="chat" style={{ width: 13, height: 13, stroke: '#fff' }} />
              {post.commentCount ?? post.comments.length}
            </span>
          </div>
        </div>
      </ArtTile>
      {post.isSupabase && (
        <div className="artwork-real-caption">
          <strong>{post.title}</strong>
          <span>{post.category}</span>
        </div>
      )}
      {likeError && <div className="artwork-engagement-error" role="alert">{likeError}</div>}
    </div>
  );
}
