import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthInput } from '../components/auth/AuthInput';
import { AuthButton } from '../components/auth/AuthButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { validateConfirmPassword, validatePasswordField } from '../utils/validators';

type RecoveryState = 'checking' | 'ready' | 'invalid' | 'success';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { backendMode, initializing, passwordRecoverySession, clearPasswordRecoverySession } = useAuth();
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const recoveryCompletedRef = useRef(false);

  useEffect(() => {
    if (initializing || recoveryCompletedRef.current) return;
    let active = true;
    setRecoveryState('checking');

    if (backendMode !== 'supabase' || !isSupabaseConfigured || !supabase || !passwordRecoverySession) {
      setRecoveryState('invalid');
      return () => { active = false; };
    }

    void (async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) {
          if (active) setRecoveryState('invalid');
          return;
        }
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) {
          if (active) setRecoveryState('invalid');
          return;
        }
        if (active) setRecoveryState('ready');
      } catch {
        if (active) setRecoveryState('invalid');
      }
    })();

    return () => { active = false; };
  }, [backendMode, initializing, passwordRecoverySession]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || recoveryState !== 'ready') return;

    const nextPasswordError = validatePasswordField(password);
    const nextConfirmError = validateConfirmPassword(password, confirmPassword);
    setPasswordError(nextPasswordError);
    setConfirmError(nextConfirmError);
    setFormError(undefined);
    if (nextPasswordError || nextConfirmError) return;
    if (!supabase || !isSupabaseConfigured || !passwordRecoverySession) {
      setRecoveryState('invalid');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        setRecoveryState('invalid');
        return;
      }
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        setRecoveryState('invalid');
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(error.message);
        return;
      }
      recoveryCompletedRef.current = true;
      clearPasswordRecoverySession();
      setRecoveryState('success');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not update your password. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <AuthShell
      title="Reset Password"
      subtitle="Choose a new password for your account."
      markIcon="lock"
      onBack={() => navigate('/login')}
    >
      {recoveryState === 'checking' && (
        <div className="auth-banner" role="status">Verifying your recovery session...</div>
      )}

      {recoveryState === 'invalid' && (
        <>
          <div className="auth-banner error" role="alert">
            <Icon name="alert" style={{ stroke: 'var(--ag-danger)' }} />
            <span>This password reset link is invalid or expired. Request a new link and try again.</span>
          </div>
          <AuthButton onClick={() => navigate('/forgot-password')}>Request a New Link</AuthButton>
          <p className="t-xs c-low auth-footnote">
            <button type="button" className="auth-link-btn t-xs" onClick={() => navigate('/login')}>Back to Login</button>
          </p>
        </>
      )}

      {recoveryState === 'ready' && (
        <form onSubmit={handleSubmit} noValidate>
          {formError && (
            <div className="auth-banner error" role="alert">
              <Icon name="alert" style={{ stroke: 'var(--ag-danger)' }} />
              <span>{formError}</span>
            </div>
          )}
          <AuthInput
            label="New Password"
            icon="lock"
            type="password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setPasswordError(undefined);
              setConfirmError(undefined);
              setFormError(undefined);
            }}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            name="new-password"
            error={passwordError}
            disabled={saving}
          />
          <AuthInput
            label="Confirm Password"
            icon="lock"
            type="password"
            value={confirmPassword}
            onChange={(value) => {
              setConfirmPassword(value);
              setConfirmError(undefined);
              setFormError(undefined);
            }}
            placeholder="Re-enter your new password"
            autoComplete="new-password"
            name="confirm-password"
            error={confirmError}
            disabled={saving}
          />
          <AuthButton type="submit" loading={saving} style={{ marginTop: 8 }}>
            Reset Password
          </AuthButton>
        </form>
      )}

      {recoveryState === 'success' && (
        <>
          <div className="auth-banner success" role="status">
            <Icon name="check-circle" style={{ stroke: 'var(--ag-success)' }} />
            <span>Password updated successfully.</span>
          </div>
          <AuthButton onClick={() => navigate('/login', { replace: true })}>Continue to Login</AuthButton>
        </>
      )}
    </AuthShell>
  );
}
