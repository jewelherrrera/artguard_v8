import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CONVERSATIONS } from '../data/mockData';
import type { ChatMessage, Conversation, PresenceStatus } from '../data/mockData';
import { getAttachmentAutoReply, getAutoReply } from '../utils/autoReply';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  createOrFindConversation,
  type DbMessage,
  getMyConversationResetAt,
  getPublicProfile,
  insertMessage,
  loadConversations,
  loadHiddenConversationState,
  markConversationRead,
  markMessageDelivered,
  relativeTimeLabel,
  resetMyConversation,
  searchProfiles,
  updateMessageReaction,
  type SearchUser,
} from '../lib/supabaseData';

function formatNow(): string {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
const IMAGE_VARIANTS = [1, 2, 3, 4, 5, 6] as const;

interface ChatContextValue {
  conversations: Conversation[];
  getConversation: (id: string) => Conversation | undefined;
  loadConversationById: (id: string) => Promise<Conversation | null>;
  typingConversationId: string | null;
  sendTyping: (conversationId: string, isTyping: boolean) => Promise<void>;
  totalUnread: number;
  sendTextMessage: (conversationId: string, text: string) => Promise<ChatMessage | null>;
  sendImageMessage: (conversationId: string, imageName: string) => Promise<ChatMessage | null>;
  sendFileMessage: (conversationId: string, fileName: string, fileType: string, fileSize: string) => Promise<ChatMessage | null>;
  toggleReaction: (conversationId: string, messageId: string, emoji: string) => void;
  markAsRead: (conversationId: string) => void;
  searchUsers: (term: string) => Promise<SearchUser[]>;
  startConversation: (userId: string) => Promise<string | null>;
  getUserPresence: (user: { id: string; last_seen_at?: string | null }) => { presence: PresenceStatus; label: string };
  refreshConversations: () => Promise<void>;
  hideConversation: (conversationId: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

function presenceLabelFor(presence: PresenceStatus, lastSeen?: string | null) {
  if (presence === 'online') return 'Active now';
  return relativeTimeLabel(lastSeen);
}

function heartbeatSaysOnline(lastSeen?: string | null): boolean {
  return !!lastSeen && (Date.now() - new Date(lastSeen).getTime()) < 90000;
}

type BroadcastMessagePayload = {
  conversation_id: string;
  message: DbMessage;
  sender: {
    id: string;
    name: string;
    avatar_data_url?: string | null;
    last_seen_at?: string | null;
  };
};

type BroadcastReadPayload = {
  conversation_id: string;
  message_ids: string[];
  reader_id: string;
};

type BroadcastTypingPayload = {
  conversation_id: string;
  sender_id: string;
  is_typing: boolean;
};

type BroadcastReactionPayload = {
  conversation_id: string;
  message_id: string;
  reaction: string | null;
  sender_id: string;
};

function mapBroadcastMessage(row: DbMessage, currentUserId: string): ChatMessage {
  return {
    id: row.id,
    from: row.sender_id === currentUserId ? 'me' : 'them',
    kind: row.kind,
    createdAt: row.created_at,
    text: row.text ?? undefined,
    imageName: row.image_name ?? undefined,
    imageVariant: (row.image_variant as 1 | 2 | 3 | 4 | 5 | 6 | null) ?? undefined,
    fileName: row.file_name ?? undefined,
    fileType: row.file_type ?? undefined,
    fileSize: row.file_size ?? undefined,
    time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    status: row.status,
    reaction: row.reaction ?? undefined,
  };
}

function isAfterResetBoundary(message: ChatMessage, resetAt: string | null | undefined): boolean {
  if (!resetAt) return true;
  if (!message.createdAt) return false;
  const createdAt = Date.parse(message.createdAt);
  const boundary = Date.parse(resetAt);
  return Number.isFinite(createdAt) && Number.isFinite(boundary) && createdAt > boundary;
}

function rememberLatestResetAt(resetAtByConversation: Map<string, string | null>, conversationId: string, resetAt: string | null) {
  const current = resetAtByConversation.get(conversationId);
  if (!resetAtByConversation.has(conversationId) || !current) {
    resetAtByConversation.set(conversationId, resetAt);
    return;
  }
  if (resetAt && Date.parse(resetAt) > Date.parse(current)) {
    resetAtByConversation.set(conversationId, resetAt);
  }
}

function sortConversationsByRecentMessage(conversations: Conversation[]): Conversation[] {
  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((a, b) => {
      const aCreatedAt = Date.parse(a.conversation.messages.at(-1)?.createdAt ?? '');
      const bCreatedAt = Date.parse(b.conversation.messages.at(-1)?.createdAt ?? '');
      const aTime = Number.isFinite(aCreatedAt) ? aCreatedAt : 0;
      const bTime = Number.isFinite(bCreatedAt) ? bCreatedAt : 0;
      return bTime - aTime || a.index - b.index;
    })
    .map(({ conversation }) => conversation);
}

function sortMessagesChronologically(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .map((message, index) => ({ message, index, createdAt: Date.parse(message.createdAt ?? '') }))
    .sort((a, b) => {
      if (!Number.isFinite(a.createdAt) || !Number.isFinite(b.createdAt)) return a.index - b.index;
      return a.createdAt - b.createdAt || a.index - b.index;
    })
    .map(({ message }) => message);
}

function withLatestMessage(conversation: Conversation, messages: ChatMessage[]): Conversation {
  const orderedMessages = sortMessagesChronologically(messages);
  const lastMessage = orderedMessages.at(-1);
  return {
    ...conversation,
    messages: orderedMessages,
    dayLabel: lastMessage?.createdAt
      ? new Date(lastMessage.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : lastMessage ? conversation.dayLabel : 'Start a conversation',
    previewTime: lastMessage?.time ?? '',
    unreadCount: orderedMessages.filter((message) => message.from === 'them' && message.status !== 'read').length,
  };
}

function mergeConversationSnapshots(
  current: Conversation[],
  loaded: Array<Conversation & { resetAt: string | null }>,
  hiddenIds: Set<string>,
  resetAtByConversation: ReadonlyMap<string, string | null>,
): Conversation[] {
  const currentById = new Map(current.map((conversation) => [conversation.id, conversation]));
  const loadedIds = new Set(loaded.map((conversation) => conversation.id));
  const pending = current.filter((conversation) =>
    !loadedIds.has(conversation.id)
    && !hiddenIds.has(conversation.id)
    && (conversation.messages.length === 0 || Boolean((conversation as Conversation & { otherUserId?: string }).otherUserId))
  ).map((conversation) => {
    const resetAt = resetAtByConversation.get(conversation.id);
    const messages = conversation.messages.filter((message) => isAfterResetBoundary(message, resetAt));
    return {
      ...conversation,
      messages,
      unreadCount: messages.filter((message) => message.from === 'them' && message.status !== 'read').length,
    };
  });

  const reconciled = loaded.map((conversation) => {
    const resetAt = resetAtByConversation.has(conversation.id)
      ? resetAtByConversation.get(conversation.id)
      : conversation.resetAt;
    const fetchedMessages = conversation.messages.filter((message) => isAfterResetBoundary(message, resetAt));
    const cached = currentById.get(conversation.id);
    const cachedMessages = (cached?.messages ?? []).filter((message) => isAfterResetBoundary(message, resetAt));
    const messagesById = new Map(fetchedMessages.map((message) => [message.id, message]));
    for (const message of cachedMessages) {
      if (!messagesById.has(message.id)) messagesById.set(message.id, message);
    }
    const messages = Array.from(messagesById.values()).sort((a, b) => {
      const aTime = Date.parse(a.createdAt ?? '');
      const bTime = Date.parse(b.createdAt ?? '');
      return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
    });
    return withLatestMessage({ ...cached, ...conversation }, messages);
  });

  return sortConversationsByRecentMessage([...pending, ...reconciled]);
}

async function broadcastToUser(userId: string, event: string, payload: unknown) {
  if (!supabase) return;
  const client = supabase;
  // Every logged-in user listens on their own stable inbox channel. Senders
  // temporarily join the recipient's channel to deliver the persisted message.
  const channel = client.channel(`artguard-chat-${userId}`, {
    config: { broadcast: { self: false } },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          const result = await channel.send({ type: 'broadcast', event, payload });
          if (result === 'ok') finish(resolve);
          else finish(() => reject(new Error(`Broadcast failed: ${result}`)));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          finish(() => reject(new Error(`Broadcast channel status: ${status}`)));
        }
      });
      window.setTimeout(() => finish(resolve), 4000);
    });
  } finally {
    void client.removeChannel(channel);
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const activeUserIdRef = useRef(userId);
  activeUserIdRef.current = userId;
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    isSupabaseConfigured ? [] : CONVERSATIONS.map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m })) })),
  );
  const [typingConversationId, setTypingConversationId] = useState<string | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [hiddenConversationIds, setHiddenConversationIds] = useState<Set<string>>(new Set());
  const [hiddenUnreadCount, setHiddenUnreadCount] = useState(0);
  const conversationsRef = useRef<Conversation[]>(conversations);
  const onlineUserIdsRef = useRef(onlineUserIds);
  const hiddenConversationIdsRef = useRef(hiddenConversationIds);
  const resetAtByConversationRef = useRef(new Map<string, string | null>());
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  useEffect(() => {
    onlineUserIdsRef.current = onlineUserIds;
  }, [onlineUserIds]);
  useEffect(() => {
    hiddenConversationIdsRef.current = hiddenConversationIds;
  }, [hiddenConversationIds]);

  useEffect(() => {
    setConversations(isSupabaseConfigured ? [] : CONVERSATIONS.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message })),
    })));
    setOnlineUserIds(new Set());
    onlineUserIdsRef.current = new Set();
    setHiddenConversationIds(new Set());
    hiddenConversationIdsRef.current = new Set();
    resetAtByConversationRef.current = new Map();
    setHiddenUnreadCount(0);
    setTypingConversationId(null);
    notifiedMessageIdsRef.current.clear();
  }, [userId]);

  const refreshConversations = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !userId) return;
    try {
      const loaded = await loadConversations(userId, onlineUserIdsRef.current);
      if (activeUserIdRef.current !== userId) return;
      for (const conversation of loaded) {
        rememberLatestResetAt(resetAtByConversationRef.current, conversation.id, conversation.resetAt);
      }
      setConversations((prev) => mergeConversationSnapshots(
        prev,
        loaded,
        hiddenConversationIdsRef.current,
        resetAtByConversationRef.current,
      ));
    } catch (error) {
      console.error('ArtGuard: unable to load conversations', error);
      return;
    }
    try {
      const hiddenState = await loadHiddenConversationState(userId);
      if (activeUserIdRef.current !== userId) return;
      for (const [conversationId, resetAt] of Object.entries(hiddenState.resetAtByConversation)) {
        rememberLatestResetAt(resetAtByConversationRef.current, conversationId, resetAt);
      }
      hiddenConversationIdsRef.current = new Set(hiddenState.conversationIds);
      setHiddenConversationIds(new Set(hiddenState.conversationIds));
      setHiddenUnreadCount(hiddenState.unreadCount);
    } catch (error) {
      console.error('ArtGuard: unable to load hidden conversation state', error);
    }
  }, [userId]);

  // Shared realtime presence + last-seen heartbeat.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !userId) return;
    const client = supabase;

    // Register ALL presence callbacks before subscribe(). Keep this channel topic
    // shared between every browser so presence can be observed across users.
    const channel = client.channel('artguard-online-users', {
      config: { presence: { key: userId } },
    });

    const updatePresenceState = () => {
      const state = channel.presenceState();
      if (activeUserIdRef.current !== userId) return;
      const ids = new Set<string>();
      Object.keys(state).forEach((id) => ids.add(id));
      setOnlineUserIds(ids);
    };

    channel
      .on('presence', { event: 'sync' }, updatePresenceState)
      .on('presence', { event: 'join' }, updatePresenceState)
      .on('presence', { event: 'leave' }, updatePresenceState);

    let cancelled = false;
    void channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED' || cancelled) return;
      try {
        await channel.track({ user_id: userId, online_at: new Date().toISOString() });
        updatePresenceState();
      } catch (error) {
        console.error('ArtGuard: presence tracking failed', error);
      }
    });

    const heartbeat = async () => {
      const { error } = await client
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', userId);
      if (error) console.error('ArtGuard: last-seen heartbeat failed', error);
    };
    void heartbeat();
    const interval = window.setInterval(heartbeat, 30000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void heartbeat();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(interval);
      void client
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', userId);
      // Remove the channel directly. Calling track() during cleanup can race with
      // React/Vite remounts and cause callbacks to be registered after subscribe().
      void client.removeChannel(channel);
    };
  }, [userId]);

  // Load conversations and keep them fresh when presence changes.
  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const handleIncomingMessage = useCallback(async (
    row: DbMessage,
    sender?: { id: string; name: string; avatar_data_url?: string | null; last_seen_at?: string | null } | null,
  ) => {
    if (!userId || activeUserIdRef.current !== userId || !row.id || !row.conversation_id || row.sender_id === userId || notifiedMessageIdsRef.current.has(`received:${row.id}`)) return;
    let resetAt = resetAtByConversationRef.current.get(row.conversation_id);
    if (!resetAtByConversationRef.current.has(row.conversation_id)) {
      await refreshConversations();
      if (activeUserIdRef.current !== userId || !resetAtByConversationRef.current.has(row.conversation_id)) return;
      resetAt = resetAtByConversationRef.current.get(row.conversation_id);
    }
    if (resetAt && new Date(row.created_at).getTime() <= new Date(resetAt).getTime()) return;
    notifiedMessageIdsRef.current.add(`received:${row.id}`);
    if (notifiedMessageIdsRef.current.size > 4000) {
      const oldest = notifiedMessageIdsRef.current.values().next().value;
      if (oldest) notifiedMessageIdsRef.current.delete(oldest);
    }

    const resolvedSender = sender ?? await getPublicProfile(row.sender_id).catch(() => null);
    const senderName = resolvedSender?.name ?? 'New message';
    const message = mapBroadcastMessage(row, userId);
    if (!isAfterResetBoundary(message, resetAtByConversationRef.current.get(row.conversation_id))) return;
    if (hiddenConversationIdsRef.current.has(row.conversation_id)) {
      try {
        const reopenedId = await createOrFindConversation(userId, row.sender_id);
        if (activeUserIdRef.current !== userId || reopenedId !== row.conversation_id) return;
        const nextHiddenIds = new Set(hiddenConversationIdsRef.current);
        nextHiddenIds.delete(row.conversation_id);
        hiddenConversationIdsRef.current = nextHiddenIds;
        setHiddenConversationIds(nextHiddenIds);
      } catch (error) {
        console.error('ArtGuard: unable to reopen conversation for incoming message', error);
        return;
      }
    }

    setConversations((prev) => {
      if (!isAfterResetBoundary(message, resetAtByConversationRef.current.get(row.conversation_id))) return prev;
      const existing = prev.find((conversation) => conversation.id === row.conversation_id);
      if (existing?.messages.some((item) => item.id === row.id)) return prev;
      if (!existing) {
        const initials = senderName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
        const presence = onlineUserIdsRef.current.has(row.sender_id) || heartbeatSaysOnline(resolvedSender?.last_seen_at) ? 'online' : 'recent';
        const newConversation: Conversation & { otherUserId: string } = {
          id: row.conversation_id,
          name: senderName,
          initials,
          avatarStyle: resolvedSender?.avatar_data_url
            ? { backgroundImage: `url(${resolvedSender.avatar_data_url})`, backgroundSize: 'cover' }
            : {},
          presence,
          lastSeenLabel: relativeTimeLabel(resolvedSender?.last_seen_at),
          dayLabel: new Date(row.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          previewTime: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          unreadCount: 1,
          messages: [message],
          otherUserId: row.sender_id,
        };
        return sortConversationsByRecentMessage([newConversation, ...prev]);
      }

      const updated = withLatestMessage(existing, [...existing.messages, message]);
      return sortConversationsByRecentMessage(prev.map((conversation) =>
        conversation.id === row.conversation_id ? updated : conversation,
      ));
    });

    const shouldNotify = typeof document === 'undefined'
      || document.visibilityState !== 'visible'
      || !window.location.pathname.endsWith(row.conversation_id);
    if (shouldNotify && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      const body = row.text || (row.kind === 'image' ? 'Sent an image' : row.kind === 'file' ? 'Sent a file' : 'New message');
      new Notification(`${senderName} sent you a message`, { body, tag: `artguard-${row.conversation_id}` });
    }

    void markMessageDelivered(row.id, userId).catch((error) => {
      console.error('ArtGuard: unable to mark message delivered', error);
    });
    void refreshConversations();
  }, [refreshConversations, userId]);

  // Real-time database changes: new messages + message reads/reactions.
  // The payload is used for immediate feedback, while refreshConversations()
  // remains the source of truth for unread counts, previews, and ordering.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !userId) return;
    const client = supabase;

    let notificationListenersAttached = false;
    let notificationRequestHandler: (() => void) | null = null;

    const channel = client
      .channel(`artguard-chat-${userId}`, {
        config: { broadcast: { self: false } },
      })
      .on('broadcast', { event: 'new_message' }, (payload) => {
        const data = payload.payload as BroadcastMessagePayload | undefined;
        if (!data?.message?.id || data.message.sender_id !== data.sender.id) return;
        void handleIncomingMessage(data.message, data.sender);
      })
      .on('broadcast', { event: 'messages_read' }, (payload) => {
        const data = payload.payload as BroadcastReadPayload | undefined;
        if (activeUserIdRef.current !== userId || !data?.conversation_id || data.reader_id === userId) return;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === data.conversation_id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    data.message_ids.includes(m.id) && m.from === 'me' ? { ...m, status: 'read' } : m,
                  ),
                }
              : c,
          ),
        );
      })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const data = payload.payload as BroadcastTypingPayload | undefined;
        if (activeUserIdRef.current !== userId || !data?.conversation_id || data.sender_id === userId) return;
        setTypingConversationId((current) => (data.is_typing ? data.conversation_id : current === data.conversation_id ? null : current));
      })
      .on('broadcast', { event: 'message_reaction' }, (payload) => {
        const data = payload.payload as BroadcastReactionPayload | undefined;
        if (activeUserIdRef.current !== userId || !data?.conversation_id || data.sender_id === userId) return;
        setConversations((prev) => prev.map((c) =>
          c.id === data.conversation_id
            ? { ...c, messages: c.messages.map((m) => m.id === data.message_id ? { ...m, reaction: data.reaction ?? undefined } : m) }
            : c,
        ));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload.new as DbMessage;
        if (activeUserIdRef.current !== userId) return;
        if (row.sender_id === userId) {
          void refreshConversations();
          return;
        }
        void handleIncomingMessage(row);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => {
        void refreshConversations();
      })
      .subscribe(() => {
      // Browser notifications require a user gesture in many browsers. Add a
      // one-time interaction fallback so the first click/keypress inside the
      // app can grant notification permission instead of silently losing it.
      if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'default') return;
      if (notificationListenersAttached || window.localStorage.getItem('artguard-notification-prompted')) return;
      notificationListenersAttached = true;
      const requestFromGesture = () => {
        window.localStorage.setItem('artguard-notification-prompted', '1');
        void Notification.requestPermission();
        window.removeEventListener('pointerdown', requestFromGesture);
        window.removeEventListener('keydown', requestFromGesture);
        notificationRequestHandler = null;
      };
      notificationRequestHandler = requestFromGesture;
      window.addEventListener('pointerdown', requestFromGesture, { once: true });
      window.addEventListener('keydown', requestFromGesture, { once: true });
    });

    return () => {
      if (typeof window !== 'undefined' && notificationRequestHandler) {
        window.removeEventListener('pointerdown', notificationRequestHandler);
        window.removeEventListener('keydown', notificationRequestHandler);
      }
      void client.removeChannel(channel);
    };
  }, [handleIncomingMessage, refreshConversations, userId]);

  const appendLocal = useCallback((conversationId: string, message: ChatMessage) => {
    const resetAt = resetAtByConversationRef.current.get(conversationId);
    if (!isAfterResetBoundary(message, resetAt)) return;
    const conversationExists = conversationsRef.current.some((conversation) => conversation.id === conversationId);
    setConversations((prev) =>
      sortConversationsByRecentMessage(prev.map((conversation) => {
        if (conversation.id !== conversationId || conversation.messages.some((item) => item.id === message.id)) return conversation;
        return withLatestMessage(conversation, [...conversation.messages, message]);
      })),
    );
    if (!conversationExists) void refreshConversations();
  }, [refreshConversations]);

  const patchLocal = useCallback((conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) }
          : c,
      ),
    );
  }, []);

  const broadcastPersistedMessage = useCallback(async (
    conversationId: string,
    saved: ChatMessage,
    senderId: string,
    currentConversations: Conversation[],
  ) => {
    const current = currentConversations.find((c) => c.id === conversationId);
    const otherUserId = current?.otherUserId;
    if (!otherUserId) return;

    try {
      const sender = await getPublicProfile(senderId);
      await broadcastToUser(otherUserId, 'new_message', {
        conversation_id: conversationId,
        message: {
          id: saved.id,
          conversation_id: conversationId,
          sender_id: senderId,
          kind: saved.kind,
          text: saved.text ?? null,
          image_name: saved.imageName ?? null,
          image_variant: saved.imageVariant ?? null,
          file_name: saved.fileName ?? null,
          file_type: saved.fileType ?? null,
          file_size: saved.fileSize ?? null,
          created_at: saved.createdAt ?? new Date().toISOString(),
          status: saved.status ?? 'sent',
          reaction: saved.reaction ?? null,
        } satisfies DbMessage,
        sender: {
          id: senderId,
          name: sender?.name ?? 'New message',
          avatar_data_url: sender?.avatar_data_url ?? null,
          last_seen_at: sender?.last_seen_at ?? null,
        },
      } satisfies BroadcastMessagePayload);
    } catch (error) {
      console.warn('ArtGuard: realtime attachment broadcast failed; DB copy is still saved.', error);
    }
  }, []);

  const runAutoReply = useCallback(
    (conversationId: string, outgoingId: string, replyText: string) => {
      setTimeout(() => patchLocal(conversationId, outgoingId, { status: 'delivered' }), 500);
      setTimeout(() => setTypingConversationId(conversationId), 900);
      setTimeout(() => {
        setTypingConversationId((current) => (current === conversationId ? null : current));
        patchLocal(conversationId, outgoingId, { status: 'read' });
        appendLocal(conversationId, {
          id: nextId('reply'),
          from: 'them',
          kind: 'text',
          text: replyText,
          time: formatNow(),
          status: 'read',
        });
      }, 2200);
    },
    [appendLocal, patchLocal],
  );

  const sendTyping = useCallback(async (conversationId: string, isTyping: boolean) => {
    if (!isSupabaseConfigured || !supabase || !userId) return;
    const current = conversationsRef.current.find((c) => c.id === conversationId);
    const otherUserId = current?.otherUserId;
    if (!otherUserId) return;
    try {
      await broadcastToUser(otherUserId, 'typing', {
        conversation_id: conversationId,
        sender_id: userId,
        is_typing: isTyping,
      } satisfies BroadcastTypingPayload);
    } catch (error) {
      console.warn('ArtGuard: typing broadcast failed', error);
    }
  }, [userId]);

  const sendTextMessage = useCallback(async (conversationId: string, text: string): Promise<ChatMessage | null> => {
    const trimmed = text.trim();
    if (!trimmed) return null;

    if (isSupabaseConfigured && supabase && user) {
      try {
        const saved = await insertMessage(conversationId, user.id, crypto.randomUUID(), { kind: 'text', text: trimmed });
        // IMPORTANT: append the server response immediately. Do not wait for
        // Realtime, otherwise the sender sees an apparently broken composer.
        appendLocal(conversationId, saved);

        await broadcastPersistedMessage(conversationId, saved, user.id, conversations);
        return saved;
      } catch (error) {
        console.error('ArtGuard: send message failed', error);
        return null;
      }
    }

    const id = nextId('msg');
    const message: ChatMessage = { id, from: 'me', kind: 'text', text: trimmed, time: formatNow(), status: 'sent' };
    appendLocal(conversationId, message);
    runAutoReply(conversationId, id, getAutoReply(trimmed));
    return message;
  }, [appendLocal, broadcastPersistedMessage, conversations, runAutoReply, user]);

  const sendImageMessage = useCallback(async (conversationId: string, imageName: string): Promise<ChatMessage | null> => {
    const imageVariant = IMAGE_VARIANTS[Math.floor(Math.random() * IMAGE_VARIANTS.length)];
    if (isSupabaseConfigured && supabase && user) {
      try {
        const saved = await insertMessage(conversationId, user.id, crypto.randomUUID(), { kind: 'image', imageName, imageVariant });
        appendLocal(conversationId, saved);
        await broadcastPersistedMessage(conversationId, saved, user.id, conversations);
        return saved;
      } catch (error) {
        console.error('ArtGuard: image message failed', error);
        return null;
      }
    }
    const id = nextId('img');
    const message: ChatMessage = { id, from: 'me', kind: 'image', imageName, imageVariant, time: formatNow(), status: 'sent' };
    appendLocal(conversationId, message);
    runAutoReply(conversationId, id, getAttachmentAutoReply());
    return message;
  }, [appendLocal, broadcastPersistedMessage, conversations, runAutoReply, user]);

  const sendFileMessage = useCallback(async (conversationId: string, fileName: string, fileType: string, fileSize: string): Promise<ChatMessage | null> => {
    if (isSupabaseConfigured && supabase && user) {
      try {
        const saved = await insertMessage(conversationId, user.id, crypto.randomUUID(), { kind: 'file', fileName, fileType, fileSize });
        appendLocal(conversationId, saved);
        await broadcastPersistedMessage(conversationId, saved, user.id, conversations);
        return saved;
      } catch (error) {
        console.error('ArtGuard: file message failed', error);
        return null;
      }
    }
    const id = nextId('file');
    const message: ChatMessage = { id, from: 'me', kind: 'file', fileName, fileType, fileSize, time: formatNow(), status: 'sent' };
    appendLocal(conversationId, message);
    runAutoReply(conversationId, id, getAttachmentAutoReply());
    return message;
  }, [appendLocal, broadcastPersistedMessage, conversations, runAutoReply, user]);

  const toggleReaction = useCallback(async (conversationId: string, messageId: string, emoji: string) => {
    const conversation = conversations.find((c) => c.id === conversationId);
    const target = conversation?.messages.find((m) => m.id === messageId);
    const nextReaction = target?.reaction === emoji ? null : emoji;

    // Update the current browser immediately, then persist and broadcast.
    setConversations((prev) => prev.map((c) => c.id === conversationId
      ? { ...c, messages: c.messages.map((m) => m.id === messageId ? { ...m, reaction: nextReaction ?? undefined } : m) }
      : c));

    if (isSupabaseConfigured && supabase && user) {
      try {
        await updateMessageReaction(messageId, nextReaction);
        const otherUserId = conversation?.otherUserId;
        if (otherUserId) {
          await broadcastToUser(otherUserId, 'message_reaction', {
            conversation_id: conversationId,
            message_id: messageId,
            reaction: nextReaction,
            sender_id: user.id,
          } satisfies BroadcastReactionPayload);
        }
      } catch (error) {
        console.error('ArtGuard: reaction update failed', error);
        // Refresh authoritative DB state if the update failed.
        void refreshConversations();
      }
    }
  }, [conversations, refreshConversations, user]);

  const markAsRead = useCallback(async (conversationId: string) => {
    if (isSupabaseConfigured && supabase && userId) {
      const current = conversationsRef.current.find((conversation) => conversation.id === conversationId);
      try {
        const idsToMarkRead = await markConversationRead(conversationId, userId);
        setConversations((prev) => prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                messages: c.messages.map((message) => idsToMarkRead.includes(message.id) ? { ...message, status: 'read' } : message),
                unreadCount: c.messages.filter((message) => message.from === 'them'
                  && message.status !== 'read'
                  && !idsToMarkRead.includes(message.id)).length,
              }
            : c,
        ));

        const otherUserId = current?.otherUserId;
        if (otherUserId && idsToMarkRead.length) {
          try {
            await broadcastToUser(otherUserId, 'messages_read', {
              conversation_id: conversationId,
              message_ids: idsToMarkRead,
              reader_id: userId,
            } satisfies BroadcastReadPayload);
          } catch (error) {
            console.warn('ArtGuard: read receipt broadcast failed', error);
          }
        }
        return;
      } catch (error) {
        console.error('ArtGuard: mark read failed', error);
        return;
      }
    }
    setConversations((prev) => prev.map((conversation) => conversation.id === conversationId && conversation.unreadCount > 0
      ? { ...conversation, unreadCount: 0, messages: conversation.messages.map((message) => message.from === 'them' ? { ...message, status: 'read' } : message) }
      : conversation));
  }, [userId]);

  const hideConversation = useCallback(async (conversationId: string) => {
    if (!isSupabaseConfigured || !supabase || !userId) {
      setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
      return;
    }
    const resetAt = await resetMyConversation(conversationId);
    if (activeUserIdRef.current !== userId) return;
    rememberLatestResetAt(resetAtByConversationRef.current, conversationId, resetAt);

    const hiddenConversation = conversationsRef.current.find((conversation) => conversation.id === conversationId);
    const nextHiddenIds = new Set(hiddenConversationIdsRef.current).add(conversationId);
    hiddenConversationIdsRef.current = nextHiddenIds;
    setHiddenConversationIds(nextHiddenIds);
    if (hiddenConversation) setHiddenUnreadCount((count) => count + hiddenConversation.unreadCount);
    setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
    void refreshConversations();
  }, [refreshConversations, userId]);

  const searchUsers = useCallback(async (term: string) => {
    if (!isSupabaseConfigured || !user) return [];
    try {
      const found = await searchProfiles(term, user.id);
      return found.map((p) => {
        const heartbeatRecent = heartbeatSaysOnline(p.last_seen_at);
        return { ...p, is_online: onlineUserIds.has(p.id) || heartbeatRecent };
      });
    } catch (error) {
      console.error('ArtGuard: user search failed', error);
      return [];
    }
  }, [onlineUserIds, user]);

  const startConversation = useCallback(async (otherUserId: string) => {
    if (!isSupabaseConfigured || !userId) return null;
    try {
      const id = await createOrFindConversation(userId, otherUserId);
      if (activeUserIdRef.current !== userId) return null;
      const resetAt = await getMyConversationResetAt(userId, id);
      if (activeUserIdRef.current !== userId) return null;
      rememberLatestResetAt(resetAtByConversationRef.current, id, resetAt);
      const nextHiddenIds = new Set(hiddenConversationIdsRef.current);
      nextHiddenIds.delete(id);
      hiddenConversationIdsRef.current = nextHiddenIds;
      setHiddenConversationIds(nextHiddenIds);

      // Build the thread immediately from the selected real profile. This makes
      // a brand-new, zero-message conversation visible before the inbox refresh
      // finishes, so the UI never has a moment where the route has no thread.
      const other = await getPublicProfile(otherUserId);
      if (other) {
        const optimistic: Conversation = {
          id,
          name: other.name,
          initials: other.name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? '')
            .join(''),
          avatarStyle: other.avatar_data_url
            ? { backgroundImage: `url(${other.avatar_data_url})`, backgroundSize: 'cover' }
            : {},
          presence: onlineUserIds.has(other.id) || heartbeatSaysOnline(other.last_seen_at) ? 'online' : 'recent',
          lastSeenLabel: relativeTimeLabel(other.last_seen_at),
          dayLabel: 'Start a conversation',
          previewTime: '',
          unreadCount: 0,
          messages: [],
          otherUserId: other.id,
        } as Conversation & { otherUserId: string };

        setConversations((prev) => {
          const existing = prev.find((c) => c.id === id);
          if (existing) return prev.map((c) => (c.id === id ? { ...existing, ...optimistic, messages: existing.messages } : c));
          return [optimistic, ...prev];
        });
      }

      // Refresh in the background so the inbox gets the authoritative DB state.
      void refreshConversations();
      return id;
    } catch (error) {
      console.error('ArtGuard: create conversation failed', error);
      return null;
    }
  }, [onlineUserIds, refreshConversations, userId]);

  const getUserPresence = useCallback((profile: { id: string; last_seen_at?: string | null }) => {
    const presence: PresenceStatus = onlineUserIds.has(profile.id) || heartbeatSaysOnline(profile.last_seen_at) ? 'online' : 'recent';
    return { presence, label: presenceLabelFor(presence, profile.last_seen_at) };
  }, [onlineUserIds]);

  // The inbox -> conversation navigation can happen before React has committed the
  // refreshed conversation list. Fetch the requested conversation on demand so a
  // brand-new, empty real-user conversation never redirects back to /chat.
  const loadConversationById = useCallback(async (id: string): Promise<Conversation | null> => {
    const existing = conversations.find((c) => c.id === id);
    if (existing) return existing;
    if (!isSupabaseConfigured || !supabase || !userId) return null;

    try {
      const loaded = await loadConversations(userId, onlineUserIdsRef.current);
      if (activeUserIdRef.current !== userId) return null;
      for (const conversation of loaded) {
        rememberLatestResetAt(resetAtByConversationRef.current, conversation.id, conversation.resetAt);
      }
      const merged = mergeConversationSnapshots(
        conversations,
        loaded,
        hiddenConversationIdsRef.current,
        resetAtByConversationRef.current,
      );
      setConversations(merged);
      return merged.find((conversation) => conversation.id === id) ?? null;
    } catch (error) {
      console.error('ArtGuard: unable to load requested conversation', error);
      return null;
    }
  }, [conversations, userId]);

  const getConversation = useCallback((id: string) => conversations.find((c) => c.id === id), [conversations]);
  const totalUnread = useMemo(
    () => conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0) + hiddenUnreadCount,
    [conversations, hiddenUnreadCount],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const baseTitle = 'ArtGuard Hub';
    document.title = totalUnread > 0 ? `(${totalUnread}) ${baseTitle}` : baseTitle;
    return () => {
      document.title = baseTitle;
    };
  }, [totalUnread]);

  const value = useMemo<ChatContextValue>(() => ({
    conversations, getConversation, loadConversationById, typingConversationId, totalUnread,
    sendTyping, sendTextMessage, sendImageMessage, sendFileMessage, toggleReaction, markAsRead,
    searchUsers, startConversation, getUserPresence, refreshConversations, hideConversation,
  }), [conversations, getConversation, typingConversationId, totalUnread, sendTyping, sendTextMessage, sendImageMessage, sendFileMessage, toggleReaction, markAsRead, searchUsers, startConversation, getUserPresence, refreshConversations, hideConversation]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within an AuthProvider');
  return ctx;
}
