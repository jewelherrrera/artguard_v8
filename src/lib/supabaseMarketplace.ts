import { supabase } from './supabase';

export interface MarketplaceServiceSummary {
  artist_id: string;
  active_service_count: number;
  minimum_price: number;
  minimum_price_currency: string;
  currencies: string[];
  has_multiple_currencies: boolean;
  minimum_turnaround_days: number;
}

export interface MarketplaceArtistReviewSummary {
  artist_id: string;
  review_count: number;
  average_rating: number;
}

export async function listMarketplaceArtistServiceSummaries(): Promise<MarketplaceServiceSummary[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('list_marketplace_artist_service_summaries');
  if (error) throw error;
  return (data ?? []) as MarketplaceServiceSummary[];
}

export async function listMarketplaceArtistReviewSummaries(): Promise<MarketplaceArtistReviewSummary[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('list_marketplace_artist_review_summaries');
  if (error) throw error;
  return (data ?? []) as MarketplaceArtistReviewSummary[];
}
