import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Client-side route guard backed by the profile capability; RPCs enforce it server-side. */
export function RequireAdmin({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  return user?.isAdmin === true ? children : <Navigate to="/home" replace />;
}
