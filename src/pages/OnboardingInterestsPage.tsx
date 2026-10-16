import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthButton } from '../components/auth/AuthButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { INTEREST_OPTIONS } from '../data/mockData';

/** Step 2 of post-sign-up onboarding: pick interests, then land on the Dashboard. */
export function OnboardingInterestsPage() {
  const navigate = useNavigate();
  const { updateProfile } = useAuth();
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const toggle = (interest: string) => {
    setSelected((prev) => (prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]));
  };

  const finish = async () => {
    setError(undefined);
    setSubmitting(true);
    const result = await updateProfile({ interests: selected, onboarded: true });
    setSubmitting(false);
    if (!result.success) {
      setError(result.error ?? 'Could not save your interests. Please try again.');
      return;
    }
    navigate('/home', { replace: true });
  };

  return (
    <AuthShell markIcon="star" title="What are you interested in?" subtitle="Pick a few — you can change these anytime in Settings.">
      {error && (
        <div className="auth-banner error" style={{ marginBottom: 14 }}>
          <Icon name="alert" style={{ stroke: 'var(--ag-danger)' }} />
          <span>{error}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginBottom: 24 }}>
        {INTEREST_OPTIONS.map((interest) => {
          const active = selected.includes(interest);
          return (
            <button
              key={interest}
              type="button"
              className={`chip${active ? ' chip-active' : ''}`}
              aria-pressed={active}
              onClick={() => toggle(interest)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {active && <Icon name="check-circle" style={{ width: 12, height: 12 }} />}
              {interest}
            </button>
          );
        })}
      </div>

      <AuthButton onClick={finish} loading={submitting}>
        Continue
      </AuthButton>
      <button
        type="button"
        className="auth-link-btn t-xs"
        style={{ display: 'block', margin: '14px auto 0' }}
        onClick={finish}
      >
        Skip for now
      </button>
    </AuthShell>
  );
}
