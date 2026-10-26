import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useIonRouter } from '@ionic/react';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthInput } from '../components/auth/AuthInput';
import { AuthButton } from '../components/auth/AuthButton';
import { GoogleIdentityLoginButton } from '../components/auth/GoogleIdentityLoginButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { validateEmailField, validateRequired } from '../utils/validators';
import {
  logAuthInteractionDiagnostic,
  recordAuthDiagnosticNavigation,
} from '../utils/authInteractionDiagnostics';

interface FormErrors {
  email?: string;
  password?: string;
}

export function LoginPage() {
  const ionRouter = useIonRouter();
  const { login, completeExistingGoogleLogin } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [googleEmailSent, setGoogleEmailSent] = useState(false);
  const googleLoginInFlight = useRef(false);

  const handleGoogleCredential = async (credential: string) => {
    if (googleLoginInFlight.current) return;
    googleLoginInFlight.current = true;
    setFormError(undefined);
    setGoogleEmailSent(false);
    setGoogleSubmitting(true);
    logAuthInteractionDiagnostic('login.started', { destination: '/home', method: 'google' });
    let result: Awaited<ReturnType<typeof completeExistingGoogleLogin>>;
    try {
      result = await completeExistingGoogleLogin(credential);
    } catch {
      logAuthInteractionDiagnostic('login.failed', { success: false, method: 'google' });
      setFormError('Unable to sign in with Google right now. Please try again.');
      setGoogleSubmitting(false);
      googleLoginInFlight.current = false;
      return;
    }
    if (!result.success) {
      logAuthInteractionDiagnostic('login.failed', { success: false, method: 'google' });
      setFormError(result.error ?? 'Unable to start Google sign-in. Please try again.');
      setGoogleSubmitting(false);
      googleLoginInFlight.current = false;
      return;
    }
    googleLoginInFlight.current = false;
    setGoogleSubmitting(false);
    setGoogleEmailSent(true);
  };

  const validate = (): boolean => {
    const nextErrors: FormErrors = {
      email: validateEmailField(email),
      password: validateRequired(password, 'Password'),
    };
    setErrors(nextErrors);
    return !nextErrors.email && !nextErrors.password;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    if (!validate()) return;

    setSubmitting(true);
    logAuthInteractionDiagnostic('login.started', { destination: '/home' });
    let result: Awaited<ReturnType<typeof login>>;
    try {
      result = await login(email, password);
    } catch {
      logAuthInteractionDiagnostic('login.failed', { success: false });
      setSubmitting(false);
      setFormError('Unable to sign in right now. Please try again.');
      return;
    }
    setSubmitting(false);

    if (!result.success) {
      logAuthInteractionDiagnostic('login.failed', { success: false });
      setFormError(result.error ?? 'Something went wrong. Please try again.');
      return;
    }
    logAuthInteractionDiagnostic('login.completed', { success: true });
    recordAuthDiagnosticNavigation('/home', 'ionic-useIonRouter-root-replace');
    ionRouter.push('/home', 'root', 'replace');
  };

  return (
    <AuthShell
      authMode="login"
      brandHeader
      title="Sign in to your account"
      subtitle="Access your studio, artwork, and commissions securely."
    >
      {formError && (
        <div className="auth-banner error" role="alert">
          <Icon name="alert" style={{ stroke: 'var(--ag-danger)' }} />
          <span>{formError}</span>
        </div>
      )}
      {googleEmailSent && (
        <div className="auth-banner success" role="status" style={{ marginBottom: 16 }}>
          <span>Check your email to finish signing in. The secure sign-in link will take you back to ArtGuard Hub.</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <AuthInput
          label="Email address"
          icon="mail"
          type="email"
          value={email}
          onChange={(v) => {
            setEmail(v);
            if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
          }}
          placeholder="maren@studio.com"
          autoComplete="email"
          name="email"
          error={errors.email}
        />
        <AuthInput
          label="Password"
          icon="lock"
          type="password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          placeholder="••••••••••"
          autoComplete="current-password"
          name="password"
          error={errors.password}
        />

        <div style={{ textAlign: 'right', marginBottom: 22 }}>
          <button
            type="button"
            className="auth-link-btn t-xs"
            onClick={() => ionRouter.push('/forgot-password', 'forward')}
          >
            Forgot password?
          </button>
        </div>

        <AuthButton type="submit" loading={submitting} style={{ marginBottom: 18 }}>
          Log In
        </AuthButton>
      </form>

      <div className="row gap-10" style={{ marginBottom: 18 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--ag-border-soft)' }} />
        <span className="t-xs c-low">or continue with</span>
        <div style={{ flex: 1, height: 1, background: 'var(--ag-border-soft)' }} />
      </div>

      <GoogleIdentityLoginButton
        disabled={googleSubmitting}
        onCredential={(credential) => void handleGoogleCredential(credential)}
        onError={(message) => {
          setGoogleEmailSent(false);
          setFormError(message);
        }}
      />

      <p className="t-xs c-low auth-footnote">
        New to ArtGuard Hub?{' '}
        <button type="button" className="auth-link-btn t-xs" onClick={() => ionRouter.push('/signup', 'forward')}>
          Create an artist account
        </button>
      </p>
    </AuthShell>
  );
}
