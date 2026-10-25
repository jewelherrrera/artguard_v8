import { useEffect, useRef } from 'react';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityButtonOptions {
  type: 'standard';
  theme: 'outline';
  size: 'large';
  text: 'continue_with';
  shape: 'rectangular';
  logo_alignment: 'left';
  width: number;
}

interface GoogleIdentityApi {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): void;
  renderButton(parent: HTMLElement, options: GoogleIdentityButtonOptions): void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleIdentityApi;
      };
    };
  }
}

interface GoogleIdentityLoginButtonProps {
  disabled: boolean;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}

const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
let googleIdentityScriptPromise: Promise<void> | undefined;

async function googleClientIdFingerprint(clientId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleIdentityScriptPromise) return googleIdentityScriptPromise;

  googleIdentityScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.onload = () => {
      if (window.google?.accounts?.id) resolve();
      else reject(new Error('Google Identity Services did not initialize.'));
    };
    script.onerror = () => reject(new Error('Google Identity Services could not be loaded.'));
    if (!existing) document.head.appendChild(script);
  }).catch((error: unknown) => {
    googleIdentityScriptPromise = undefined;
    throw error;
  });

  return googleIdentityScriptPromise;
}

export function GoogleIdentityLoginButton({
  disabled,
  onCredential,
  onError,
}: GoogleIdentityLoginButtonProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

  useEffect(() => {
    onCredentialRef.current = onCredential;
    onErrorRef.current = onError;
  }, [onCredential, onError]);

  useEffect(() => {
    if (!clientId) {
      onErrorRef.current('Google sign-in is not configured. Please try again later.');
      return;
    }

    void googleClientIdFingerprint(clientId)
      .then((fingerprint) => console.info('ArtGuard Google Login client configuration.', {
        clientIdFingerprint: fingerprint,
      }))
      .catch(() => console.warn('ArtGuard Google Login client fingerprint unavailable.'));

    let active = true;
    void loadGoogleIdentityScript().then(() => {
      if (!active || !buttonRef.current || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: ({ credential }) => {
          if (typeof credential !== 'string' || !credential) {
            onErrorRef.current('Google could not verify your account. Please try again.');
            return;
          }
          onCredentialRef.current(credential);
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: Math.min(400, Math.max(200, Math.floor(buttonRef.current.clientWidth))),
      });
    }).catch(() => {
      if (active) onErrorRef.current('Google sign-in is unavailable. Please try again.');
    });

    return () => {
      active = false;
      if (buttonRef.current) buttonRef.current.replaceChildren();
    };
  }, [clientId]);

  return (
    <div
      ref={buttonRef}
      aria-disabled={disabled}
      style={{
        width: '100%',
        minHeight: 44,
        marginBottom: 12,
        display: 'flex',
        justifyContent: 'center',
        opacity: disabled ? 0.6 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    />
  );
}
