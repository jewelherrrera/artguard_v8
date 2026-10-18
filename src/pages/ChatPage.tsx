import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useIonViewDidEnter, useIonViewWillLeave } from '@ionic/react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { BottomNav } from '../components/ui/BottomNav';
import { IconButton } from '../components/ui/IconButton';
import { ArtTile } from '../components/ui/ArtTile';
import { ProtectedArtworkDisplay } from '../components/ui/ProtectedArtworkDisplay';
import { Icon } from '../assets/icons';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';
import { navigateToFullProfile } from '../lib/profileNavigation';
import { useMockToast } from '../components/ui/MockToast';
import { ChatSidebar } from '../components/chat/ChatSidebar';
import type { ChatMessage, MessageStatus } from '../data/mockData';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  createChatAttachmentSignedUrl,
  getAttachmentTypeLabel,
  formatAttachmentSize,
  getChatAttachmentKind,
  MAX_CHAT_FILE_BYTES,
  MAX_CHAT_IMAGE_BYTES,
  validateChatAttachment,
} from '../lib/supabaseChatAttachments';
import {
  createArtworkProtectedSignedUrl,
  listMyArtworks,
  type ArtworkRecord,
} from '../lib/supabaseArtworks';
import { listMyProtectionSettings } from '../lib/supabaseProtection';
import './ChatPage.css';

const REACTION_EMOJIS = ['❤️', '👍', '😂', '😮', '😢'];
const COMPOSER_EMOJIS = ['😀', '😂', '❤️', '👍', '🔥', '🎨', '😢', '🙏', '✅', '👏', '🎉', '😮'];

interface ShareableArtwork extends ArtworkRecord {
  previewUrl: string;
  settings: {
    dynamic_cloaking: boolean;
    canvas_tiling: boolean;
    right_click_shield: boolean;
  };
}

