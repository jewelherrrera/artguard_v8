import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { SettingsRow } from './SettingsPage';
import { AuthButton } from '../components/auth/AuthButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { useMockToast } from '../components/ui/MockToast';
import { usernameFromEmail } from '../lib/supabaseData';
import { validateEmailField } from '../utils/validators';
import './AccountManagementPage.css';

type DestructiveAction = 'deactivate' | 'delete';

function ConfirmationDialog({
  action,
  onCancel,
  onConfirm,
}: {
  action: DestructiveAction;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const isDelete = action === 'delete';
  const title = isDelete ? 'Delete your account?' : 'Deactivate your account?';

  return (
    <div className="account-dialog-backdrop" role="presentation">
      <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
        <div className="account-dialog-icon">
          <Icon name="alert" />
        </div>
        <h2 id="account-dialog-title">{title}</h2>
        <p>
          {isDelete
            ? 'This permanently removes your account and associated access. This action cannot be undone.'
            : 'Deactivation should make your account unavailable while preserving a path to recovery.'}
        </p>
        <p className="account-dialog-limit">
          This action is not available until a verified backend account-management endpoint is configured. No changes will be made.
        </p>
        {isDelete && (
          <label className="field-label" htmlFor="confirm-delete">
            Type DELETE to confirm
            <input
              id="confirm-delete"
              className="account-dialog-input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </label>
        )}
        <div className="account-dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm account-danger-button"
            disabled={isDelete && typed !== 'DELETE'}
            onClick={onConfirm}
          >
            {isDelete ? 'Confirm Delete' : 'Confirm Deactivation'}
          </button>
        </div>
      </section>
    </div>
  );
}

export function AccountManagementPage() {
  const navigate = useNavigate();
  const { user, backendMode, changeEmail } = useAuth();
  const { toast, showToast } = useMockToast();
  const [email, setEmail] = useState(user?.email ?? '');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [emailSuccess, setEmailSuccess] = useState<string | undefined>();
  const [savingEmail, setSavingEmail] = useState(false);
  const [dialogAction, setDialogAction] = useState<DestructiveAction | null>(null);

  const roleLabel = user?.role === 'artist' ? 'Artist' : user?.role === 'client' ? 'Client' : '—';
  const username = user?.username || usernameFromEmail(user?.email);
  const createdLabel = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Not available';

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validateEmailField(email);
    setEmailError(validation);
    setEmailSuccess(undefined);
    if (validation) return;
    if (email.trim().toLowerCase() === user?.email.toLowerCase()) {
      setEmailError('Enter a different email address.');
      return;
    }

    setSavingEmail(true);
    const result = await changeEmail(email);
    setSavingEmail(false);
    if (!result.success) {
      setEmailError(result.error ?? 'Could not change your email address.');
      return;
    }
    setEmailSuccess(backendMode === 'supabase'
      ? 'A confirmation link was sent to your new email address. Your current email stays active until you confirm it.'
      : 'Your email address was updated.');
    if (backendMode === 'mock') showToast('Email updated');
  };

  const confirmUnavailableAction = () => {
    setDialogAction(null);
    showToast('No changes made — this account action needs a verified backend endpoint.');
  };

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between">
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate('/profile/settings')} ariaLabel="Back to Settings" />
            <span className="h-title" style={{ fontSize: 19 }}>
              Account
            </span>
          </div>
        </div>
      }
    >
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="section-title">Profile</span>
      </div>
      <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
        <SettingsRow
          icon="user"
          label="Edit Profile"
          sublabel="Name, username, bio, photo & interests"
          onClick={() => navigate('/profile/edit')}
        />
      </div>

      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="section-title">Account Info</span>
      </div>
      <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
        <SettingsRow icon="mail" label="Email" sublabel={user?.email ?? '—'} />
        <hr className="soft" style={{ margin: 0 }} />
        <SettingsRow icon="user" label="Username" sublabel={`@${username}`} />
        <hr className="soft" style={{ margin: 0 }} />
        <SettingsRow icon="shield" label="Account type" sublabel={roleLabel} />
        <hr className="soft" style={{ margin: 0 }} />
        <SettingsRow icon="calendar" label="Created" sublabel={createdLabel} />
      </div>

      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="section-title">Change Email</span>
      </div>
      <form className="card account-email-card" onSubmit={handleEmailSubmit} noValidate>
        <label className="field-label" htmlFor="account-email">
          New email address
        </label>
        <div className={`input-field${emailError ? ' is-error' : ''}`}>
          <Icon name="mail" style={{ width: 16, height: 16, stroke: 'var(--ag-text-low)' }} />
          <input
            id="account-email"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailError) setEmailError(undefined);
              if (emailSuccess) setEmailSuccess(undefined);
            }}
            autoComplete="email"
          />
        </div>
        {emailError && <div className="field-error" role="alert">{emailError}</div>}
        {emailSuccess && <div className="account-success" role="status">{emailSuccess}</div>}
        <AuthButton type="submit" loading={savingEmail} style={{ marginTop: 14 }}>
          Update Email
        </AuthButton>
      </form>

      <div className="row-between" style={{ margin: '20px 0 10px' }}>
        <span className="section-title">Danger Zone</span>
      </div>
      <div className="card account-danger-card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
        <SettingsRow
          icon="lock"
          label="Deactivate Account"
          sublabel="Temporarily disable account access"
          onClick={() => setDialogAction('deactivate')}
        />
        <hr className="soft" style={{ margin: 0 }} />
        <SettingsRow
          icon="alert"
          label="Delete Account"
          sublabel="Permanently remove your account"
          onClick={() => setDialogAction('delete')}
        />
      </div>
      {toast}
      {dialogAction && (
        <ConfirmationDialog
          action={dialogAction}
          onCancel={() => setDialogAction(null)}
          onConfirm={confirmUnavailableAction}
        />
      )}
    </ScreenShell>
  );
}
