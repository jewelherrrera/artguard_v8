import type { ReactNode } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { Icon } from '../../assets/icons';
import { BrandMark } from '../ui/BrandMark';
import './AuthShell.css';

interface AuthShellProps {
  /** Icon shown in the small rounded mark above the title (defaults to "shield"). */
  markIcon?: Parameters<typeof Icon>[0]['name'];
  title: string;
  subtitle?: string;
  onBack?: () => void;
  authMode?: 'login' | 'signup';
  children: ReactNode;
}

/**
 * Shared frame for Login / Sign Up / Forgot Password.
 * Mirrors screen 02 of the mockup (icon mark, title, subtitle, scroll body)
 * while adding a back button slot used by every screen except the first.
 */
export function AuthShell({ markIcon = 'shield', title, subtitle, onBack, authMode, children }: AuthShellProps) {
  return (
    <IonPage>
      {/* Native scrolling (scrollY defaults to true) so the card can never be
          clipped: on short/laptop-height desktop viewports, or on mobile
          when a form (e.g. Sign Up) is taller than the screen, the whole
          page scrolls instead of cutting content off. */}
      <IonContent fullscreen className="auth-viewport">
        <div className="auth-backdrop">
          <div className={`auth-card${authMode ? ` auth-card--split auth-card--${authMode}` : ''}`}>
            {authMode && (
              <div className="auth-art-panel" aria-hidden="true">
                <div className="auth-art-sky" />
                <div className="auth-art-orbit auth-art-orbit-one" />
                <div className="auth-art-orbit auth-art-orbit-two" />
                <div className="auth-art-stars" />
                <div className="auth-art-copy">
                  <div className="auth-art-mark">
                    <BrandMark variant="navy" className="auth-art-logo" />
                  </div>
                  <span className="auth-art-kicker">ArtGuard Hub</span>
                  <strong>Make room for the work that matters.</strong>
                  <span>Discover, connect, and create with confidence.</span>
                </div>
                <div className="auth-art-swoop" />
              </div>
            )}
            <div className="auth-scroll">
              <div className="auth-topbar">
                {onBack && (
                  <button type="button" className="auth-back-btn" onClick={onBack} aria-label="Go back">
                    <Icon name="arrow-l" />
                  </button>
                )}
              </div>

              <div className="auth-mark">
                {markIcon === 'shield' ? (
                  <BrandMark themed={{ light: 'navy', dark: 'yellow' }} className="auth-mark-logo" />
                ) : (
                  <Icon name={markIcon} />
                )}
              </div>

              <h2 className="auth-title">{title}</h2>
              {subtitle && <p className="auth-subtitle">{subtitle}</p>}

              {children}
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
