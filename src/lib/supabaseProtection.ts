import { supabase } from './supabase';

export interface ProtectionSettings {
  id: string;
  artwork_id: string;
  owner_id: string;
  dynamic_cloaking: boolean;
  canvas_tiling: boolean;
  right_click_shield: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProtectionEvent {
  id: string;
  artwork_id: string;
  owner_id: string;
  event_type: string;
  event_details: Record<string, unknown>;
  created_at: string;
}

export interface ProtectionScanHealth {
  completed: number;
  failed: number;
}

export type ProtectionSettingsUpdate = Pick<
  ProtectionSettings,
  'dynamic_cloaking' | 'canvas_tiling' | 'right_click_shield'
>;

export async function recordProtectionEvent(
  artworkId: string,
  ownerId: string,
  eventType: string,
  eventDetails: Record<string, unknown> = {},
): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured. Run the protection migration first.');
  const { error } = await supabase.from('protection_events').insert({
    artwork_id: artworkId,
    owner_id: ownerId,
    event_type: eventType,
    event_details: eventDetails,
  });
  if (error) throw error;
}

export async function listMyProtectionSettings(
  ownerId: string,
  artworkIds: string[],
): Promise<ProtectionSettings[]> {
  if (!supabase || !ownerId || artworkIds.length === 0) return [];
  const { data, error } = await supabase
    .from('artwork_protection_settings')
    .select('*')
    .eq('owner_id', ownerId)
    .in('artwork_id', artworkIds);
  if (error) throw error;
  return (data ?? []) as ProtectionSettings[];
}

export async function saveProtectionSettings(
  artworkId: string,
  ownerId: string,
  settings: ProtectionSettingsUpdate,
): Promise<ProtectionSettings> {
  if (!supabase) throw new Error('Supabase is not configured. Run the protection migration first.');
  const { data, error } = await supabase
    .from('artwork_protection_settings')
    .upsert({ artwork_id: artworkId, owner_id: ownerId, ...settings }, { onConflict: 'artwork_id' })
    .select('*')
    .single();
  if (error) throw error;

  const { error: eventError } = await supabase.from('protection_events').insert({
    artwork_id: artworkId,
    owner_id: ownerId,
    event_type: 'settings_updated',
    event_details: settings,
  });
  if (eventError) throw eventError;
  return data as ProtectionSettings;
}

export async function listMyProtectionEvents(ownerId: string, limit = 10): Promise<ProtectionEvent[]> {
  if (!supabase || !ownerId) return [];
  const { data, error } = await supabase
    .from('protection_events')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ProtectionEvent[];
}

export async function countBlockedProtectionEventsToday(ownerId: string): Promise<number> {
  if (!supabase || !ownerId) return 0;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('protection_events')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('event_type', 'blocked')
    .gte('created_at', startOfToday.toISOString());
  if (error) throw error;
  return count ?? 0;
}

export async function countMyReadyProtectedWorks(ownerId: string): Promise<number> {
  if (!supabase || !ownerId) return 0;
  const { count, error } = await supabase
    .from('artworks')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('status', 'ready')
    .not('protected_storage_path', 'is', null);
  if (error) throw error;
  return count ?? 0;
}

export async function getProtectionScanHealth(ownerId: string): Promise<ProtectionScanHealth> {
  if (!supabase || !ownerId) return { completed: 0, failed: 0 };
  const [completedResult, failedResult] = await Promise.all([
    supabase
      .from('protection_events')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', ownerId)
      .eq('event_type', 'protection_processing_completed'),
    supabase
      .from('protection_events')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', ownerId)
      .eq('event_type', 'protection_processing_failed'),
  ]);
  if (completedResult.error) throw completedResult.error;
  if (failedResult.error) throw failedResult.error;
  return { completed: completedResult.count ?? 0, failed: failedResult.count ?? 0 };
}