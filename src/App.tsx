import { IonApp, setupIonicReact } from '@ionic/react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { IonReactRouter } from '@ionic/react-router';

/* Core Ionic CSS */
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional Ionic CSS utils */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/* ArtGuard Hub theme (ported from the mockup) */
import './theme/fonts.css';
import './theme/variables.css';
import './theme/global.css';

import { IconSprite } from './assets/icons';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ArtworkFeedProvider } from './context/ArtworkFeedContext';
import { ChatProvider } from './context/ChatContext';
import { NotificationProvider } from './context/NotificationContext';
import { AppRoutes } from './routes/AppRoutes';

setupIonicReact({
  mode: 'ios', // consistent chrome (segments, buttons, transitions) across Android/iOS/Web
});

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('ArtGuard runtime error:', error, info); }
  render() {
    if (this.state.error) return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--ag-bg)', color: 'var(--ag-text)' }}>
        <div style={{ maxWidth: 560, width: '100%', padding: 24, borderRadius: 18, background: 'var(--ag-surface)', border: '1px solid var(--ag-border)' }}>
          <h2 style={{ marginTop: 0 }}>ArtGuard Hub couldn't load</h2>
          <p style={{ color: 'var(--ag-text-mid)' }}>A runtime error occurred. The app is showing the message below instead of a blank screen.</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, color: 'var(--ag-danger)' }}>{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 10, padding: '10px 14px', borderRadius: 10, border: 0 }}>Refresh</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <IonApp>
      <IconSprite />
      <ThemeProvider>
        <AuthProvider>
          <ArtworkFeedProvider>
            <ChatProvider>
              <NotificationProvider>
                <IonReactRouter>
                  <AppRoutes />
                </IonReactRouter>
              </NotificationProvider>
            </ChatProvider>
          </ArtworkFeedProvider>
        </AuthProvider>
      </ThemeProvider>
      </IonApp>
    </AppErrorBoundary>
  );
}
