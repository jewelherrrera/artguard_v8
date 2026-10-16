import type { ReactNode } from 'react';
import { IonContent, IonPage } from '@ionic/react';

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
export function ScreenShell({ header, footer, children, padContent = true, contentClassName = '', aside }: ScreenShellProps) {
  return (
    <IonPage className="app-page">
      <div className="app-shell">
        {aside}
        <div className="app-frame">
          {header}
          <IonContent className="app-content">
            <div className={padContent ? `app-content-inner ${contentClassName}`.trim() : contentClassName}>
              {children}
            </div>
          </IonContent>
          {footer}
        </div>
      </div>
    </IonPage>
  );
}
