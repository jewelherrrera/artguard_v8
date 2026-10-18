import type { ArtistVerificationStatus, UserRole } from '../types/auth';
import type { ChatMessage, Conversation, MessageStatus, PresenceStatus } from '../data/mockData';
import { supabase } from './supabase';

export interface PublicProfile {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  bio?: string | null;
  interests?: string[] | null;
  avatar_data_url?: string | null;
  is_pro?: boolean | null;
  accepting_commissions?: boolean | null;
  onboarded?: boolean | null;
  last_seen_at?: string | null;
  artist_verification_status?: ArtistVerificationStatus | null;
  artist_verification_submitted_at?: string | null;
  artist_verification_reviewed_at?: string | null;
  artist_verification_reviewed_by?: string | null;
  artist_verification_rejection_reason?: string | null;
  artist_verification_artwork_id?: string | null;
  is_admin?: boolean | null;
}

export interface PendingArtistVerification {
  artist_id: string;
  artist_name: string;
  username: string;
  bio: string | null;
  interests: string[];
  artist_verification_status: 'pending';
  artist_verification_submitted_at: string | null;
  artist_verification_artwork_id: string | null;
  artwork_references: Array<{
    id: string;
    title: string;
    original_filename: string;
    status: string;
    protected_storage_path: string | null;
    is_verification_sample: boolean;
    created_at: string;
  }>;
}

export function usernameFromEmail(email?: string | null): string {
  const local = (email ?? '').split('@')[0]?.trim().toLowerCase() ?? '';
  const cleaned = local.replace(/[^a-z0-9._-]+/g, '').replace(/^[@._-]+|[@._-]+$/g, '');
  return cleaned || 'user';
}

export interface SearchUser extends PublicProfile {
  is_online: boolean;
}

export interface DbMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: 'text' | 'image' | 'file' | 'artwork' | 'revision';
  text: string | null;
  image_name: string | null;
  image_variant: number | null;
  file_name: string | null;
  file_type: string | null;
  file_size: string | null;
  attachment_storage_path: string | null;
  attachment_mime_type: string | null;
  attachment_size_bytes: number | string | null;
  artwork_id: string | null;
  created_at: string;
  status: MessageStatus;
  reaction: string | null;
}

export interface DbConversation {
  id: string;
  updated_at: string;
  participant_ids: string[];
}

export type LoadedConversation = Conversation & {
  otherUserId: string;
  resetAt: string | null;
  notificationsMuted: boolean;
};

export interface ChatBlockState {
  blockedByMe: boolean;
  messagingUnavailable: boolean;
}

