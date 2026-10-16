import { useAuth } from '../context/AuthContext';
import { ArtistProfilePage } from './ArtistProfilePage';
import { ClientProfilePage } from './ClientProfilePage';

/**
 * The Profile tab renders a different self-profile experience depending on
 * the signed-in person's role: artists get a portfolio/showcase, clients get
 * a commission-requests board. Public artist profiles (reached from the
 * Marketplace) always use `ArtistProfilePage` directly regardless of the
 * viewer's own role — see AppRoutes.tsx.
 */
export function ProfilePage() {
  const { user } = useAuth();
  if (user?.role === 'client') return <ClientProfilePage />;
  return <ArtistProfilePage />;
}
