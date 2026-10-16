import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useIonViewDidEnter, useIonViewWillLeave } from '@ionic/react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { BottomNav } from '../components/ui/BottomNav';
import { IconButton } from '../components/ui/IconButton';
import { ArtTile } from '../components/ui/ArtTile';
import { Icon } from '../assets/icons';
import { useChat } from '../context/ChatContext';
import { useMockToast } from '../components/ui/MockToast';
import { ChatSidebar } from '../components/chat/ChatSidebar';
import type { ChatMessage, MessageStatus } from '../data/mockData';
import './ChatPage.css';

const REACTION_EMOJIS = ['❤️', '👍', '😂', '😮', '😢'];
const COMPOSER_EMOJIS = ['😀', '😂', '❤️', '👍', '🔥', '🎨', '😢', '🙏', '✅', '👏', '🎉', '😮'];

const MOCK_IMAGE_NAMES = ['Update_v3.png', 'Revised_sketch.png', 'Final_pass.png', 'Color_test.png'];
const MOCK_FILES: { name: string; type: string; size: string }[] = [
  { name: 'reference_notes.pdf', type: 'PDF', size: '1.4 MB' },
  { name: 'palette_guide.pdf', type: 'PDF', size: '820 KB' },
  { name: 'commission_brief.docx', type: 'DOCX', size: '96 KB' },
];

function randomFrom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function presenceLabel(presence: string, lastSeenLabel?: string): string {
  if (presence === 'online') return 'Online';
  if (presence === 'recent') return lastSeenLabel ?? 'Recently active';
  return lastSeenLabel ?? 'Offline';
}

function StatusTicks({ status }: { status?: MessageStatus }) {
  if (!status) return null;
  if (status === 'sent') return <span className="t-xs c-low">✓</span>;
  if (status === 'delivered') return <span className="t-xs c-low">✓✓</span>;
  return <span className="t-xs c-accent">✓✓</span>;
}

/**
 * Single conversation screen. Reached via /chat/:conversationId (from
 * ChatInboxPage). Back always returns to the inbox list, matching the
 * required Inbox -> Conversation -> back-to-Inbox flow.
 *
 * Reaction interaction model: tapping a text/file bubble toggles its
 * reaction picker directly (there's no competing primary action on those).
 * Image bubbles reserve a tap for opening the full-size preview, so
 * reactions there are triggered by a long-press (~480ms hold) or a
 * right-click — both routed through the same startPress/releaseTap timer
 * below.
 */
