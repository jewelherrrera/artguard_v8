export type UserRole = 'artist' | 'client';
export type ArtistVerificationStatus = 'not_started' | 'pending' | 'verified' | 'rejected';

export function isVerifiedArtistStatus(status?: ArtistVerificationStatus | null): boolean {
  return status === 'verified';
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  username?: string;
  role: UserRole;
  createdAt?: string;
  bio?: string;
  interests?: string[];
  avatarDataUrl?: string;
  onboarded?: boolean;
  isPro?: boolean;
  lastSeenAt?: string;
  artistVerificationStatus?: ArtistVerificationStatus;
  artistVerificationSubmittedAt?: string;
  artistVerificationReviewedAt?: string;
  artistVerificationReviewedBy?: string;
  artistVerificationRejectionReason?: string;
  artistVerificationArtworkId?: string;
  isAdmin?: boolean;
}

export interface MockAccount extends AuthUser {
  password: string;
  dateOfBirth?: string;
}

export interface AuthResult {
  success: boolean;
  error?: string;
}
