import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { IonPage, IonContent, IonSpinner } from '@ionic/react';
import { useAuth } from '../context/AuthContext';

/** Redirects to /login if there is no mock session; renders children once there is. */
export function RequireAuth({ children }: { children: ReactElement }) {
  const { isAuthenticated, initializing } = useAuth();

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
