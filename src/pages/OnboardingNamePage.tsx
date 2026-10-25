import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/auth/AuthShell';
import { AuthInput } from '../components/auth/AuthInput';
import { AuthButton } from '../components/auth/AuthButton';
import { useAuth } from '../context/AuthContext';
import { validateRequired } from '../utils/validators';
import {
  logAuthInteractionDiagnostic,
  recordAuthDiagnosticDestinationReached,
  recordAuthDiagnosticNavigation,
} from '../utils/authInteractionDiagnostics';

/** Step 1 of post-sign-up onboarding: confirm/edit display name. */
export function OnboardingNamePage() {
  const navigate = useNavigate();
  const { user, updateProfile } = useAuth();

  const [name, setName] = useState(user?.name ?? '');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    recordAuthDiagnosticDestinationReached('/onboarding/name');
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validation = validateRequired(name, 'Name');
    setError(validation);
    if (validation) return;

    setSubmitting(true);
    const result = await updateProfile({ name: name.trim() });
    setSubmitting(false);
    if (!result.success) {
      setError(result.error ?? 'Could not save your profile. Please try again.');
      return;
    }
    logAuthInteractionDiagnostic('onboarding.step.completed', { destination: '/onboarding/interests' });
    recordAuthDiagnosticNavigation('/onboarding/interests', 'react-router-useNavigate');
    navigate('/onboarding/interests');
  };

  return (
    <AuthShell markIcon="user" title="What should we call you?" subtitle="This is how you'll appear across ArtGuard Hub.">
      <form onSubmit={handleSubmit} noValidate>
        <AuthInput
          label="Display name"
          icon="user"
          type="text"
          value={name}
          onChange={(v) => {
            setName(v);
            if (error) setError(undefined);
          }}
          placeholder="Your name"
          autoComplete="name"
          name="displayName"
          error={error}
        />
        <AuthButton type="submit" loading={submitting} style={{ marginTop: 8 }}>
          Continue
        </AuthButton>
      </form>
    </AuthShell>
  );
}
