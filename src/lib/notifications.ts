import { supabase } from './supabase';

export type NotificationType =
  | 'message'
  | 'commission'
  | 'revision'
  | 'artwork'
  | 'artwork_like'
  | 'artwork_comment'
  | 'verification'
  | 'review'
  | 'payment'
  | 'marketplace'
  | 'account'
  | 'security';

export interface NotificationRecord {
  id: string;
  recipient_id: string;
  notification_type: NotificationType | string;
  title: string;
  message: string;
  is_read: boolean;
  related_id: string | null;
  related_route: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_avatar_data_url?: string | null;
  dedupe_key?: string | null;
  created_at: string;
}

export interface CreateNotificationInput {
  recipientId: string;
  notificationType: NotificationType;
  title: string;
  message: string;
  relatedId?: string;
  relatedRoute?: string;
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function createNotification(input: CreateNotificationInput): Promise<NotificationRecord> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('notifications')
    .insert({
      recipient_id: input.recipientId,
      notification_type: input.notificationType,
      title: input.title,
      message: input.message,
      related_id: input.relatedId ?? null,
      related_route: input.relatedRoute ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as NotificationRecord;
}

export async function getMyNotifications(recipientId: string): Promise<NotificationRecord[]> {
  if (!supabase || !recipientId) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', recipientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as NotificationRecord[];
}

export async function getMyUnreadNotificationCount(recipientId: string): Promise<number> {
  if (!supabase || !recipientId) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', recipientId)
    .eq('is_read', false);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationAsRead(notificationId: string, recipientId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('recipient_id', recipientId);
  if (error) throw error;
}

export async function markAllNotificationsAsRead(recipientId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', recipientId)
    .eq('is_read', false);
  if (error) throw error;
}

export async function clearMyNotifications(): Promise<void> {
  const { error } = await requireSupabase().rpc('clear_my_notifications');
  if (error) throw error;
}
