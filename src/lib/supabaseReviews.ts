import { supabase } from './supabase';

export interface ArtistReview {
  review_id: string;
  commission_id: string;
  rating: number;
  review_text: string;
  created_at: string;
  edited_at: string | null;
  reviewer_display_name: string;
  reviewer_username: string;
  reviewer_avatar_data_url: string | null;
}

export interface SubmittedArtistReview {
  id: string;
  commission_id: string;
  rating: number;
  review_text: string;
  created_at: string;
  edited_at: string | null;
}

export async function listArtistReviews(artistId: string): Promise<ArtistReview[]> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('list_artist_reviews', {
    p_artist_id: artistId,
  });
  if (error) throw error;
  return (data ?? []) as ArtistReview[];
}

export async function submitArtistReview(
  commissionId: string,
  rating: number,
  reviewText: string,
): Promise<SubmittedArtistReview> {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('Rating must be an integer between 1 and 5.');
  }

  const trimmedReviewText = reviewText.trim();
  if (!trimmedReviewText) throw new Error('Review text cannot be empty.');

  const { data, error } = await supabase.rpc('submit_artist_review', {
    p_commission_id: commissionId,
    p_rating: rating,
    p_review_text: trimmedReviewText,
  });
  if (error) throw error;
  return data as SubmittedArtistReview;
}

export async function updateArtistReview(
  reviewId: string,
  rating: number,
  reviewText: string,
): Promise<SubmittedArtistReview> {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('Rating must be an integer between 1 and 5.');
  }

  const trimmedReviewText = reviewText.trim();
  if (!trimmedReviewText) throw new Error('Review text cannot be empty.');

  const { data, error } = await supabase.rpc('update_my_artist_review', {
    p_review_id: reviewId,
    p_rating: rating,
    p_review_text: trimmedReviewText,
  });
  if (error) throw error;
  return data as SubmittedArtistReview;
}