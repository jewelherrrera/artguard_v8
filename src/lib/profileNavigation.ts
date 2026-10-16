import type { NavigateFunction } from 'react-router-dom';
import { getPublicProfile } from './supabaseData';

export async function navigateToFullProfile(
  navigate: NavigateFunction,
  userId: string,
  currentUserId?: string,
): Promise<boolean> {
  const profile = await getPublicProfile(userId);
  if (!profile) return false;

  const route = currentUserId === profile.id
    ? '/profile'
    : profile.role === 'artist'
    ? `/market/artist/${encodeURIComponent(profile.id)}`
    : `/profile/client/${encodeURIComponent(profile.id)}`;
  navigate(route);
  return true;
}
