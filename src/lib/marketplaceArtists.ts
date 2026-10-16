import type { CSSProperties } from 'react';
import type { Artist } from '../data/mockData';
import type { PublicProfile } from './supabaseData';
import { isVerifiedArtistStatus } from '../types/auth';
import type { MarketplaceArtistReviewSummary, MarketplaceServiceSummary } from './supabaseMarketplace';

export type UnavailableMarketplaceField = 'rating' | 'reviewCount' | 'completed' | 'responseTime' | 'slots' | 'startingPrice' | 'pricing' | 'portfolio';

export interface MarketplaceArtist extends Omit<Artist, 'verified' | 'coverGradient' | 'rating' | 'reviewCount'> {
  verified: boolean;
  coverGradient?: string;
  rating?: number;
  reviewCount?: number;
  source: 'mock' | 'supabase';
  avatarDataUrl?: string | null;
  unavailableFields: Set<UnavailableMarketplaceField>;
  activeServiceCount?: number;
  minimumServicePrice?: number;
  minimumServiceCurrency?: string;
  serviceCurrencies?: string[];
  hasMultipleServiceCurrencies?: boolean;
  minimumTurnaroundDays?: number;
}

export function loadMockMarketplaceArtists(artists: Artist[]): MarketplaceArtist[] {
  return artists.map((artist) => ({
    ...artist,
    verified: Boolean(artist.verified),
    source: 'mock',
    unavailableFields: new Set(),
  }));
}

export function adaptSupabaseArtist(
  profile: PublicProfile,
  serviceSummary?: MarketplaceServiceSummary,
  reviewSummary?: MarketplaceArtistReviewSummary,
): MarketplaceArtist {
  const unavailableFields = new Set<UnavailableMarketplaceField>([
    'rating',
    'reviewCount',
    'completed',
    'responseTime',
    'slots',
    'startingPrice',
    'pricing',
    'portfolio',
  ]);
  if (reviewSummary) {
    unavailableFields.delete('rating');
    unavailableFields.delete('reviewCount');
  }
  return {
    id: profile.id,
    name: profile.name,
    handle: `@${profile.username}`,
    initials: profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''),
    avatarStyle: profile.avatar_data_url ? { backgroundImage: `url(${profile.avatar_data_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {} as CSSProperties,
    avatarDataUrl: profile.avatar_data_url,
    tags: profile.interests ?? [],
    bio: profile.bio ?? '',
    rating: reviewSummary?.average_rating,
    reviewCount: reviewSummary?.review_count,
    completed: 0,
    responseTime: '',
    slots: 0,
    startingPrice: 0,
    pricing: [],
    portfolio: [],
    verified: isVerifiedArtistStatus(profile.artist_verification_status),
    coverGradient: undefined,
    source: 'supabase',
    unavailableFields,
    activeServiceCount: serviceSummary?.active_service_count,
    minimumServicePrice: serviceSummary?.minimum_price,
    minimumServiceCurrency: serviceSummary?.minimum_price_currency,
    serviceCurrencies: serviceSummary?.currencies,
    hasMultipleServiceCurrencies: serviceSummary?.has_multiple_currencies,
    minimumTurnaroundDays: serviceSummary?.minimum_turnaround_days,
  };
}
