import { useEffect } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useNavigate } from 'react-router-dom';
import { BrandMark } from '../components/ui/BrandMark';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import './GetStartedPage.css';

export function GetStartedPage() {
  const navigate = useNavigate();
  const { isAuthenticated, initializing } = useAuth();

  useEffect(() => {
    if (!initializing && isAuthenticated) navigate('/home', { replace: true });
  }, [initializing, isAuthenticated, navigate]);

  return (
    <IonPage>
      <IonContent fullscreen className="get-started-viewport">
        <main className="get-started-page">
          <div className="get-started-stars" aria-hidden="true" />
          <div className="get-started-glow get-started-glow-one" aria-hidden="true" />
          <div className="get-started-glow get-started-glow-two" aria-hidden="true" />

          <header className="get-started-header">
            <div className="get-started-brand-mark">
              <BrandMark variant="navy" className="get-started-logo" />
            </div>
            <span className="get-started-brand-name">ArtGuard Hub</span>
          </header>

          <section className="get-started-card" aria-labelledby="get-started-title">
            <div className="get-started-card-shine" aria-hidden="true" />
            <div className="get-started-eyebrow">
              <span className="get-started-eyebrow-line" />
              The creative space for you
              <span className="get-started-eyebrow-line" />
            </div>
            <h1 id="get-started-title">Bring your next idea into focus.</h1>
            <p className="get-started-description">
              Discover digital artwork, connect with artists, request commissions, and participate in a marketplace built for creative work.
            </p>
            <button type="button" className="btn btn-primary get-started-button" onClick={() => navigate('/login')}>
              Get Started
              <Icon name="chevron-r" style={{ width: 18, height: 18 }} />
            </button>
            <p className="get-started-note">Your art. Your people. Your protected space.</p>
          </section>

          <footer className="get-started-footer">
            <span className="get-started-footer-dot" />
            Discover what is possible
          </footer>
        </main>
      </IonContent>
    </IonPage>
  );
}