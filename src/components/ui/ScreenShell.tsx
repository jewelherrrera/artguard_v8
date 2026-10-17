import type { ReactNode } from 'react';
import { createElement, useEffect, useRef, useState } from 'react';
import { IonContent, IonPage, IonRefresherContent } from '@ionic/react';

interface ScreenShellProps {
  /** Non-scrolling content pinned above the scroll area (custom per-screen header markup). */
  header?: ReactNode;
  /** Non-scrolling content pinned below the scroll area (BottomNav, a sticky action bar, etc). */
  footer?: ReactNode;
  /** Scrollable body. */
  children: ReactNode;
  /** When true (default), wraps children in the standard side-padded container. Set false for screens that need edge-to-edge content (e.g. a full-bleed cover photo). */
  padContent?: boolean;
  /** Extra class name(s) for the scrollable inner wrapper. */
  contentClassName?: string;
  /** Optional branded loading strip shown at the top of the screen. */
  loading?: boolean;
  /** Text shown in the optional loading strip. */
  loadingLabel?: string;
  /** Refresh the data displayed by this screen when the user pulls down. */
  onRefresh?: () => Promise<void>;
  /**
   * Desktop-only persistent side panel rendered INSIDE the page (before the
   * header/content/footer column), e.g. the chat conversation list. Must
   * live inside IonPage — not as a sibling wrapping ScreenShell — so
   * Ionic's page-stack show/hide logic (which hides the whole `ion-page`
   * when another route becomes active) hides it along with everything
   * else on this page instead of leaving it floating over other routes.
   */
  aside?: ReactNode;
}

/**
 * Shared page frame for every non-auth screen: a fixed header, a native
 * scrollable `IonContent` body (so touch scrolling on Android/iOS and
 * mouse/trackpad scrolling on Web both work out of the box), and a fixed
 * footer (bottom nav or a sticky action bar) that stays put while the body
 * scrolls underneath it. Centers to a phone-proportioned column on tablet
 * and desktop, matching the auth screens' responsive treatment, without
 * ever using the mockup's fixed 308×666 presentation frame as real layout.
 */
export function ScreenShell({ header, footer, children, padContent = true, contentClassName = '', loading = false, loadingLabel = 'Loading', onRefresh, aside }: ScreenShellProps) {
  const [showLoading, setShowLoading] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const refresherRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      setSlowLoading(false);
      return;
    }
    const indicatorTimer = window.setTimeout(() => setShowLoading(true), 250);
    const slowTimer = window.setTimeout(() => setSlowLoading(true), 5000);
    return () => {
      window.clearTimeout(indicatorTimer);
      window.clearTimeout(slowTimer);
    };
  }, [loading]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    const refresher = refresherRef.current;
    if (!onRefresh || !refresher) return;
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ complete: () => void }>).detail;
      void (async () => {
        try {
          await onRefresh();
        } catch (error) {
          console.error('ArtGuard: screen refresh failed', error);
        } finally {
          detail.complete();
        }
      })();
    };
    refresher.addEventListener('ionRefresh', handleRefresh);
    return () => refresher.removeEventListener('ionRefresh', handleRefresh);
  }, [onRefresh]);

  const refresher = onRefresh
    ? createElement('ion-refresher', {
      ref: refresherRef,
      slot: 'fixed',
      className: 'app-refresher',
    }, <IonRefresherContent pullingText="Pull to refresh" refreshingText="Refreshing" />)
    : null;

  return (
    <IonPage className="app-page">
      <div className="app-shell">
        {aside}
        <div className="app-frame">
          {showLoading && (
            <div className="app-loading-indicator" role="status" aria-live="polite">
              <span className="app-loading-comet" aria-hidden="true" />
              <span className="sr-only">{slowLoading ? 'Still loading' : loadingLabel}</span>
            </div>
          )}
          {header}
          <IonContent className="app-content">
            {refresher}
            <div className={padContent ? `app-content-inner ${contentClassName}`.trim() : contentClassName}>
              {!online && (
                <div className="app-offline-status" role="status">
                  You&apos;re offline. Live data may be unavailable.
                </div>
              )}
              {children}
            </div>
          </IonContent>
          {footer}
        </div>
      </div>
    </IonPage>
  );
}
