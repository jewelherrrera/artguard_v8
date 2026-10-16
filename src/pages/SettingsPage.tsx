import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIonRouter } from '@ionic/react';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { ToggleSwitch } from '../components/ui/ToggleSwitch';
import { Icon, type IconName } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useMockToast } from '../components/ui/MockToast';
import { isSupabaseConfigured } from '../lib/supabase';
import { getMyProfile } from '../lib/supabaseData';
import { setArtistCommissionAvailability } from '../lib/supabaseArtistServices';
import './SettingsPage.css';

export function SettingsRow({
  icon,
  label,
  sublabel,
  onClick,
  trailing,
}: {
  icon: IconName;
  label: string;
  sublabel?: string;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      className={onClick ? 'settings-row tap-card row-between' : 'settings-row row-between'}
      style={{ padding: '14px 16px' }}
      onClick={onClick}
    >
      <div className="row gap-10">
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'var(--ag-settings-icon-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon name={icon} style={{ width: 16, height: 16, stroke: 'var(--ag-accent)' }} />
        </div>
        <div>
          <div className="t-sm fw-600">{label}</div>
          {sublabel && <div className="t-xs c-low">{sublabel}</div>}
        </div>
      </div>
      {trailing ?? (onClick && <Icon name="chevron-r" style={{ width: 15, height: 15, stroke: 'var(--ag-text-low)' }} />)}
    </Wrapper>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const ionRouter = useIonRouter();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toast, showToast } = useMockToast();
  const [notifications, setNotifications] = useState(true);
  const [acceptingCommissions, setAcceptingCommissions] = useState<boolean | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || user?.role !== 'artist') {
      setAcceptingCommissions(null);
      setAvailabilityLoading(false);
      setAvailabilityError(null);
      return;
    }

    let active = true;
    setAcceptingCommissions(null);
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    void getMyProfile(user.id)
      .then((profile) => {
        if (!active) return;
        if (typeof profile?.accepting_commissions !== 'boolean') {
          setAvailabilityError('Could not load commission availability.');
          return;
        }
        setAcceptingCommissions(profile.accepting_commissions);
      })
      .catch(() => {
        if (active) setAvailabilityError('Could not load commission availability.');
      })
      .finally(() => {
        if (active) setAvailabilityLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id, user?.role]);

  const handleAvailabilityChange = async (nextValue: boolean) => {
    if (acceptingCommissions === null || availabilitySaving) return;
    const previousValue = acceptingCommissions;
    setAcceptingCommissions(nextValue);
    setAvailabilitySaving(true);
    setAvailabilityError(null);
    try {
      setAcceptingCommissions(await setArtistCommissionAvailability(nextValue));
      showToast(nextValue ? 'Accepting commissions' : 'Not accepting new commissions');
    } catch {
      setAcceptingCommissions(previousValue);
      setAvailabilityError('Could not update commission availability. Please try again.');
    } finally {
      setAvailabilitySaving(false);
    }
  };

  const handleSignOut = () => {
    logout();
    // Reset Ionic's view stack. This prevents an inactive dashboard view from
    // sitting above the returned Login page and swallowing its auth links.
    ionRouter.push('/login', 'root', 'replace');
  };

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between">
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate('/profile')} ariaLabel="Back to Profile" />
            <span className="h-title" style={{ fontSize: 19 }}>
              Settings
            </span>
          </div>
        </div>
      }
    >
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="section-title">Appearance</span>
      </div>
      <div className="card" style={{ marginBottom: 20, padding: 14 }}>
        <div className="t-xs c-low" style={{ marginBottom: 10 }}>
          Choose how ArtGuard Hub looks on this device.
        </div>
        <SegmentedControl
          ariaLabel="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>

      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="section-title">Preferences</span>
      </div>
      <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
        <SettingsRow
          icon="bell"
          label="Notifications"
          sublabel={notifications ? 'On for messages & milestones' : 'Muted'}
          trailing={<ToggleSwitch checked={notifications} onChange={setNotifications} ariaLabel="Toggle notifications" />}
        />
        <hr className="soft" style={{ margin: 0 }} />
        <SettingsRow
          icon="lock"
          label="Privacy & Security"
          sublabel="Shield defaults, data & permissions"
          onClick={() => navigate('/profile/settings/privacy')}
        />
        {!user?.isAdmin && user?.role === 'artist' && (
          <>
            {isSupabaseConfigured && (
              <>
                <hr className="soft" style={{ margin: 0 }} />
                <SettingsRow
                  icon="check-circle"
                  label="Accepting Commissions"
                  sublabel={availabilityLoading
                    ? 'Loading availability…'
                    : availabilityError && acceptingCommissions === null
                      ? availabilityError
                      : acceptingCommissions
                        ? 'Accepting new commission requests'
                        : acceptingCommissions === false
                          ? 'Not accepting new commissions'
                          : 'Availability unavailable'}
                  trailing={availabilityLoading ? (
                    <span className="t-xs c-low" role="status">Loading…</span>
                  ) : acceptingCommissions === null ? (
                    <span className="t-xs c-low">Unavailable</span>
                  ) : (
                    <ToggleSwitch
                      checked={acceptingCommissions}
                      onChange={(checked) => void handleAvailabilityChange(checked)}
                      ariaLabel="Accepting Commissions"
                    />
                  )}
                />
                {availabilityError && acceptingCommissions !== null && (
                  <div className="t-xs c-danger" role="alert" style={{ padding: '0 16px 10px' }}>
                    {availabilityError}
                  </div>
                )}
                <hr className="soft" style={{ margin: 0 }} />
              </>
            )}
            {!isSupabaseConfigured && <hr className="soft" style={{ margin: 0 }} />}
            <SettingsRow
              icon="check-circle"
              label="Artist Verification"
              sublabel="Submit your artist application for review"
              onClick={() => navigate('/profile/settings/verification')}
            />
          </>
        )}
        {user?.isAdmin && (
          <>
            <hr className="soft" style={{ margin: 0 }} />
            <SettingsRow
              icon="check-circle"
              label="Artist Verification Review"
              sublabel="Review pending artist applications"
              onClick={() => navigate('/admin/artist-verifications')}
            />
          </>
        )}
        <hr className="soft" style={{ margin: 0 }} />
        <SettingsRow
          icon="crown"
          label={user?.isPro ? 'ArtGuard Pro' : 'Premium Subscription'}
          sublabel={user?.isPro ? 'Your Pro plan is active' : 'Unlock advanced shielding & 0% fees'}
          onClick={() => navigate('/profile/premium')}
        />
        <hr className="soft" style={{ margin: 0 }} />
        <SettingsRow
          icon="user"
          label="Account"
          sublabel={user?.email ?? 'Manage your account'}
          onClick={() => navigate('/profile/settings/account')}
        />
      </div>

      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="section-title">About</span>
      </div>
      <div className="card" style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
        <SettingsRow
          icon="shield"
          label="About ArtGuard Hub"
          sublabel="Version 0.1.0 (mock build)"
          onClick={() =>
            showToast('ArtGuard Hub — cloaking commissioned art from AI scrapers, one upload at a time.')
          }
        />
      </div>

      <button type="button" className="btn btn-secondary" onClick={handleSignOut}>
        <Icon name="arrow-l" style={{ width: 16, height: 16 }} />
        Sign Out
      </button>
      {toast}
    </ScreenShell>
  );
}
