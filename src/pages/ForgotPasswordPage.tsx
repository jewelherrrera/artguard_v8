import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthInput } from '../components/auth/AuthInput';
import { AuthButton } from '../components/auth/AuthButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { validateEmailField } from '../utils/validators';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { requestPasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validation = validateEmailField(email);
    setError(validation);
    if (validation) return;

    setSubmitting(true);
    const result = await requestPasswordReset(email);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error ?? 'Could not send a reset link. Please try again.');
      return;
    }
    setSent(true);
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email on your account and we'll send you a link to reset your password."
      markIcon="lock"
      onBack={() => navigate('/login')}
    >
      {sent ? (
        <>
          <div className="auth-banner success">
            <Icon name="check-circle" style={{ stroke: 'var(--ag-success)' }} />
            <span>
              If an account exists for <strong>{email}</strong>, we&apos;ve sent instructions to reset your
              password.
            </span>
          </div>
          <AuthButton onClick={() => navigate('/login')}>Back to Login</AuthButton>
        </>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <AuthInput
            label="Email address"
            icon="mail"
            type="email"
            value={email}
            onChange={(v) => {
              setEmail(v);
              if (error) setError(undefined);
            }}
            placeholder="maren@studio.com"
            autoComplete="email"
            name="email"
            error={error}
          />

          <AuthButton type="submit" loading={submitting} style={{ marginTop: 8, marginBottom: 18 }}>
            Send Reset Link
          </AuthButton>

          <p className="t-xs c-low auth-footnote">
            Remembered it after all?{' '}
            <button type="button" className="auth-link-btn t-xs" onClick={() => navigate('/login')}>
              Back to Login
            </button>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