interface SharedArtworkPreview {
  artworkId: string;
  title: string;
  ownerId: string;
  previewUrl: string;
  settings: {
    dynamic_cloaking: boolean;
    canvas_tiling: boolean;
    right_click_shield: boolean;
  };
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
    sendAttachmentMessage,
    sendArtworkMessage,
    toggleReaction,
    markAsRead,
    hideConversation,
    setConversationMuted,
    getChatBlockState,
    setChatUserBlocked,
  } = useChat();
  const { user } = useAuth();
  const { toast, showToast } = useMockToast();

  const contextConversation = conversationId ? getConversation(conversationId) : undefined;
  const [resolvedConversation, setResolvedConversation] = useState<NonNullable<typeof contextConversation> | null>(null);
  const [conversationLoadState, setConversationLoadState] = useState<{
    id: string;
    status: 'loading' | 'error';
  } | null>(null);
  const [conversationLoadAttempt, setConversationLoadAttempt] = useState(0);

  const conversation = contextConversation
    ?? (resolvedConversation?.id === conversationId ? resolvedConversation : undefined);
  const loadConversationByIdRef = useRef(loadConversationById);

  const [draft, setDraft] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeReactionId, setActiveReactionId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ variant: 1 | 2 | 3 | 4 | 5 | 6; name?: string; src?: string } | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{ file: File; kind: 'image' | 'file'; previewUrl?: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [attachmentErrors, setAttachmentErrors] = useState<Record<string, string>>({});
  const [sharedArtworkPreviews, setSharedArtworkPreviews] = useState<Record<string, SharedArtworkPreview | null>>({});
  const [shareArtworkOpen, setShareArtworkOpen] = useState(false);
  const [shareableArtworks, setShareableArtworks] = useState<ShareableArtwork[]>([]);
  const [selectedArtworkId, setSelectedArtworkId] = useState<string>();
  const [shareArtworkLoading, setShareArtworkLoading] = useState(false);
  const [shareArtworkError, setShareArtworkError] = useState<string>();
  const [sharingArtwork, setSharingArtwork] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockState, setBlockState] = useState<{ blockedByMe: boolean; messagingUnavailable: boolean } | null>(null);
  const [blockStateLoading, setBlockStateLoading] = useState(false);
  const [blockStateError, setBlockStateError] = useState(false);
  const [blockStateAttempt, setBlockStateAttempt] = useState(0);
  const [blockActionPending, setBlockActionPending] = useState(false);
  const [blockActionError, setBlockActionError] = useState<string>();
  const [muteActionPending, setMuteActionPending] = useState(false);
  const [menuActionError, setMenuActionError] = useState<string>();
  const [openingProfile, setOpeningProfile] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressFired = useRef(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendInFlightRef = useRef(false);
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatViewActiveRef = useRef(false);

  useEffect(() => {
    loadConversationByIdRef.current = loadConversationById;
  }, [loadConversationById]);

  useEffect(() => {
    const otherUserId = conversation?.otherUserId;
    if (!otherUserId || otherUserId === user?.id) {
      setBlockState(null);
      setBlockStateLoading(false);
      setBlockStateError(false);
      return;
    }
    let active = true;
    setBlockState(null);
    setBlockStateLoading(true);
    setBlockStateError(false);
    void getChatBlockState(otherUserId)
      .then((state) => {
        if (active) setBlockState(state);
      })
      .catch((error) => {
        console.error('ArtGuard: unable to load chat block state', error);
        if (active) setBlockStateError(true);
      })
      .finally(() => {
        if (active) setBlockStateLoading(false);
      });
    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible') setBlockStateAttempt((attempt) => attempt + 1);
    };
    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [blockStateAttempt, conversation?.otherUserId, getChatBlockState, user?.id]);

  const messagingUnavailable = Boolean(conversation?.otherUserId)
    && (blockStateLoading || !blockState || blockState.messagingUnavailable);
  const messagingUnavailableText = blockState?.blockedByMe
    ? 'You blocked this user. Unblock them from the conversation menu to message again.'
    : blockState?.messagingUnavailable
      ? 'Messaging is currently unavailable.'
      : blockStateError
        ? 'Messaging availability could not be verified. Try refreshing this conversation.'
        : 'Checking messaging availability…';

  useEffect(() => {
    let cancelled = false;

    if (!conversationId || contextConversation) {
      setConversationLoadState(null);
      if (contextConversation) setResolvedConversation(contextConversation);
      return;
    }

    setConversationLoadState({ id: conversationId, status: 'loading' });
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled || settled) return;
      settled = true;
      console.error('ArtGuard: requested conversation loading timed out');
      setResolvedConversation(null);
      setConversationLoadState({ id: conversationId, status: 'error' });
    }, 15000);

    void loadConversationByIdRef.current(conversationId).then((found) => {
      if (cancelled || settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (found && found.id !== conversationId) {
        navigate(`/chat/${found.id}`, { replace: true });
        return;
      }
      setResolvedConversation(found);
      setConversationLoadState(found
        ? null
        : { id: conversationId, status: 'error' });
    }).catch((error: unknown) => {
      console.error('ArtGuard: requested conversation could not be opened', error);
      if (cancelled || settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      setResolvedConversation(null);
      setConversationLoadState({ id: conversationId, status: 'error' });
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [conversationId, contextConversation, conversationLoadAttempt, navigate]);

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

  useEffect(() => {
    const previewUrl = pendingAttachment?.previewUrl;
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [pendingAttachment?.previewUrl]);

  useEffect(() => {
    if (!conversation || !isSupabaseConfigured || !supabase) return;
    let cancelled = false;
    const attachments = conversation.messages.filter(
      (message): message is ChatMessage & { attachmentStoragePath: string } =>
        Boolean(message.attachmentStoragePath && !attachmentUrls[message.id]),
    );
    for (const message of attachments) {
      void createChatAttachmentSignedUrl(
        message.attachmentStoragePath,
        message.kind === 'file' ? message.fileName : undefined,
      )
        .then((url) => {
          if (!cancelled) setAttachmentUrls((current) => ({ ...current, [message.id]: url }));
        })
        .catch((error) => {
          console.error('ArtGuard: unable to open authorized chat attachment', error);
          if (!cancelled) {
            setAttachmentErrors((current) => ({
              ...current,
              [message.id]: error instanceof Error ? error.message : 'The secure attachment could not be opened.',
            }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [attachmentUrls, conversation]);

  useEffect(() => {
    if (!conversation || !isSupabaseConfigured || !supabase) return;
    let cancelled = false;
    const sharedMessages = conversation.messages.filter(
      (message) => message.kind === 'artwork' && !(message.id in sharedArtworkPreviews),
    );
    for (const message of sharedMessages) {
      if (!message.artworkId) {
        setSharedArtworkPreviews((current) => ({ ...current, [message.id]: null }));
        continue;
      }
      void (async () => {
        try {
          const { data, error } = await supabase.rpc('get_chat_shared_artwork_preview', {
            p_conversation_id: conversation.id,
            p_message_id: message.id,
          });
          if (error) throw error;
          const record = (Array.isArray(data) ? data[0] : data) as {
            artwork_id: string;
            title: string;
            owner_id: string;
            protected_storage_path: string;
            dynamic_cloaking: boolean;
            canvas_tiling: boolean;
            right_click_shield: boolean;
          } | null;
          if (!record) {
            if (!cancelled) setSharedArtworkPreviews((current) => ({ ...current, [message.id]: null }));
            return;
          }
          const { data: signed, error: signingError } = await supabase.storage
            .from('artworks')
            .createSignedUrl(record.protected_storage_path, 60);
          if (signingError) throw signingError;
          if (!cancelled) {
            setSharedArtworkPreviews((current) => ({
              ...current,
              [message.id]: {
                artworkId: record.artwork_id,
                title: record.title,
                ownerId: record.owner_id,
                previewUrl: signed.signedUrl,
                settings: {
                  dynamic_cloaking: record.dynamic_cloaking,
                  canvas_tiling: record.canvas_tiling,
                  right_click_shield: record.right_click_shield,
                },
              },
            }));
          }
        } catch (error) {
          console.error('ArtGuard: unable to load shared protected artwork', error);
          if (!cancelled) setSharedArtworkPreviews((current) => ({ ...current, [message.id]: null }));
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [conversation, sharedArtworkPreviews]);

  if (!conversationId) {
    return <Navigate to="/chat" replace />;
  }

  if (!conversation) {
    const conversationStatus = conversationLoadState?.id === conversationId
      ? conversationLoadState.status
      : 'loading';
    if (conversationStatus === 'loading') {
      return (
        <ScreenShell aside={<ChatSidebar activeId={conversationId} />} contentClassName="chat-thread-content">
          <div className="chat-empty-state">
            <div className="avatar avatar-sm" aria-hidden="true">••</div>
            <p className="t-sm c-mid" role="status">Opening conversation…</p>
          </div>
        </ScreenShell>
      );
    }
    return (
      <ScreenShell aside={<ChatSidebar activeId={conversationId} />} contentClassName="chat-thread-content">
        <div className="chat-empty-state">
          <p className="t-sm c-mid" role="alert">This conversation could not be loaded.</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setConversationLoadAttempt((attempt) => attempt + 1)}
          >
            Retry
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/chat')}>
            Back to inbox
          </button>
        </div>
      </ScreenShell>
    );
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
    if (!text || messagingUnavailable || sendInFlightRef.current) return;
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
      if (sent.conversationId && sent.conversationId !== conversation.id) {
        navigate(`/chat/${sent.conversationId}`, { replace: true });
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

  const handlePickPhoto = () => {
    if (messagingUnavailable || sendingMessage) return;
    closeSheets();
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
      imageInputRef.current.click();
    }
  };

  const handlePickFile = () => {
    if (messagingUnavailable || sendingMessage) return;
    closeSheets();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const validationError = validateChatAttachment(file);
    if (validationError) {
      showToast(validationError);
      return;
    }
    const kind = getChatAttachmentKind(file);
    if (!kind) {
      showToast('This file type is not supported.');
      return;
    }
    setPendingAttachment({
      file,
      kind,
      previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
    });
    setUploadProgress(null);
  };

  const handleSendAttachment = async () => {
    if (!pendingAttachment || messagingUnavailable || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setSendingMessage(true);
    setUploadProgress(0);
    try {
      const sent = await sendAttachmentMessage(conversation.id, pendingAttachment.file, setUploadProgress);
      if (!sent) {
        showToast('The attachment was not sent. Please try again.');
        return;
      }
      if (sent.conversationId && sent.conversationId !== conversation.id) {
        navigate(`/chat/${sent.conversationId}`, { replace: true });
      }
      setPendingAttachment(null);
      setUploadProgress(null);
      showToast('Attachment sent.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The attachment was not sent. Please try again.';
      showToast(message);
    } finally {
      sendInFlightRef.current = false;
      setSendingMessage(false);
    }
  };

  const handleCamera = () => {
    if (messagingUnavailable || sendingMessage) return;
    closeSheets();
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
      cameraInputRef.current.click();
    }
  };

  const handleOpenShareArtwork = async () => {
    closeSheets();
    setShareArtworkOpen(true);
    setShareArtworkError(undefined);
    setSelectedArtworkId(undefined);
    setShareableArtworks([]);
    if (!isSupabaseConfigured || !supabase || !user || user.role !== 'artist') {
      setShareableArtworks([]);
      setShareArtworkLoading(false);
      return;
    }

    setShareArtworkLoading(true);
    try {
      const records = await listMyArtworks(user.id);
      const eligible = records.filter((artwork) =>
        artwork.status === 'ready'
        && Boolean(artwork.protected_storage_path)
        && (artwork.visibility === 'portfolio' || artwork.visibility === 'discover'),
      );
      const settings = await listMyProtectionSettings(user.id, eligible.map((artwork) => artwork.id));
      const settingsByArtworkId = new Map(settings.map((item) => [item.artwork_id, item]));
      const shareable = await Promise.all(eligible.map(async (artwork) => {
        const protectionSettings = settingsByArtworkId.get(artwork.id);
        return {
          ...artwork,
          previewUrl: await createArtworkProtectedSignedUrl(artwork.id, user.id),
          settings: {
            dynamic_cloaking: protectionSettings?.dynamic_cloaking ?? false,
            canvas_tiling: protectionSettings?.canvas_tiling ?? false,
            right_click_shield: protectionSettings?.right_click_shield ?? false,
          },
        };
      }));
      setShareableArtworks(shareable);
    } catch (error) {
      console.error('ArtGuard: unable to load shareable protected artworks', error);
      setShareArtworkError(error instanceof Error ? error.message : 'Could not load your protected artworks.');
    } finally {
      setShareArtworkLoading(false);
    }
  };

  const handleShareArtwork = async () => {
    if (!selectedArtworkId || sharingArtwork || messagingUnavailable) return;
    setSharingArtwork(true);
    try {
      const sent = await sendArtworkMessage(conversation.id, selectedArtworkId);
      if (!sent) {
        showToast('This artwork could not be shared from the current account mode.');
        return;
      }
      if (sent.conversationId && sent.conversationId !== conversation.id) {
        navigate(`/chat/${sent.conversationId}`, { replace: true });
      }
      setShareArtworkOpen(false);
      setSelectedArtworkId(undefined);
      showToast('Protected artwork shared.');
    } catch (error) {
      console.error('ArtGuard: artwork message failed', error);
      showToast(error instanceof Error ? error.message : 'The artwork was not shared. Please try again.');
    } finally {
      setSharingArtwork(false);
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

  const insertEmoji = (emoji: string) => {
    setDraft((prev) => prev + emoji);
  };

  const handleViewProfile = async () => {
    const otherUserId = conversation.otherUserId;
    if (openingProfile) return;
    if (!otherUserId || !user || otherUserId === user.id) {
      showToast('This participant profile is unavailable.');
      return;
    }
    setOpeningProfile(true);
    setMenuActionError(undefined);
    try {
      const navigated = await navigateToFullProfile(navigate, otherUserId, user.id);
      if (!navigated) {
        setMenuActionError('This participant profile is no longer available.');
        return;
      }
      setShowMenu(false);
    } catch (error) {
      console.error('ArtGuard: unable to open participant profile', error);
      setMenuActionError('Could not open this participant profile. Please try again.');
    } finally {
      setOpeningProfile(false);
    }
  };

  const handleToggleMute = async () => {
    if (!conversation.otherUserId || muteActionPending) return;
    setMuteActionPending(true);
    setMenuActionError(undefined);
    try {
      const muted = !conversation.notificationsMuted;
      await setConversationMuted(conversation.id, muted);
      setShowMenu(false);
      showToast(muted ? 'Notifications muted for this conversation.' : 'Notifications unmuted for this conversation.');
    } catch (error) {
      console.error('ArtGuard: unable to save conversation mute preference', error);
      setMenuActionError('Could not save this notification setting. Please try again.');
    } finally {
      setMuteActionPending(false);
    }
  };

  const handleChangeBlock = async (blocked: boolean) => {
    const otherUserId = conversation.otherUserId;
    if (!otherUserId || blockActionPending) return;
    setBlockActionPending(true);
    setBlockActionError(undefined);
    try {
      const nextState = await setChatUserBlocked(otherUserId, blocked);
      setBlockState(nextState);
      setBlockDialogOpen(false);
      setShowMenu(false);
      showToast(blocked ? 'User blocked. Messaging is unavailable until you unblock them.' : 'User unblocked.');
    } catch (error) {
      console.error('ArtGuard: unable to update chat block', error);
      setBlockActionError(blocked
        ? 'Could not block this user. Please try again.'
        : 'Could not unblock this user. Please try again.');
    } finally {
      setBlockActionPending(false);
    }
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
            <ProfileAvatar
              className="avatar avatar-sm"
              imageUrl={conversation.avatarDataUrl}
              initials={conversation.initials}
              style={conversation.avatarStyle}
            />
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
            <div className="card chat-menu-dropdown ag-liquid-glass-strong">
              {!conversation.otherUserId && (
                <div className="t-xs c-low" role="note" style={{ padding: '6px 12px' }}>
                  Profile, mute, and block controls require a real account conversation.
                </div>
              )}
              <button
                type="button"
                className="tap-card chat-menu-item"
                onClick={() => void handleViewProfile()}
                disabled={!conversation.otherUserId || !user || conversation.otherUserId === user.id || openingProfile}
              >
                {openingProfile ? 'Opening Profile…' : 'View Profile'}
              </button>
              <button
                type="button"
                className="tap-card chat-menu-item"
                onClick={() => void handleToggleMute()}
                disabled={!conversation.otherUserId || muteActionPending}
              >
                {muteActionPending ? 'Saving…' : conversation.notificationsMuted ? 'Unmute Notifications' : 'Mute Notifications'}
              </button>
              <button
                type="button"
                className="tap-card chat-menu-item c-danger"
                onClick={() => {
                  setBlockActionError(undefined);
                  if (blockState?.blockedByMe) void handleChangeBlock(false);
                  else {
                    setShowMenu(false);
                    setBlockDialogOpen(true);
                  }
                }}
                disabled={!conversation.otherUserId || blockStateLoading || !blockState || blockActionPending}
              >
                {blockActionPending ? 'Saving…' : blockState?.blockedByMe ? 'Unblock User' : 'Block User'}
              </button>
              {(menuActionError || blockStateError) && (
                <div className="t-xs c-danger" role="alert" style={{ padding: '4px 12px 8px' }}>
                  {menuActionError ?? 'Could not verify messaging settings. Please retry.'}
                </div>
              )}
              {blockStateError && (
                <button
                  type="button"
                  className="tap-card chat-menu-item"
                  onClick={() => setBlockStateAttempt((attempt) => attempt + 1)}
                  disabled={blockStateLoading}
                >
                  Retry block status
                </button>
              )}
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
          {messagingUnavailable && (
            <div className="chat-messaging-unavailable t-sm" role="status">
              {messagingUnavailableText}
            </div>
          )}
          {showAttachSheet && !messagingUnavailable && (
            <div className="chat-composer-sheet ag-liquid-glass-strong">
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
              <button type="button" className="chat-attach-row" onClick={() => void handleOpenShareArtwork()}>
                <span className="chat-attach-icon">
                  <Icon name="image" style={{ width: 17, height: 17, stroke: 'var(--ag-text-mid)' }} />
                </span>
                Share Artwork
              </button>
              <button type="button" className="chat-attach-row c-danger" onClick={() => setShowAttachSheet(false)}>
                <span className="chat-attach-icon">
                  <Icon name="x" style={{ width: 15, height: 15, stroke: 'var(--ag-danger)' }} />
                </span>
                Cancel
              </button>
            </div>
          )}

          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileSelection}
            hidden
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            capture="environment"
            onChange={handleFileSelection}
            hidden
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.rtf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
            onChange={handleFileSelection}
            hidden
          />

          {pendingAttachment && (
            <section className="chat-attachment-confirm card" aria-label="Attachment preview">
              {pendingAttachment.kind === 'image' && pendingAttachment.previewUrl ? (
                <img className="chat-attachment-preview-image" src={pendingAttachment.previewUrl} alt="Selected image preview" />
              ) : (
                <span className="chat-file-icon">
                  <Icon name="file" style={{ stroke: 'var(--ag-text-mid)' }} />
                </span>
              )}
              <div className="chat-file-meta">
                <span className="t-sm fw-700 chat-file-name">{pendingAttachment.file.name}</span>
                <span className="t-xs c-low">
                  {getAttachmentTypeLabel(pendingAttachment.file)} · {formatAttachmentSize(pendingAttachment.file.size)}
                </span>
                <span className="t-xs c-low">
                  Limits: {MAX_CHAT_IMAGE_BYTES / (1024 * 1024)} MB per image; {MAX_CHAT_FILE_BYTES / (1024 * 1024)} MB per file.
                </span>
              </div>
              <div className="chat-attachment-confirm-actions">
                {uploadProgress !== null && (
                  <div
                    className="chat-upload-progress"
                    role="progressbar"
                    aria-label="Attachment upload progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={uploadProgress}
                  >
                    <span style={{ width: `${uploadProgress}%` }} />
                    <span className="t-xs c-low">{sendingMessage ? `Uploading ${uploadProgress}%` : 'Ready to upload'}</span>
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={sendingMessage}
                  onClick={() => {
                    setPendingAttachment(null);
                    setUploadProgress(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={sendingMessage || messagingUnavailable}
                  onClick={() => void handleSendAttachment()}
                >
                  {sendingMessage ? 'Sending…' : 'Send'}
                </button>
              </div>
            </section>
          )}

          {shareArtworkOpen && (
            <div className="chat-artwork-modal-backdrop" role="presentation" onClick={() => !sharingArtwork && setShareArtworkOpen(false)}>
              <section
                className="chat-artwork-modal card ag-liquid-glass-strong"
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-share-artwork-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="row-between gap-10">
                  <div>
                    <h2 id="chat-share-artwork-title" className="t-md fw-700">Share Artwork</h2>
                    <p className="t-xs c-low">Only ready artwork with a published protected preview can be shared.</p>
                  </div>
                  <IconButton
                    icon="x"
                    ariaLabel="Close artwork selection"
                    disabled={sharingArtwork}
                    onClick={() => setShareArtworkOpen(false)}
                  />
                </div>
                {shareArtworkLoading ? (
                  <p className="t-sm c-mid" role="status">Loading eligible protected artwork…</p>
                ) : shareArtworkError ? (
                  <div className="t-sm c-danger" role="alert">
                    {shareArtworkError}
                    <button type="button" className="link-sm" onClick={() => void handleOpenShareArtwork()}>Try again</button>
                  </div>
                ) : user?.role !== 'artist' ? (
                  <p className="t-sm c-mid">Only artwork owned by an Artist account can be shared.</p>
                ) : shareableArtworks.length === 0 ? (
                  <p className="t-sm c-mid">No eligible published protected artwork is available to share.</p>
                ) : (
                  <div className="chat-artwork-options">
                    {shareableArtworks.map((artwork) => (
                      <button
                        key={artwork.id}
                        type="button"
                        className={`chat-artwork-option${selectedArtworkId === artwork.id ? ' is-selected' : ''}`}
                        aria-pressed={selectedArtworkId === artwork.id}
                        onClick={() => setSelectedArtworkId(artwork.id)}
                      >
                        <span className="chat-artwork-option-preview">
                          <ProtectedArtworkDisplay
                            src={artwork.previewUrl}
                            alt=""
                            settings={artwork.settings}
                            fitMode="cover"
                            className="chat-artwork-option-image"
                          />
                        </span>
                        <span className="chat-artwork-option-copy">
                          <span className="t-sm fw-700">{artwork.title}</span>
                          <span className="t-xs c-low">Protected · {artwork.visibility === 'discover' ? 'Discover' : 'Portfolio'}</span>
                        </span>
                        <span className="chat-artwork-option-check" aria-hidden="true">
                          {selectedArtworkId === artwork.id ? '✓' : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="chat-artwork-modal-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShareArtworkOpen(false)} disabled={sharingArtwork}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleShareArtwork()}
                    disabled={!selectedArtworkId || sharingArtwork || messagingUnavailable}
                  >
                    {sharingArtwork ? 'Sharing…' : 'Share'}
                  </button>
                </div>
              </section>
            </div>
          )}

          {showEmojiPicker && !messagingUnavailable && (
            <div className="chat-composer-sheet ag-liquid-glass-strong">
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
              disabled={messagingUnavailable || sendingMessage}
              onClick={() => {
                setShowAttachSheet((v) => !v);
                setShowEmojiPicker(false);
              }}
            />
            <IconButton
              icon="smile"
              ariaLabel="Add an emoji"
              disabled={messagingUnavailable || sendingMessage}
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
                disabled={messagingUnavailable}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft(value);
                  if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
                  if (conversation && !messagingUnavailable) {
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
            <IconButton icon="mic" ariaLabel="Record a voice message" disabled={messagingUnavailable} onClick={() => showToast('Voice messages coming soon')} />
            <button
              type="submit"
              aria-label="Send message"
              disabled={!draft.trim() || sendingMessage || messagingUnavailable}
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
                opacity: draft.trim() && !sendingMessage && !messagingUnavailable ? 1 : 0.5,
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

        if (msg.kind === 'artwork') {
          const artwork = sharedArtworkPreviews[msg.id];
          return (
            <div key={msg.id} className={`chat-msg-wrap${isMe ? ' is-me' : ''}`}>
              <div className="chat-shared-artwork-card card">
                {artwork ? (
                  <>
                    <div className="chat-shared-artwork-preview">
                      <ProtectedArtworkDisplay
                        src={artwork.previewUrl}
                        alt={`Protected preview of ${artwork.title}`}
                        settings={artwork.settings}
                        fitMode="contain"
                      />
                    </div>
                    <div className="chat-shared-artwork-copy">
                      <span className="t-sm fw-700">{artwork.title}</span>
                      <span className="t-xs c-low">Protected artwork</span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => navigate(`/market/artist/${artwork.ownerId}`)}
                      >
                        View Artwork
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="chat-shared-artwork-unavailable t-sm c-mid" role="status">
                    {artwork === null ? 'This artwork is no longer available to view.' : 'Loading protected artwork…'}
                  </div>
                )}
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

        if (msg.kind === 'image') {
          const imageUrl = attachmentUrls[msg.id] ?? msg.imageUrl;
          return (
            <div key={msg.id} className={`chat-msg-wrap${isMe ? ' is-me' : ''}`}>
              <div
                onMouseDown={() => startPress(() => toggleReactionPicker(msg.id))}
                onMouseUp={clearPress}
                onMouseLeave={clearPress}
                onTouchStart={() => startPress(() => toggleReactionPicker(msg.id))}
                onTouchEnd={clearPress}
                onContextMenu={contextMenuReact(msg)}
                onClick={() => releaseTap(() => setLightbox({ variant: msg.imageVariant ?? 1, name: msg.imageName, src: imageUrl }))}
                role="button"
                tabIndex={0}
              >
                {imageUrl ? (
                  <div className="chat-image-attachment">
                    <img src={imageUrl} alt={msg.imageName ?? 'Shared image'} />
                    <span className="t-xs">{msg.imageName}</span>
                  </div>
                ) : msg.attachmentStoragePath ? (
                  <div className="chat-image-attachment-unavailable t-xs c-low" role="status">
                    {attachmentErrors[msg.id] ? 'Image unavailable.' : 'Loading image…'}
                  </div>
                ) : (
                  <ArtTile
                    variant={msg.imageVariant ?? 1}
                    style={{
                      height: 150,
                      width: '100%',
                      borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      position: 'relative',
                    }}
                  >
                    <div className="chat-image-name-overlay">
                      <span className="t-xs">{msg.imageName}</span>
                    </div>
                  </ArtTile>
                )}
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
                  {(attachmentUrls[msg.id] ?? msg.attachmentUrl) ? (
                    <a
                      className="chat-file-download"
                      href={attachmentUrls[msg.id] ?? msg.attachmentUrl}
                      download={msg.fileName}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                      onTouchStart={(event) => event.stopPropagation()}
                    >
                      Open or download
                    </a>
                  ) : msg.attachmentStoragePath ? (
                    <span className="t-xs c-low" role="status">
                      {attachmentErrors[msg.id] ? 'Secure download unavailable.' : 'Preparing secure download…'}
                    </span>
                  ) : null}
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
          {lightbox.src ? (
            <img className="chat-lightbox-image" src={lightbox.src} alt={lightbox.name ?? 'Shared image'} />
          ) : (
            <ArtTile variant={lightbox.variant} locked={false} style={{ width: 'min(88vw, 420px)', height: 'min(60vh, 420px)' }} />
          )}
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

      {blockDialogOpen && (
        <div className="account-dialog-backdrop" role="presentation" onClick={() => !blockActionPending && setBlockDialogOpen(false)}>
          <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="block-user-title" onClick={(e) => e.stopPropagation()}>
            <div className="account-dialog-icon"><Icon name="alert" /></div>
            <h2 id="block-user-title">Block {conversation.name}?</h2>
            <p>Neither of you will be able to send messages or start a new conversation while either block is active. Existing message history will remain.</p>
            {blockActionError && <div className="t-xs c-danger" role="alert">{blockActionError}</div>}
            <div className="account-dialog-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBlockDialogOpen(false)} disabled={blockActionPending}>Cancel</button>
              <button type="button" className="btn btn-secondary btn-sm account-danger-button" onClick={() => void handleChangeBlock(true)} disabled={blockActionPending}>
                {blockActionPending ? 'Blocking…' : 'Block User'}
              </button>
            </div>
          </section>
        </div>
      )}

      {toast}
    </ScreenShell>
  );
}
