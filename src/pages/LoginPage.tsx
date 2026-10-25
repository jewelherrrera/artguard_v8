import { useState } from 'react';
import type { FormEvent } from 'react';
import { useIonRouter } from '@ionic/react';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthInput } from '../components/auth/AuthInput';
import { AuthButton } from '../components/auth/AuthButton';
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
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

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

      <AuthButton variant="secondary" style={{ marginBottom: 12 }} onClick={() => setFormError('Google sign-in is not available in this preview yet.')}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
          <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
          <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3Z" />
          <path fill="#EA4335" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.8-5.8A19.4 19.4 0 0 0 24 4 20 20 0 0 0 5.8 15.1l6.8 5.3c1.6-4.9 6.1-8.5 11.4-8.5Z" />
        </svg>
        Continue with Google
      </AuthButton>

      <p className="t-xs c-low auth-footnote">
        New to ArtGuard Hub?{' '}
        <button type="button" className="auth-link-btn t-xs" onClick={() => ionRouter.push('/signup', 'forward')}>
          Create an artist account
        </button>
      </p>
    </AuthShell>
  );
}
