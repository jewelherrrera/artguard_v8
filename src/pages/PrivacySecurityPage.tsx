import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { SettingsRow } from './SettingsPage';
import { useAuth } from '../context/AuthContext';
import { useMockToast } from '../components/ui/MockToast';

/**
 * Privacy & Security settings.
 *
 * Only surfaces controls that are actually backed by something real:
 *  - Change Password reuses the existing `requestPasswordReset` flow
 *    (the same one ForgotPasswordPage uses) — a real email is sent.
 *  - "Where your data lives" reads the app's real `backendMode` so it
 *    never claims data is synced when it's only stored locally, or
 *    vice versa.
 * Things like profile-visibility or blocked-account controls aren't
 * wired to anything in the backend yet, so they're left out rather
 * than shown as working toggles.
 */
export function PrivacySecurityPage() {
  const navigate = useNavigate();
  const { user, backendMode, requestPasswordReset } = useAuth();
  const { toast, showToast } = useMockToast();
  const [sendingReset, setSendingReset] = useState(false);
  const [resetError, setResetError] = useState<string>();

  const handleChangePassword = async () => {
    if (!user?.email || sendingReset) return;
    setResetError(undefined);
    setSendingReset(true);
    const result = await requestPasswordReset(user.email);
    setSendingReset(false);
    if (result.success) showToast(`Password reset link sent to ${user.email}`);
    else setResetError(result.error ?? 'Could not send a password reset link. Please try again.');
  };

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between">
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate('/profile/settings')} ariaLabel="Back to Settings" />
            <span className="h-title" style={{ fontSize: 19 }}>
              Privacy &amp; Security
            </span>
          </div>
        </div>
      }
    >
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="section-title">Account Security</span>
      </div>
      <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
        <SettingsRow
          icon="lock"
          label="Change Password"
          sublabel={sendingReset ? 'Sending reset link…' : `Send a reset link to ${user?.email ?? 'your email'}`}
          onClick={handleChangePassword}
        />
      </div>
      {resetError && <div className="t-xs c-danger" role="alert" style={{ marginBottom: 20 }}>{resetError}</div>}

      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="section-title">Data</span>
      </div>
      <div className="card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
        <SettingsRow
          icon="shield"
          label="Where your data lives"
          sublabel={
            backendMode === 'supabase'
              ? 'Synced to your Supabase project'
              : 'Stored locally on this device only (mock mode)'
          }
        />
      </div>

      <p className="t-xs c-low" style={{ lineHeight: 1.6, padding: '0 4px' }}>
        Profile visibility and blocked-account controls aren&apos;t available yet — this section will grow as those
        features ship.
      </p>
      {toast}
    </ScreenShell>
  );
}
