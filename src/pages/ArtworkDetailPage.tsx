import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { OptionsMenu } from '../components/ui/OptionsMenu';
import { ArtTile } from '../components/ui/ArtTile';
import { Icon } from '../assets/icons';
import { useArtworkFeed } from '../context/ArtworkFeedContext';
import { useAuth } from '../context/AuthContext';
import { useMockToast } from '../components/ui/MockToast';
import './ArtworkDetailPage.css';

export function ArtworkDetailPage() {
  const { artworkId } = useParams<{ artworkId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getPost, toggleLike, addComment } = useArtworkFeed();
  const { toast, showToast } = useMockToast();
  const [draft, setDraft] = useState('');
  const commentInputRef = useRef<HTMLInputElement>(null);

  const post = artworkId ? getPost(artworkId) : undefined;

  if (!post) {
    return (
      <ScreenShell
        header={
          <div className="px-hd row-between">
            <IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" />
          </div>
        }
      >
        <div className="card t-sm c-mid" style={{ textAlign: 'center' }}>
          Artwork not found.
        </div>
      </ScreenShell>
    );
  }

  const handleSubmitComment = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const authorName = user?.name || 'You';
    const authorInitials = authorName.slice(0, 1).toUpperCase();
    addComment(post.id, authorName, authorInitials, text);
    setDraft('');
  };

  const focusComments = () => {
    commentInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    commentInputRef.current?.focus();
  };

  return (
    <ScreenShell
      padContent={false}
      contentClassName="artwork-detail-shell"
      footer={
        <form onSubmit={handleSubmitComment} className="comment-composer">
          <div className="input-field" style={{ flex: 1, padding: '11px 14px' }}>
            <input
              ref={commentInputRef}
              type="text"
              placeholder="Add a comment…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Add a comment"
            />
          </div>
          <button type="submit" aria-label="Post comment" className="comment-send-btn" disabled={!draft.trim()}>
            <Icon name="send" style={{ width: 16, height: 16, stroke: '#fff' }} />
          </button>
        </form>
      }
    >
      <div className="artwork-hero-wrap">
        <div className="artwork-hero-backbtn-row">
          <IconButton
            icon="chevron-l"
            onClick={() => navigate(-1)}
            ariaLabel="Back to Marketplace"
            style={{ background: 'rgba(0,0,0,0.35)', borderColor: 'rgba(255,255,255,0.2)' }}
          />
          <OptionsMenu
            ariaLabel="More options"
            triggerStyle={{ background: 'rgba(0,0,0,0.35)', borderColor: 'rgba(255,255,255,0.2)' }}
            items={[
              { label: 'Share artwork', onClick: () => showToast('Link copied (mock)') },
              { label: 'Report artwork', onClick: () => showToast('Artwork reported (mock)') },
            ]}
          />
        </div>
        <ArtTile
          variant={post.image}
          className="artwork-hero-tile"
          style={{ width: '100%', aspectRatio: Math.max(post.aspectRatio, 0.7), ['--hero-ar' as string]: Math.max(post.aspectRatio, 0.7) }}
        />
      </div>

      <div className="app-content-inner artwork-detail-content">
        <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
          <button
            type="button"
            className="row gap-10 tap-card"
            style={{ width: 'auto', background: 'none', border: 'none', padding: 0 }}
            onClick={() => post.artistId && navigate(`/market/artist/${post.artistId}`)}
            disabled={!post.artistId}
          >
            <div className="avatar avatar-md" style={post.avatarStyle}>
              {post.artistInitials}
            </div>
            <div style={{ textAlign: 'left' }}>
              <div className="t-sm fw-700">{post.artistName}</div>
              <div className="t-xs c-low">
                {post.artistHandle} · {post.postedLabel}
              </div>
            </div>
          </button>
          {post.artistId && (
            <span className="badge badge-accent" style={{ flexShrink: 0 }}>
              Books commissions
            </span>
          )}
        </div>

        <p className="t-sm c-mid" style={{ lineHeight: 1.6, marginBottom: 16 }}>
          {post.caption}
        </p>

        {post.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
            {post.tags.map((tag) => (
              <span className="chip" key={tag} style={{ fontSize: 11 }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="row gap-14" style={{ marginBottom: 20 }}>
          <button
            type="button"
            className="artwork-detail-like-btn"
            aria-pressed={post.liked}
            aria-label={post.liked ? 'Unlike artwork' : 'Like artwork'}
            onClick={() => toggleLike(post.id)}
          >
            <Icon
              name="heart"
              style={{
                width: 19,
                height: 19,
                stroke: post.liked ? 'var(--ag-coral)' : 'var(--ag-text-mid)',
                fill: post.liked ? 'var(--ag-coral)' : 'none',
              }}
            />
            <span className={post.liked ? 'c-danger fw-700' : 'c-mid fw-700'}>{post.likes}</span>
          </button>
          <button type="button" className="artwork-detail-comment-btn" onClick={focusComments} aria-label="Jump to comments">
            <Icon name="chat" style={{ width: 18, height: 18, stroke: 'var(--ag-text-mid)' }} />
            <span className="c-mid fw-700">{post.comments.length}</span>
          </button>
        </div>

        <hr className="soft" />

        <div className="row-between" style={{ margin: '14px 0 12px' }}>
          <span className="section-title">Comments ({post.comments.length})</span>
        </div>

        {post.comments.length === 0 && (
          <div className="card t-sm c-mid" style={{ textAlign: 'center', marginBottom: 14 }}>
            No comments yet — be the first to say something.
          </div>
        )}

        {post.comments.map((comment) => (
          <div className="comment-item" key={comment.id}>
            <div className="avatar avatar-sm" style={{ background: 'var(--ag-grad-accent)' }}>
              {comment.authorInitials}
            </div>
            <div className="comment-bubble">
              <div className="card" style={{ padding: '10px 14px' }}>
                <div className="t-xs fw-700" style={{ marginBottom: 3 }}>
                  {comment.author}
                </div>
                <span className="t-sm c-mid">{comment.text}</span>
              </div>
              <span className="t-xs c-low" style={{ display: 'block', margin: '4px 0 0 6px' }}>
                {comment.time}
              </span>
            </div>
          </div>
        ))}
      </div>
      {toast}
    </ScreenShell>
  );
}
