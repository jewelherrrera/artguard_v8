import { supabase } from './supabase';

export interface ArtistCommissionService {
  id: string;
  artist_id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  turnaround_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceArtistServiceFeedItem {
  id: string;
  artist_id: string;
  artist_name: string;
  artist_username: string | null;
  artist_avatar_data_url: string | null;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  turnaround_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function createArtistCommissionService(input: {
  name: string;
  description: string;
  price: number;
  currency: string;
  turnaroundDays: number;
}): Promise<Pick<ArtistCommissionService, 'id' | 'name' | 'price' | 'currency' | 'turnaround_days' | 'is_active'>> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('create_artist_commission_service', {
    p_name: input.name,
    p_description: input.description,
    p_price: input.price,
    p_currency: input.currency,
    p_turnaround_days: input.turnaroundDays,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return result as Pick<ArtistCommissionService, 'id' | 'name' | 'price' | 'currency' | 'turnaround_days' | 'is_active'>;
}

export async function updateArtistCommissionService(input: {
  serviceId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  turnaroundDays: number;
}): Promise<ArtistCommissionService> {
  const { data, error } = await requireSupabase().rpc('update_artist_commission_service', {
    p_service_id: input.serviceId,
    p_name: input.name,
    p_description: input.description,
    p_price: input.price,
    p_currency: input.currency,
    p_turnaround_days: input.turnaroundDays,
  });
  if (error) throw error;
  return data as ArtistCommissionService;
}

export async function setArtistCommissionServiceActive(serviceId: string, isActive: boolean): Promise<ArtistCommissionService> {
  const { data, error } = await requireSupabase().rpc('set_artist_commission_service_active', {
    p_service_id: serviceId,
    p_is_active: isActive,
  });
  if (error) throw error;
  return data as ArtistCommissionService;
}

export async function listMyArtistCommissionServices(): Promise<ArtistCommissionService[]> {
  const { data, error } = await requireSupabase().rpc('list_my_artist_commission_services');
  if (error) throw error;
  return (data ?? []) as ArtistCommissionService[];
}

export async function listActiveArtistCommissionServices(artistId: string): Promise<Array<Pick<ArtistCommissionService, 'id' | 'artist_id' | 'name' | 'description' | 'price' | 'currency' | 'turnaround_days'>>> {
  const { data, error } = await requireSupabase().rpc('list_active_artist_commission_services', { p_artist_id: artistId });
  if (error) throw error;
  return (data ?? []) as Array<Pick<ArtistCommissionService, 'id' | 'artist_id' | 'name' | 'description' | 'price' | 'currency' | 'turnaround_days'>>;
}

export async function listActiveMarketplaceArtistServices(): Promise<MarketplaceArtistServiceFeedItem[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('artist_commission_services')
    .select('id, artist_id, name, description, price, currency, turnaround_days, is_active, created_at, updated_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as Array<Pick<ArtistCommissionService, 'id' | 'artist_id' | 'name' | 'description' | 'price' | 'currency' | 'turnaround_days' | 'is_active' | 'created_at' | 'updated_at'>>;
  if (rows.length === 0) return [];

  const artistIds = [...new Set(rows.map((row) => row.artist_id))];
  const { data: profileRows, error: profilesError } = await client
    .from('profiles')
    .select('id, name, username, avatar_data_url')
    .in('id', artistIds);
  if (profilesError) throw profilesError;

  const profilesById = new Map<string, { name: string | null; username: string | null; avatar_data_url: string | null }>();
  for (const profile of (profileRows ?? []) as Array<{ id: string; name: string | null; username: string | null; avatar_data_url: string | null }>) {
    profilesById.set(profile.id, profile);
  }

  return rows.map((service) => {
    const profile = profilesById.get(service.artist_id);
    return {
      id: service.id,
      artist_id: service.artist_id,
      artist_name: profile?.name ?? 'Artist',
      artist_username: profile?.username ?? null,
      artist_avatar_data_url: profile?.avatar_data_url ?? null,
      name: service.name,
      description: service.description,
      price: Number(service.price),
      currency: service.currency,
      turnaround_days: service.turnaround_days,
      is_active: service.is_active,
      created_at: service.created_at,
      updated_at: service.updated_at,
    } satisfies MarketplaceArtistServiceFeedItem;
  });
}

export async function setArtistCommissionAvailability(accepting: boolean): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc('set_artist_commission_availability', {
    p_accepting: accepting,
  });
  if (error) throw error;
  if (typeof data !== 'boolean') throw new Error('Availability setting did not return a value.');
  return data;
}