export function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { conversationId } = useParams<{ conversationId: string }>();
  const {
    getConversation,
    loadConversationById,
    typingConversationId,
    sendTyping,
    sendTextMessage,
    sendImageMessage,
    sendFileMessage,
    toggleReaction,
    markAsRead,
    hideConversation,
  } = useChat();
  const { toast, showToast } = useMockToast();

  const contextConversation = conversationId ? getConversation(conversationId) : undefined;
  const [resolvedConversation, setResolvedConversation] = useState<NonNullable<typeof contextConversation> | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);

  const conversation = contextConversation ?? resolvedConversation;

  const [draft, setDraft] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeReactionId, setActiveReactionId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ variant: 1 | 2 | 3 | 4 | 5 | 6; name?: string } | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingConversation, setDeletingConversation] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressFired = useRef(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendInFlightRef = useRef(false);
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatViewActiveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    if (!conversationId || contextConversation) {
      setLoadingConversation(false);
      if (contextConversation) setResolvedConversation(contextConversation);
      return;
    }

    setLoadingConversation(true);
    void loadConversationById(conversationId).then((found) => {
      if (cancelled) return;
      setResolvedConversation(found);
      setLoadingConversation(false);
    });

    return () => {
      cancelled = true;
    };
  }, [conversationId, contextConversation, loadConversationById]);

  // IMPORTANT: Ionic's router may keep inactive pages mounted. Do not mark a
  // conversation read merely because its component exists in the outlet. A
  // message becomes read only while this exact conversation route is active,
  // the document is visible, and the window is focused.
  const markActiveConversationRead = useCallback(() => {
    if (!conversation || !conversationId || !chatViewActiveRef.current) return;
    const isExactThreadRoute = location.pathname === `/chat/${conversationId}`;
    const isVisible = document.visibilityState === 'visible' && document.hasFocus();
    if (isExactThreadRoute && isVisible && conversation.unreadCount > 0) {
      void markAsRead(conversation.id);
    }
  }, [conversation, conversationId, location.pathname, markAsRead]);

  useEffect(() => {
    const scheduleReadCheck = () => {
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
      readTimerRef.current = window.setTimeout(markActiveConversationRead, 120);
    };
    scheduleReadCheck();
    const onVisibilityOrFocus = () => scheduleReadCheck();
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);
    return () => {
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
    };
  }, [markActiveConversationRead]);

  useIonViewDidEnter(() => {
    chatViewActiveRef.current = true;
    if (readTimerRef.current) clearTimeout(readTimerRef.current);
    readTimerRef.current = window.setTimeout(markActiveConversationRead, 120);
  }, [markActiveConversationRead]);

  useIonViewWillLeave(() => {
    chatViewActiveRef.current = false;
    if (readTimerRef.current) clearTimeout(readTimerRef.current);
  });

  const isTyping = !!conversation && typingConversationId === conversation.id;
  const lastOwnMessageId = conversation?.messages.reduce<string | null>((last, msg) => msg.from === 'me' ? msg.id : last, null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.length, isTyping]);

  useEffect(() => {
    return () => {
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
      if (conversationId) void sendTyping(conversationId, false);
    };
  }, [conversationId, sendTyping]);

  if (!conversationId) {
    return <Navigate to="/chat" replace />;
  }

  if (!conversation) {
    if (loadingConversation) {
      return (
        <ScreenShell contentClassName="chat-thread-content">
          <div className="chat-empty-state">
            <div className="avatar avatar-sm" aria-hidden="true">••</div>
            <p className="t-sm c-mid">Opening conversation…</p>
          </div>
        </ScreenShell>
      );
    }
    return <Navigate to="/chat" replace />;
  }

  const startPress = (action: () => void) => {
    pressFired.current = false;
    pressTimer.current = setTimeout(() => {
      pressFired.current = true;
      action();
    }, 480);
  };
  const clearPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };
  const releaseTap = (action: () => void) => {
    if (!pressFired.current) action();
  };
  const toggleReactionPicker = (messageId: string) => {
    setActiveReactionId((cur) => (cur === messageId ? null : messageId));
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setSendingMessage(true);
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    void sendTyping(conversation.id, false);
    try {
      const sent = await sendTextMessage(conversation.id, text);
      if (!sent) {
        showToast('Message failed to send. Please try again.');
        return;
      }
      setDraft('');
      setShowEmojiPicker(false);
    } finally {
      sendInFlightRef.current = false;
      setSendingMessage(false);
    }
  };

  const closeSheets = () => {
    setShowAttachSheet(false);
    setShowEmojiPicker(false);
  };

  const handlePickPhoto = async () => {
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setSendingMessage(true);
    try {
      const sent = await sendImageMessage(conversation.id, randomFrom(MOCK_IMAGE_NAMES));
      if (!sent) showToast('Message failed to send. Please try again.');
      else showToast('Image attached (mock)');
      closeSheets();
    } finally {
      sendInFlightRef.current = false;
      setSendingMessage(false);
    }
  };

  const handlePickFile = async () => {
    if (sendInFlightRef.current) return;
    const file = randomFrom(MOCK_FILES);
    sendInFlightRef.current = true;
    setSendingMessage(true);
    try {
      const sent = await sendFileMessage(conversation.id, file.name, file.type, file.size);
      if (!sent) showToast('Message failed to send. Please try again.');
      else showToast('File attached (mock)');
      closeSheets();
    } finally {
      sendInFlightRef.current = false;
      setSendingMessage(false);
    }
  };

  const handleHideConversation = async () => {
    if (!conversation || deletingConversation) return;
    setDeletingConversation(true);
    try {
      await hideConversation(conversation.id);
      setDeleteDialogOpen(false);
      navigate('/chat', { replace: true });
    } catch {
      showToast('Could not delete conversation. Please try again.');
    } finally {
      setDeletingConversation(false);
    }
  };

  const handleCamera = () => {
    closeSheets();
    showToast("Camera isn't available in this web prototype.");
  };

  const insertEmoji = (emoji: string) => {
    setDraft((prev) => prev + emoji);
  };

  const renderReactionPicker = (message: ChatMessage) =>
    activeReactionId === message.id && (
      <div className="chat-reaction-picker" onClick={(e) => e.stopPropagation()}>
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="chat-reaction-btn"
            aria-label={`React with ${emoji}`}
            onClick={() => {
              toggleReaction(conversation.id, message.id, emoji);
              setActiveReactionId(null);
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    );

  const renderReactionBadge = (message: ChatMessage) =>
    message.reaction && (
      <button
        type="button"
        className="chat-reaction-badge"
        onClick={(e) => {
          e.stopPropagation();
          toggleReaction(conversation.id, message.id, message.reaction!);
        }}
        aria-label="Remove reaction"
      >
        {message.reaction}
      </button>
    );

  const contextMenuReact = (message: ChatMessage) => (e: ReactMouseEvent) => {
    e.preventDefault();
    toggleReactionPicker(message.id);
  };

  return (
    <ScreenShell
      contentClassName="chat-thread-content"
      aside={
        <>
          <div className="chat-page-rail-wrap">
            <BottomNav active="chat" />
          </div>
          <ChatSidebar activeId={conversation.id} />
        </>
      }
      header={
        <div
          className="px-hd chat-thread-hd row-between"
          style={{ paddingBottom: 12, borderBottom: '1px solid var(--ag-border-soft)', position: 'relative' }}
        >
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate('/chat')} ariaLabel="Back to messages" />
            <div className="avatar avatar-sm" style={conversation.avatarStyle}>
              {conversation.initials}
            </div>
            <div>
              <div className="t-sm fw-700">{conversation.name}</div>
              <div className="row gap-8">
                <span className={`presence-dot-inline presence-${conversation.presence}`} />
                <span className="t-xs c-low">{presenceLabel(conversation.presence, conversation.lastSeenLabel)}</span>
              </div>
            </div>
          </div>
          <IconButton icon="dots" onClick={() => setShowMenu((v) => !v)} ariaLabel="More options" />

          {showMenu && (
            <div className="card chat-menu-dropdown">
              <button
                type="button"
                className="tap-card chat-menu-item"
                onClick={() => {
                  setShowMenu(false);
                  showToast('Profile preview coming soon');
                }}
              >
                View profile
              </button>
              <button
                type="button"
                className="tap-card chat-menu-item"
                onClick={() => {
                  setShowMenu(false);
                  showToast(`Notifications muted for ${conversation.name}`);
                }}
              >
                Mute notifications
              </button>
              <button
                type="button"
                className="tap-card chat-menu-item c-danger"
                onClick={() => {
                  setShowMenu(false);
                  showToast(`${conversation.name} blocked`);
                }}
              >
                Block user
              </button>
              <button
                type="button"
                className="tap-card chat-menu-item c-danger"
                onClick={() => {
                  setShowMenu(false);
                  setDeleteDialogOpen(true);
                }}
              >
                Delete Conversation
              </button>
            </div>
          )}
        </div>
      }
      footer={
        <div className="chat-composer-wrap">
          {showAttachSheet && (
            <div className="chat-composer-sheet">
              <button type="button" className="chat-attach-row" onClick={() => void handlePickPhoto()} disabled={sendingMessage}>
                <span className="chat-attach-icon">
                  <Icon name="image" style={{ width: 17, height: 17, stroke: 'var(--ag-text-mid)' }} />
                </span>
                Photos / Images
              </button>
              <button type="button" className="chat-attach-row" onClick={() => void handlePickFile()} disabled={sendingMessage}>
                <span className="chat-attach-icon">
                  <Icon name="file" style={{ width: 17, height: 17, stroke: 'var(--ag-text-mid)' }} />
                </span>
                Files
              </button>
              <button type="button" className="chat-attach-row" onClick={handleCamera}>
                <span className="chat-attach-icon">
                  <Icon name="camera" style={{ width: 17, height: 17, stroke: 'var(--ag-text-mid)' }} />
                </span>
                Camera
              </button>
              <button type="button" className="chat-attach-row c-danger" onClick={() => setShowAttachSheet(false)}>
                <span className="chat-attach-icon">
                  <Icon name="x" style={{ width: 15, height: 15, stroke: 'var(--ag-danger)' }} />
                </span>
                Cancel
              </button>
            </div>
          )}

          {showEmojiPicker && (
            <div className="chat-composer-sheet">
              <div className="row-between" style={{ padding: '2px 4px 6px' }}>
                <span className="t-xs c-low fw-700">Emoji</span>
                <IconButton icon="x" onClick={() => setShowEmojiPicker(false)} ariaLabel="Close emoji picker" />
              </div>
              <div className="chat-emoji-grid">
                {COMPOSER_EMOJIS.map((emoji) => (
                  <button key={emoji} type="button" className="chat-emoji-btn" onClick={() => insertEmoji(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleSend} className="chat-composer-form">
            <IconButton
              icon="paperclip"
              ariaLabel="Attach a photo or file"
              onClick={() => {
                setShowAttachSheet((v) => !v);
                setShowEmojiPicker(false);
              }}
            />
            <IconButton
              icon="smile"
              ariaLabel="Add an emoji"
              onClick={() => {
                setShowEmojiPicker((v) => !v);
                setShowAttachSheet(false);
              }}
            />
            <div className="input-field" style={{ flex: 1, padding: '11px 14px' }}>
              <input
                type="text"
                placeholder={`Message ${conversation.name.split(' ')[0]}…`}
                value={draft}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft(value);
                  if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
                  if (conversation) {
                    if (value.trim()) void sendTyping(conversation.id, true);
                    else void sendTyping(conversation.id, false);
                    typingStopTimer.current = setTimeout(() => {
                      void sendTyping(conversation.id, false);
                    }, 1200);
                  }
                }}
                aria-label={`Message ${conversation.name}`}
              />
            </div>
            <IconButton icon="mic" ariaLabel="Record a voice message" onClick={() => showToast('Voice messages coming soon')} />
            <button
              type="submit"
              aria-label="Send message"
              disabled={!draft.trim() || sendingMessage}
              aria-busy={sendingMessage}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                background: 'var(--ag-grad-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                border: 'none',
                padding: 0,
                opacity: draft.trim() && !sendingMessage ? 1 : 0.5,
              }}
            >
              <Icon name={sendingMessage ? 'clock' : 'send'} style={{ width: 16, height: 16, stroke: '#fff' }} />
            </button>
          </form>
        </div>
      }
    >
      {conversation.messages.length === 0 ? (
        <div className="chat-empty-state chat-empty-state-thread">
          <div className="chat-empty-avatar" style={conversation.avatarStyle}>
            {conversation.initials}
          </div>
          <div className="t-md fw-700">Start a conversation</div>
          <p className="t-sm c-mid">Say hello to {conversation.name.split(' ')[0]} and start chatting.</p>
        </div>
      ) : (
        <>
          <div style={{ textAlign: 'center', marginBottom: 16, paddingTop: 4 }}>
            <span className="t-xs c-low">{conversation.dayLabel}</span>
          </div>

          {conversation.messages.map((msg) => {
        const isMe = msg.from === 'me';

        if (msg.kind === 'revision') {
          return (
            <div className="card-glass" key={msg.id} style={{ borderColor: 'rgba(232,178,61,0.3)', marginBottom: 14 }}>
              <div className="row gap-10">
                <Icon name="alert" style={{ width: 16, height: 16, stroke: 'var(--ag-warning)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-xs fw-700 c-warning">Revision requested</div>
                  <div className="t-xs c-mid" style={{ marginTop: 2 }}>
                    &ldquo;{msg.text}&rdquo;
                  </div>
                </div>
              </div>
              <span className="t-xs c-low" style={{ display: 'block', marginTop: 8 }}>
                {msg.time}
              </span>
            </div>
          );
        }

        if (msg.kind === 'image') {
          return (
            <div key={msg.id} className={`chat-msg-wrap${isMe ? ' is-me' : ''}`}>
              <div
                onMouseDown={() => startPress(() => toggleReactionPicker(msg.id))}
                onMouseUp={clearPress}
                onMouseLeave={clearPress}
                onTouchStart={() => startPress(() => toggleReactionPicker(msg.id))}
                onTouchEnd={clearPress}
                onContextMenu={contextMenuReact(msg)}
                onClick={() => releaseTap(() => setLightbox({ variant: msg.imageVariant ?? 1, name: msg.imageName }))}
                role="button"
                tabIndex={0}
              >
                <ArtTile
                  variant={msg.imageVariant ?? 1}
                  style={{
                    height: 150,
                    width: '100%',
                    borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      padding: '8px 10px',
                      background: 'linear-gradient(0deg, rgba(0,0,0,0.55), transparent)',
                    }}
                  >
                    <span className="t-xs" style={{ color: '#fff', fontWeight: 600 }}>
                      {msg.imageName}
                    </span>
                  </div>
                </ArtTile>
              </div>
              {renderReactionBadge(msg)}
              {renderReactionPicker(msg)}
              <div className="chat-status-row" style={{ justifyContent: isMe ? 'flex-end' : 'flex-start', marginTop: 4 }}>
                <span className="t-xs c-low">{msg.time}</span>
                {isMe && (
                  <>
                    <StatusTicks status={msg.status} />
                    {msg.id === lastOwnMessageId && msg.status === 'read' && <span className="t-xs c-accent chat-seen-label">Seen</span>}
                  </>
                )}
              </div>
            </div>
          );
        }

        if (msg.kind === 'file') {
          return (
            <div key={msg.id} className={`chat-msg-wrap${isMe ? ' is-me' : ''}`}>
              <div
                className="card chat-file-card"
                style={{ background: isMe ? 'var(--ag-grad-accent)' : 'var(--ag-surface-2)', border: isMe ? 'none' : undefined }}
                onMouseDown={() => startPress(() => toggleReactionPicker(msg.id))}
                onMouseUp={clearPress}
                onMouseLeave={clearPress}
                onTouchStart={() => startPress(() => toggleReactionPicker(msg.id))}
                onTouchEnd={clearPress}
                onContextMenu={contextMenuReact(msg)}
                onClick={() => releaseTap(() => toggleReactionPicker(msg.id))}
                role="button"
                tabIndex={0}
              >
                <span className="chat-file-icon">
                  <Icon name="file" style={{ stroke: isMe ? '#fff' : 'var(--ag-text-mid)' }} />
                </span>
                <div className="chat-file-meta">
                  <span className="t-sm fw-700 chat-file-name" style={{ color: isMe ? '#fff' : 'inherit' }}>
                    {msg.fileName}
                  </span>
                  <span className="t-xs" style={{ color: isMe ? 'rgba(255,255,255,0.8)' : 'var(--ag-text-low)' }}>
                    {msg.fileType} · {msg.fileSize}
                  </span>
                </div>
              </div>
              {renderReactionBadge(msg)}
              {renderReactionPicker(msg)}
              <div className="chat-status-row" style={{ justifyContent: isMe ? 'flex-end' : 'flex-start', marginTop: 4 }}>
                <span className="t-xs c-low">{msg.time}</span>
                {isMe && (
                  <>
                    <StatusTicks status={msg.status} />
                    {msg.id === lastOwnMessageId && msg.status === 'read' && <span className="t-xs c-accent chat-seen-label">Seen</span>}
                  </>
                )}
              </div>
            </div>
          );
        }

        return (
          <div key={msg.id} className={`chat-msg-wrap${isMe ? ' is-me' : ''}`} style={{ textAlign: isMe ? 'right' : 'left' }}>
            <div
              className="card"
              style={{
                padding: '11px 14px',
                borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: isMe ? 'var(--ag-grad-accent)' : 'var(--ag-surface-2)',
                border: isMe ? 'none' : undefined,
                textAlign: 'left',
                display: 'inline-block',
              }}
              onMouseDown={() => startPress(() => toggleReactionPicker(msg.id))}
              onMouseUp={clearPress}
              onMouseLeave={clearPress}
              onTouchStart={() => startPress(() => toggleReactionPicker(msg.id))}
              onTouchEnd={clearPress}
              onContextMenu={contextMenuReact(msg)}
              onClick={() => releaseTap(() => toggleReactionPicker(msg.id))}
              role="button"
              tabIndex={0}
            >
              <span className="t-sm" style={{ color: isMe ? '#fff' : 'inherit' }}>
                {msg.text}
              </span>
            </div>
            <div>{renderReactionBadge(msg)}</div>
            <div style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>{renderReactionPicker(msg)}</div>
            <div className="chat-status-row" style={{ justifyContent: isMe ? 'flex-end' : 'flex-start', marginTop: 2 }}>
              <span className="t-xs c-low">{msg.time}</span>
              {isMe && (
                  <>
                    <StatusTicks status={msg.status} />
                    {msg.id === lastOwnMessageId && msg.status === 'read' && <span className="t-xs c-accent chat-seen-label">Seen</span>}
                  </>
                )}
            </div>
          </div>
        );
          })}
        </>
      )}

      {isTyping && (
        <div className="chat-msg-wrap">
          <div className="chat-typing-bubble">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </div>
          <div className="t-xs c-low" style={{ marginTop: 4 }}>
            {conversation.name} is typing…
          </div>
        </div>
      )}

      <div ref={bottomRef} />

      {lightbox && (
        <div className="chat-lightbox-overlay" onClick={() => setLightbox(null)}>
          <IconButton
            icon="x"
            ariaLabel="Close preview"
            style={{ position: 'absolute', top: 'max(env(safe-area-inset-top, 0px), 18px)', right: 18 }}
            onClick={() => setLightbox(null)}
          />
          <ArtTile variant={lightbox.variant} locked={false} style={{ width: 'min(88vw, 420px)', height: 'min(60vh, 420px)' }} />
          {lightbox.name && (
            <div className="chat-lightbox-caption">
              <span className="t-sm fw-600">{lightbox.name}</span>
            </div>
          )}
        </div>
      )}

      {deleteDialogOpen && (
        <div className="account-dialog-backdrop" role="presentation" onClick={() => !deletingConversation && setDeleteDialogOpen(false)}>
          <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title" onClick={(e) => e.stopPropagation()}>
            <div className="account-dialog-icon"><Icon name="alert" /></div>
            <h2 id="delete-conversation-title">Delete this conversation?</h2>
            <p>It will disappear from your list. The other participant keeps their conversation and history.</p>
            <div className="account-dialog-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteDialogOpen(false)} disabled={deletingConversation}>Cancel</button>
              <button type="button" className="btn btn-secondary btn-sm account-danger-button" onClick={() => void handleHideConversation()} disabled={deletingConversation}>
                {deletingConversation ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </section>
        </div>
      )}

      {toast}
    </ScreenShell>
  );
}
