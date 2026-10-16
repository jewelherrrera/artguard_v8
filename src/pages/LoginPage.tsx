import { useState } from 'react';
import type { FormEvent } from 'react';
import { useIonRouter } from '@ionic/react';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthInput } from '../components/auth/AuthInput';
import { AuthButton } from '../components/auth/AuthButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { validateEmailField, validateRequired } from '../utils/validators';

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
    const result = await login(email, password);
    setSubmitting(false);

    if (!result.success) {
      setFormError(result.error ?? 'Something went wrong. Please try again.');
      return;
    }
    ionRouter.push('/home', 'root', 'replace');
  };

  return (
    <AuthShell authMode="login" title="Welcome back" subtitle="Log in to keep your commissions moving.">
      {formError && (
        <div className="auth-banner error">
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
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            background: '#fff',
            color: '#1D5C8C',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 800,
            fontFamily: "'Space Grotesk', sans-serif",
          }}
        >
          G
        </span>
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