export function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function relativeTimeLabel(iso?: string | null): string {
  if (!iso) return 'Offline';
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Active just now';
  if (minutes < 60) return `Active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Active yesterday';
  return `Active ${days}d ago`;
}

function mapMessage(row: DbMessage, currentUserId: string): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    from: row.sender_id === currentUserId ? 'me' : 'them',
    kind: row.kind,
    createdAt: row.created_at,
    text: row.text ?? undefined,
    imageName: row.image_name ?? undefined,
    imageVariant: (row.image_variant as 1 | 2 | 3 | 4 | 5 | 6 | null) ?? undefined,
    fileName: row.file_name ?? undefined,
    fileType: row.file_type ?? undefined,
    fileSize: row.file_size ?? undefined,
    attachmentStoragePath: row.attachment_storage_path ?? undefined,
    attachmentMimeType: row.attachment_mime_type ?? undefined,
    attachmentSizeBytes: row.attachment_size_bytes === null ? undefined : Number(row.attachment_size_bytes),
    artworkId: row.artwork_id ?? undefined,
    time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    status: row.status,
    reaction: row.reaction ?? undefined,
  };
}

function presenceFor(other: PublicProfile | undefined, online: boolean): { presence: PresenceStatus; lastSeenLabel?: string } {
  const heartbeatRecent = !!other?.last_seen_at && (Date.now() - new Date(other.last_seen_at).getTime()) < 90000;
  if (online || heartbeatRecent) return { presence: 'online' };
  const label = relativeTimeLabel(other?.last_seen_at);
  return { presence: 'recent', lastSeenLabel: label };
}


export async function ensureMyProfile(profile: {
  id: string;
  name: string;
  username?: string;
  role: UserRole;
  onboarded?: boolean;
}): Promise<PublicProfile | null> {
  if (!supabase) return null;
  const { data: existing, error: lookupError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', profile.id)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing as PublicProfile;

  const { data, error } = await supabase
    .from('profiles')
    .insert({
      id: profile.id,
      name: profile.name,
      username: profile.username ?? 'user',
      role: profile.role,
      onboarded: profile.onboarded ?? false,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as PublicProfile;
}

export async function getPublicProfile(userId: string): Promise<PublicProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,username,role,bio,interests,avatar_data_url,is_pro,accepting_commissions,onboarded,last_seen_at,artist_verification_status')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as PublicProfile | null;
}

export async function getMyProfile(userId: string): Promise<PublicProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data as PublicProfile | null;
}

export async function submitArtistVerification(
  displayName: string,
  introduction: string,
  interests: string[],
  artworkId: string,
): Promise<PublicProfile> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('submit_artist_verification', {
    p_display_name: displayName,
    p_introduction: introduction,
    p_interests: interests,
    p_artwork_id: artworkId,
  });
  if (error) throw error;
  return data as PublicProfile;
}

export async function listPendingArtistVerifications(): Promise<PendingArtistVerification[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('list_pending_artist_verifications');
  if (error) throw error;
  if (import.meta.env.DEV) {
    console.debug('ArtGuard admin verification artwork paths:', (data ?? []).flatMap((application: PendingArtistVerification) =>
      application.artwork_references.map((artwork) => ({
        artworkId: artwork.id,
        status: artwork.status,
        protectedStoragePath: artwork.protected_storage_path,
      }))
    ));
  }
  return (data ?? []) as PendingArtistVerification[];
}

export async function approveArtistVerification(artistId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('approve_artist_verification', { p_artist_id: artistId });
  if (error) throw error;
}

export async function rejectArtistVerification(artistId: string, rejectionReason: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('reject_artist_verification', {
    p_artist_id: artistId,
    p_rejection_reason: rejectionReason,
  });
  if (error) throw error;
}

export async function searchProfiles(term: string, currentUserId: string): Promise<SearchUser[]> {
  if (!supabase) return [];
  const clean = term.trim();
  if (clean.length < 2) return [];
  const safe = clean.replace(/[%_]/g, '\\$&');
  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,username,role,bio,interests,avatar_data_url,is_pro,accepting_commissions,onboarded,last_seen_at,artist_verification_status')
    .neq('id', currentUserId)
    .or(`name.ilike.%${safe}%,username.ilike.%${safe}%`)
    .order('name')
    .limit(12);
  if (error) throw error;
  return ((data ?? []) as PublicProfile[]).map((p) => ({ ...p, is_online: false }));
}

/**
 * Real registered artist accounts only (profiles.role = 'artist') — used
 * by the "Start a Commission" flow so a client can only pick a real
 * account, never a mock/demo artist id.
 */
export async function listArtistProfiles(currentUserId: string): Promise<PublicProfile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,username,role,bio,interests,avatar_data_url,is_pro,accepting_commissions,onboarded,last_seen_at,artist_verification_status')
    .eq('role', 'artist')
    .neq('id', currentUserId)
    .order('name')
    .limit(30);
  if (error) throw error;
  return (data ?? []) as PublicProfile[];
}

export async function createOrFindConversation(_currentUserId: string, otherUserId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('get_or_create_conversation', {
    p_other_user_id: otherUserId,
  });
  if (error) throw error;
  return String(data);
}

export async function resolveConversationForSend(conversationId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('resolve_conversation_for_send', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('The conversation could not be resolved for sending.');
  return data;
}

export async function setMyConversationMuted(conversationId: string, muted: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('set_my_conversation_muted', {
    p_conversation_id: conversationId,
    p_muted: muted,
  });
  if (error) throw error;
  if (data !== muted) throw new Error('The notification preference was not saved.');
}

export async function getMyConversationMutedState(conversationId: string, currentUserId: string): Promise<boolean> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('conversation_notification_preferences')
    .select('notifications_muted')
    .eq('conversation_id', conversationId)
    .eq('user_id', currentUserId)
    .maybeSingle();
  if (error) throw error;
  return data?.notifications_muted === true;
}

export async function getMyChatBlockState(otherUserId: string): Promise<ChatBlockState> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('get_my_chat_block_state', {
    p_other_user_id: otherUserId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.blocked_by_me !== 'boolean' || typeof row.messaging_unavailable !== 'boolean') {
    throw new Error('The messaging restrictions could not be verified.');
  }
  return { blockedByMe: row.blocked_by_me, messagingUnavailable: row.messaging_unavailable };
}

export async function setMyChatBlocked(otherUserId: string, blocked: boolean): Promise<ChatBlockState> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('set_my_chat_block', {
    p_other_user_id: otherUserId,
    p_blocked: blocked,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.blocked_by_me !== 'boolean' || typeof row.messaging_unavailable !== 'boolean') {
    throw new Error('The block setting could not be confirmed.');
  }
  return { blockedByMe: row.blocked_by_me, messagingUnavailable: row.messaging_unavailable };
}

export async function getMyConversationResetAt(currentUserId: string, conversationId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('conversation_participants')
    .select('reset_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', currentUserId)
    .maybeSingle();
  if (error) throw error;
  return (data?.reset_at as string | null | undefined) ?? null;
}

export async function resetMyConversation(conversationId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('hide_conversation', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('The conversation reset did not return a boundary.');
  return data;
}

export async function loadConversations(
  currentUserId: string,
  onlineUserIds: Set<string>,
): Promise<LoadedConversation[]> {
  if (!supabase) return [];

  const { data: memberships, error: membershipsError } = await supabase
    .from('conversation_participants')
    .select('conversation_id,reset_at,conversations!inner(superseded_by)')
    .eq('user_id', currentUserId)
    .is('hidden_at', null);

  if (membershipsError) throw membershipsError;

  const canonicalMemberships = (memberships ?? []).filter((row) => {
    const conversation = row.conversations as { superseded_by?: string | null } | null;
    return !conversation?.superseded_by;
  });
  const conversationIds = canonicalMemberships.map((row) => row.conversation_id);
  if (!conversationIds.length) return [];
  const resetAtByConversation = new Map(
    canonicalMemberships.map((row) => [row.conversation_id, row.reset_at as string | null]),
  );

  const { data: preferenceRows, error: preferencesError } = await supabase
    .from('conversation_notification_preferences')
    .select('conversation_id,notifications_muted')
    .eq('user_id', currentUserId)
    .in('conversation_id', conversationIds);
  if (preferencesError) throw preferencesError;
  const mutedConversationIds = new Set(
    (preferenceRows ?? [])
      .filter((row) => row.notifications_muted)
      .map((row) => row.conversation_id as string),
  );

  const { data: participantRows, error: participantsError } = await supabase
    .from('conversation_participants')
    .select('conversation_id,user_id')
    .in('conversation_id', conversationIds);

  if (participantsError) throw participantsError;

  const otherUserIds = Array.from(
    new Set(
      ((participantRows ?? []) as { conversation_id: string; user_id: string }[])
        .map((row) => row.user_id)
        .filter((id) => id !== currentUserId),
    ),
  );

  const { data: profileRows, error: profilesError } = otherUserIds.length
    ? await supabase
        .from('profiles')
        .select('id,name,username,role,bio,interests,avatar_data_url,is_pro,onboarded,last_seen_at')
        .in('id', otherUserIds)
    : { data: [], error: null };

  if (profilesError) throw profilesError;

  const profileById = new Map<string, PublicProfile>();
  for (const profile of (profileRows ?? []) as PublicProfile[]) {
    profileById.set(profile.id, profile);
  }

  const profileByConversation = new Map<string, PublicProfile>();
  for (const row of (participantRows ?? []) as { conversation_id: string; user_id: string }[]) {
    if (row.user_id !== currentUserId) {
      const profile = profileById.get(row.user_id);
      if (profile) profileByConversation.set(row.conversation_id, profile);
    }
  }

  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('*')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: true });

  if (messagesError) throw messagesError;

  const messagesByConversation = new Map<string, DbMessage[]>();
  for (const row of (messages ?? []) as DbMessage[]) {
    const list = messagesByConversation.get(row.conversation_id) ?? [];
    list.push(row);
    messagesByConversation.set(row.conversation_id, list);
  }

  const loaded = conversationIds
    .map((id) => {
      const other = profileByConversation.get(id);
      const msgs = messagesByConversation.get(id) ?? [];
      if (!other) return null;
      const last = msgs[msgs.length - 1];
      const mapped = msgs.map((m) => mapMessage(m, currentUserId));
      const unreadCount = msgs.filter((m) => m.sender_id !== currentUserId && m.status !== 'read').length;
      const presence = presenceFor(other, onlineUserIds.has(other.id));

      return {
        id,
        name: other.name,
        initials: initialsFor(other.name),
        avatarStyle: other.avatar_data_url ? { backgroundImage: `url(${other.avatar_data_url})`, backgroundSize: 'cover' } : {},
        avatarDataUrl: other.avatar_data_url,
        presence: presence.presence,
        lastSeenLabel: presence.lastSeenLabel,
        dayLabel: last ? new Date(last.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Start a conversation',
        previewTime: last ? new Date(last.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
        unreadCount,
        messages: mapped,
        otherUserId: other.id,
        notificationsMuted: mutedConversationIds.has(id),
        resetAt: resetAtByConversation.get(id) ?? null,
      } as LoadedConversation;
    })
    .filter(Boolean) as LoadedConversation[];

  return loaded;
}

export async function loadHiddenConversationState(currentUserId: string): Promise<{
  conversationIds: string[];
  unreadCount: number;
  resetAtByConversation: Record<string, string | null>;
}> {
  if (!supabase) return { conversationIds: [], unreadCount: 0, resetAtByConversation: {} };
  const { data: memberships, error: membershipsError } = await supabase
    .from('conversation_participants')
    .select('conversation_id,reset_at,conversations!inner(superseded_by)')
    .eq('user_id', currentUserId)
    .not('hidden_at', 'is', null);
  if (membershipsError) throw membershipsError;

  const canonicalMemberships = (memberships ?? []).filter((row) => {
    const conversation = row.conversations as { superseded_by?: string | null } | null;
    return !conversation?.superseded_by;
  });
  const conversationIds = Array.from(new Set(canonicalMemberships.map((row) => row.conversation_id)));
  const resetAtByConversation = Object.fromEntries(
    canonicalMemberships.map((row) => [row.conversation_id, (row.reset_at as string | null | undefined) ?? null]),
  );
  if (conversationIds.length === 0) return { conversationIds, unreadCount: 0, resetAtByConversation };

  const { data: unreadMessages, error: messagesError } = await supabase
    .from('messages')
    .select('id')
    .in('conversation_id', conversationIds)
    .neq('sender_id', currentUserId)
    .neq('status', 'read');
  if (messagesError) throw messagesError;
  return { conversationIds, unreadCount: unreadMessages?.length ?? 0, resetAtByConversation };
}

export async function markConversationRead(conversationId: string, _currentUserId: string): Promise<string[]> {
  if (!supabase) return [];
  // Security-definer RPC keeps read receipts reliable on older projects with
  // stricter/legacy RLS policies, and returns the exact message IDs that changed.
  const { data, error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data.map(String) : [];
}

export async function markMessageDelivered(messageId: string, _currentUserId: string) {
  if (!supabase) return;
  const { error } = await supabase.rpc('mark_message_delivered', { p_message_id: messageId });
  if (error) throw error;
}

export async function insertMessage(
  conversationId: string,
  currentUserId: string,
  clientMessageId: string,
  message: {
    kind: 'text' | 'image' | 'file' | 'artwork' | 'revision';
    text?: string;
    imageName?: string;
    imageVariant?: number;
    fileName?: string;
    fileType?: string;
    fileSize?: string;
    attachmentStoragePath?: string;
    attachmentMimeType?: string;
    attachmentSizeBytes?: number;
    artworkId?: string;
  },
): Promise<ChatMessage> {
  if (!supabase) throw new Error('Supabase is not configured.');

  // Use a server-side RPC instead of a raw table insert. This keeps sending
  // reliable on existing projects where RLS policies differ from the original
  // schema, while the function itself verifies that the current user belongs
  // to the conversation.
  const { data, error } = await supabase.rpc('send_message', {
    p_conversation_id: conversationId,
    p_client_message_id: clientMessageId,
    p_kind: message.kind,
    p_text: message.text ?? null,
    p_image_name: message.imageName ?? null,
    p_image_variant: message.imageVariant ?? null,
    p_file_name: message.fileName ?? null,
    p_file_type: message.fileType ?? null,
    p_file_size: message.fileSize ?? null,
    p_attachment_storage_path: message.attachmentStoragePath ?? null,
    p_attachment_mime_type: message.attachmentMimeType ?? null,
    p_attachment_size_bytes: message.attachmentSizeBytes ?? null,
    p_artwork_id: message.artworkId ?? null,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Message was not returned by Supabase.');
  return mapMessage(row as DbMessage, currentUserId);
}

export async function updateMessageReaction(messageId: string, emoji: string | null) {
  if (!supabase) return;
  const { error } = await supabase.rpc('update_message_reaction', {
    p_message_id: messageId,
    p_reaction: emoji ?? '',
  });
  if (error) throw error;
}
