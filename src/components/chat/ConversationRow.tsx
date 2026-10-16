import type { Conversation } from '../../data/mockData';
import { previewFor } from '../../utils/chat';

interface ConversationRowProps {
  conversation: Conversation;
  /** Highlights the row — used by the desktop sidebar to mark the open conversation. */
  active?: boolean;
  onOpen: (id: string) => void;
}

/**
 * Single inbox row: avatar, presence dot, name, last-message preview, time,
 * unread badge. Extracted so ChatInboxPage's list (mobile, and the desktop
 * fallback) and ChatSidebar's list (desktop persistent pane) render an
 * identical row rather than two copies that could drift apart.
 */
export function ConversationRow({ conversation, active, onOpen }: ConversationRowProps) {
  return (
    <button
      type="button"
      className={`tap-card chat-list-item${active ? ' chat-list-item-active' : ''}`}
      onClick={() => onOpen(conversation.id)}
    >
      <div className="chat-list-avatar-wrap">
        <div className="avatar avatar-md" style={conversation.avatarStyle}>
          {conversation.initials}
        </div>
        <span className={`presence-dot presence-${conversation.presence}`} />
      </div>

      <div className="chat-list-body">
        <div className="row-between">
          <span className="t-md fw-700 c-hi">{conversation.name}</span>
          <span className="t-xs c-low" style={{ flexShrink: 0, marginLeft: 8 }}>
            {conversation.previewTime}
          </span>
        </div>
        <div className="row-between" style={{ marginTop: 3 }}>
          <span className={`t-sm chat-list-preview${conversation.unreadCount > 0 ? ' fw-600 c-hi' : ' c-mid'}`}>
            {previewFor(conversation)}
          </span>
          {conversation.unreadCount > 0 && <span className="unread-badge">{conversation.unreadCount}</span>}
        </div>
      </div>
    </button>
  );
}
