import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IonContent, IonPage } from '@ionic/react';
import { BrandMark } from '../components/ui/BrandMark';
import { useAuth } from '../context/AuthContext';
import './SplashPage.css';

const DOT_COUNT = 3;
const DOT_INTERVAL_MS = 380;
const SPLASH_DURATION_MS = 4000;
const EXIT_DURATION_MS = 520;

export function SplashPage() {
  const navigate = useNavigate();
  const { isAuthenticated, initializing } = useAuth();
  const [activeDot, setActiveDot] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const splashStartedAt = useRef(Date.now());
  const exiting = useRef(false);
  const exitTimer = useRef<number | null>(null);

  useEffect(() => {
    const dotTimer = setInterval(() => {
      setActiveDot((d) => (d + 1) % DOT_COUNT);
    }, DOT_INTERVAL_MS);
    return () => clearInterval(dotTimer);
  }, []);

  useEffect(() => {
    const timeRemaining = Math.max(0, SPLASH_DURATION_MS - (Date.now() - splashStartedAt.current));
    const timer = window.setTimeout(() => {
      if (initializing || exiting.current) return;
      exiting.current = true;
      setIsExiting(true);
      exitTimer.current = window.setTimeout(() => {
        navigate(isAuthenticated ? '/home' : '/get-started', { replace: true });
      }, EXIT_DURATION_MS);
    }, timeRemaining);
    return () => window.clearTimeout(timer);
  }, [navigate, isAuthenticated, initializing]);

  useEffect(() => () => {
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
  }, []);

  const skip = () => {
    if (exiting.current) return;
    exiting.current = true;
    setIsExiting(true);
    exitTimer.current = window.setTimeout(() => {
      navigate(isAuthenticated ? '/home' : '/get-started', { replace: true });
    }, EXIT_DURATION_MS);
  };

  return (
    <IonPage>
      <IonContent fullscreen scrollY={false} className="splash-viewport">
        <button type="button" className={`splash-body splash-hint${isExiting ? ' is-exiting' : ''}`} onClick={skip} aria-label="Continue">
          <div className="splash-weave" />
          <div className="splash-content">
            <div className="splash-mark">
              <BrandMark variant="navy" className="splash-mark-logo" />
            </div>
            <div>
              <h2 className="splash-title">ArtGuard Hub</h2>
              <p className="t-sm c-mid splash-tagline">Create, commission, and discover digital art in one creative space.</p>
            </div>
          </div>
          <div className="splash-footer">
            <div className="splash-dots">
              {Array.from({ length: DOT_COUNT }).map((_, i) => (
                <span key={i} className={`splash-dot${i === activeDot ? ' is-active' : ''}`} />
              ))}
            </div>
            <span className="t-xs c-low mono">SECURING SESSION…</span>
          </div>
        </button>
      </IonContent>
    </IonPage>
  );
}
