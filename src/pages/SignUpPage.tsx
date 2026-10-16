import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthInput } from '../components/auth/AuthInput';
import { AuthButton } from '../components/auth/AuthButton';
import { RoleToggle } from '../components/auth/RoleToggle';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/auth';
import {
  assessPassword,
  validateConfirmPassword,
  validateBirthdayField,
  validateEmailField,
  validatePasswordField,
  validateRequired,
} from '../utils/validators';
import './SignUpPage.css';

interface FormErrors {
  name?: string;
  birthday?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export function SignUpPage() {
  const navigate = useNavigate();
  const { signUp } = useAuth();

  const [role, setRole] = useState<UserRole>('artist');
  const [name, setName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const passwordAssessment = assessPassword(password);

  const today = new Date();
  const maxBirthday = `${today.getFullYear().toString().padStart(4, '0')}-${(today.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

  const validate = (): boolean => {
    const nextErrors: FormErrors = {
      name: validateRequired(name, 'Name'),
      birthday: validateBirthdayField(birthday),
      email: validateEmailField(email),
      password: validatePasswordField(password),
      confirmPassword: validateConfirmPassword(password, confirmPassword),
    };
    setErrors(nextErrors);
    return Object.values(nextErrors).every((error) => !error);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    if (!validate()) return;

    setSubmitting(true);
    const result = await signUp(name, email, password, role, birthday);
    setSubmitting(false);

    if (!result.success) {
      setFormError(result.error ?? 'Something went wrong. Please try again.');
      return;
    }
    navigate('/onboarding/name', { replace: true });
  };

  return (
    <AuthShell
      authMode="signup"
      title="Create your account"
      subtitle="Join ArtGuard Hub to start protecting and managing commissions."
      markIcon="user"
      onBack={() => navigate('/login')}
    >
      {formError && (
        <div className="auth-banner error">
          <Icon name="alert" style={{ stroke: 'var(--ag-danger)' }} />
          <span>{formError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <AuthInput
          label="Full name"
          icon="user"
          type="text"
          value={name}
          onChange={(v) => {
            setName(v);
            if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
          }}
          placeholder="Maren Oyelaran"
          autoComplete="name"
          name="name"
          error={errors.name}
        />
        <AuthInput
          label="Birthday"
          icon="calendar"
          type="date"
          value={birthday}
          onChange={(v) => {
            setBirthday(v);
            if (errors.birthday) setErrors((prev) => ({ ...prev, birthday: undefined }));
          }}
          autoComplete="bday"
          name="birthday"
          error={errors.birthday}
          required
          max={maxBirthday}
        />
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
          placeholder="At least 8 characters"
          autoComplete="new-password"
          name="password"
          error={errors.password}
        />
        <section className="password-guidance" aria-label="Password requirements">
          <div className="password-strength-row">
            <span className="password-guidance-title">Password strength</span>
            {password ? (
              <span className={`password-strength-label is-${passwordAssessment.strength}`} aria-live="polite">
                {passwordAssessment.strength[0].toUpperCase() + passwordAssessment.strength.slice(1)}
              </span>
            ) : (
              <span className="password-guidance-hint">Start typing</span>
            )}
          </div>
          <div
            className={`password-strength-meter${password ? ` is-${passwordAssessment.strength}` : ''}`}
            role="img"
            aria-label={password ? `Password strength: ${passwordAssessment.strength}` : 'Password strength not yet assessed'}
          >
            <span />
            <span />
            <span />
          </div>
          <ul className="password-requirements">
            {passwordAssessment.requirements.map((requirement) => (
              <li key={requirement.id} className={requirement.satisfied ? 'is-met' : ''}>
                <span className="password-requirement-mark" aria-hidden="true">
                  {requirement.satisfied ? '✓' : ''}
                </span>
                <span>{requirement.label}</span>
              </li>
            ))}
          </ul>
          <p className="password-guidance-hint">Use 12+ characters for Strong. Avoid common words and patterns.</p>
        </section>
        <AuthInput
          label="Confirm password"
          icon="lock"
          type="password"
          value={confirmPassword}
          onChange={(v) => {
            setConfirmPassword(v);
            if (errors.confirmPassword) setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
          }}
          placeholder="Re-enter your password"
          autoComplete="new-password"
          name="confirmPassword"
          error={errors.confirmPassword}
        />

        <RoleToggle value={role} onChange={setRole} />

        <AuthButton type="submit" loading={submitting} style={{ marginTop: 8, marginBottom: 18 }}>
          Create Account
        </AuthButton>
      </form>

      <p className="t-xs c-low auth-footnote">
        Already have an account?{' '}
        <button type="button" className="auth-link-btn t-xs" onClick={() => navigate('/login')}>
          Log in
        </button>
      </p>
    </AuthShell>
  );
}
