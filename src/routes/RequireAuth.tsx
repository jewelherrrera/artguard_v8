import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { IonPage, IonContent, IonSpinner } from '@ionic/react';
import { useAuth } from '../context/AuthContext';
import { logAuthInteractionDiagnostic } from '../utils/authInteractionDiagnostics';

/** Redirects to /login if there is no mock session; renders children once there is. */
export function RequireAuth({ children }: { children: ReactElement }) {
  const { isAuthenticated, initializing } = useAuth();
  const location = useLocation();

  useEffect(() => {
    logAuthInteractionDiagnostic('protected-route.checked', {
      destination: location.pathname,
      initializing,
      hasUser: isAuthenticated,
      isAuthenticated,
    });
    if (!initializing && !isAuthenticated) {
      logAuthInteractionDiagnostic('protected-route.redirected', {
        destination: '/login',
        initializing,
        hasUser: false,
        isAuthenticated: false,
      });
    }
  }, [initializing, isAuthenticated, location.pathname]);

  if (initializing) {
    return (
      <IonPage>
        <IonContent fullscreen>
          <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center' }}>
            <IonSpinner name="crescent" />
          </div>
        </IonContent>
      </IonPage>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}
