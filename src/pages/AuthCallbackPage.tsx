import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthButton } from '../components/auth/AuthButton';
import { AuthShell } from '../components/auth/AuthShell';
import { Icon } from '../assets/icons';
import { useAuth, type GoogleSignupIntent } from '../context/AuthContext';
import {
  logAuthInteractionDiagnostic,
  recordAuthDiagnosticNavigation,
} from '../utils/authInteractionDiagnostics';

const GOOGLE_SIGNUP_INTENT_KEY = 'artguard.googleSignupIntent';
const CALLBACK_TIMEOUT_MS = 20000;

function readGoogleSignupIntent(): GoogleSignupIntent | undefined {
  let stored: string | null;
  try {
    stored = sessionStorage.getItem(GOOGLE_SIGNUP_INTENT_KEY);
  } catch {
    return undefined;
  }
  if (!stored) return undefined;
  try {
    const intent: unknown = JSON.parse(stored);
    if (
      typeof intent === 'object'
      && intent !== null
      && ('role' in intent)
      && (intent.role === 'artist' || intent.role === 'client')
      && ('startedAt' in intent)
      && typeof intent.startedAt === 'number'
      && Number.isFinite(intent.startedAt)
    ) {
      return { role: intent.role, startedAt: intent.startedAt };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function clearGoogleSignupIntent() {
  try {
    sessionStorage.removeItem(GOOGLE_SIGNUP_INTENT_KEY);
  } catch {
    // Session storage may be unavailable in restrictive browser modes.
  }
}

function withCallbackTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('oauth_callback_timeout')), CALLBACK_TIMEOUT_MS);
    operation.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { completeGoogleSignIn } = useAuth();
  const [error, setError] = useState<string>();
  const [processing, setProcessing] = useState(true);
  const [retryable, setRetryable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const handledAttempt = useRef<number | null>(null);

  useEffect(() => {
    const callbackParams = new URLSearchParams(
      `${location.search.slice(1)}&${location.hash.slice(1)}`,
    );
    const providerError = callbackParams.get('error_code') ?? callbackParams.get('error');
    if (providerError) {
      clearGoogleSignupIntent();
      handledAttempt.current = attempt;
      const cancelled = providerError === 'access_denied' || providerError === 'user_cancelled';
      setError(cancelled
        ? 'Google sign-in was cancelled or declined. You can try again.'
        : 'Google sign-in could not be completed. Please try again.');
      setRetryable(false);
      setProcessing(false);
      return;
    }

    if (handledAttempt.current === attempt) return;
    handledAttempt.current = attempt;
    setError(undefined);
    setRetryable(false);
    setProcessing(true);

    const intent = readGoogleSignupIntent();
    void withCallbackTimeout(completeGoogleSignIn(intent)).then((result) => {
      if (!result.success || !result.destination) {
        logAuthInteractionDiagnostic('login.failed', { success: false, method: 'google' });
        setError(result.error ?? 'Unable to complete Google sign-in. Please try again.');
        setRetryable(true);
        setProcessing(false);
        return;
      }
      logAuthInteractionDiagnostic('login.completed', { success: true, method: 'google' });
      recordAuthDiagnosticNavigation(result.destination, 'react-router-oauth-callback');
      navigate(result.destination, { replace: true });
    }).catch((callbackError: unknown) => {
      setError(callbackError instanceof Error && callbackError.message === 'oauth_callback_timeout'
        ? 'Google sign-in is taking longer than expected. Check your connection and try again.'
        : 'Unable to complete Google sign-in. Please try again.');
      setRetryable(true);
      setProcessing(false);
    });
  }, [attempt, completeGoogleSignIn, location.hash, location.search, navigate]);

  const retry = () => {
    setError(undefined);
    setRetryable(false);
    setProcessing(true);
    setAttempt((current) => current + 1);
  };

  return (
    <AuthShell
      brandHeader
      title="Finishing Google sign-in"
      subtitle={processing ? 'Verifying your account and preparing your profile.' : undefined}
      onBack={() => navigate('/login', { replace: true })}
    >
      {error ? (
        <>
          <div className="auth-banner error" role="alert">
            <Icon name="alert" style={{ stroke: 'var(--ag-danger)' }} />
            <span>{error}</span>
          </div>
          {retryable && <AuthButton onClick={retry} style={{ marginBottom: 10 }}>Try again</AuthButton>}
          <AuthButton onClick={() => navigate('/login', { replace: true })}>Back to Login</AuthButton>
        </>
      ) : (
        <div className="auth-banner" role="status">
          <span>{processing ? 'Please wait...' : 'Google sign-in complete. Redirecting...'}</span>
        </div>
      )}
    </AuthShell>
  );
}
