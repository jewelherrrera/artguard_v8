import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Restricts artist-owned protection surfaces without creating a second auth model. */
export function RequireArtist({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  return user?.role === 'artist' ? children : <Navigate to="/home" replace />;
}