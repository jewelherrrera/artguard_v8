import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { AuthButton } from '../components/auth/AuthButton';
import { Icon } from '../assets/icons';
import { useAuth } from '../context/AuthContext';
import { INTEREST_OPTIONS } from '../data/mockData';
import { useMockToast } from '../components/ui/MockToast';
import { validateRequired } from '../utils/validators';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function EditProfilePage() {
  const navigate = useNavigate();
  const { user, updateProfile } = useAuth();
  const { toast, showToast } = useMockToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [interests, setInterests] = useState<string[]>(user?.interests ?? []);
  const [avatarPreview, setAvatarPreview] = useState<string | undefined>(user?.avatarDataUrl);
  const [nameError, setNameError] = useState<string | undefined>();
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const isArtist = user?.role === 'artist';
  const initials = (user?.name || 'U').slice(0, 1).toUpperCase();

  const handlePhotoChange = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAvatarPreview(dataUrl);
    } catch {
      showToast("Couldn't read that image — try another file");
    }
  };

  const toggleInterest = (interest: string) => {
    setInterests((prev) => (prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]));
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const validation = validateRequired(name, 'Name');
    setNameError(validation);
    const cleanUsername = username.trim().replace(/^@+/, '').toLowerCase();
    const nextUsernameError = !cleanUsername
      ? 'Username is required.'
      : !/^[a-z0-9._-]{3,30}$/.test(cleanUsername)
        ? 'Use 3–30 letters, numbers, dots, underscores, or hyphens.'
        : undefined;
    setUsernameError(nextUsernameError);
    setSaveError(undefined);
    if (validation || nextUsernameError) return;

    setSaving(true);
    const result = await updateProfile({
      name: name.trim(),
      username: cleanUsername,
      bio: bio.trim(),
      interests,
      avatarDataUrl: avatarPreview,
    });
    setSaving(false);
    if (!result.success) {
      setSaveError(result.error ?? 'Could not save your profile. Please try again.');
      return;
    }
    showToast('Profile updated');
    navigate('/profile', { replace: true });
  };

  return (
    <ScreenShell
      header={
        <div className="px-hd row-between">
          <div className="row gap-10">
            <IconButton icon="chevron-l" onClick={() => navigate('/profile')} ariaLabel="Back to Profile" />
            <span className="h-title" style={{ fontSize: 19 }}>
              Edit Profile
            </span>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSave}>
        <input
          type="file"
          accept="image/png,image/jpeg"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={(e) => handlePhotoChange(e.target.files)}
        />
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div
            className="avatar avatar-xl"
            style={{
              margin: '0 auto 10px',
              backgroundImage: avatarPreview ? `url(${avatarPreview})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {!avatarPreview && initials}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
            <Icon name="image" style={{ width: 14, height: 14 }} />
            Change Photo
          </button>
          <p className="t-xs c-low" style={{ marginTop: 6 }}>
            Stored on this device only — not uploaded anywhere yet.
          </p>
        </div>

        <label className="field-label" htmlFor="edit-name">
          Display name
        </label>
        <div className={`input-field${nameError ? ' is-error' : ''}`} style={{ marginBottom: nameError ? 6 : 16 }}>
          <Icon name="user" style={{ width: 16, height: 16, stroke: 'var(--ag-text-low)' }} />
          <input
            id="edit-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(undefined);
            }}
            placeholder="Your name"
          />
        </div>
        {nameError && (
          <div className="field-error" style={{ marginBottom: 16 }}>
            <Icon name="alert" style={{ width: 12, height: 12, stroke: 'var(--ag-danger)' }} />
            <span>{nameError}</span>
          </div>
        )}

        <label className="field-label" htmlFor="edit-username">
          Username
        </label>
        <div className={`input-field${usernameError ? ' is-error' : ''}`} style={{ marginBottom: usernameError ? 6 : 16 }}>
          <span style={{ color: 'var(--ag-text-low)', fontSize: 14 }}>@</span>
          <input
            id="edit-username"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value.replace(/^@+/, ''));
              if (usernameError) setUsernameError(undefined);
            }}
            placeholder="your-username"
            autoComplete="username"
          />
        </div>
        {usernameError && (
          <div className="field-error" style={{ marginBottom: 16 }}>
            <Icon name="alert" style={{ width: 12, height: 12, stroke: 'var(--ag-danger)' }} />
            <span>{usernameError}</span>
          </div>
        )}

        <label className="field-label" htmlFor="edit-bio">
          {isArtist ? 'Bio' : 'Basic info'}
        </label>
        <textarea
          id="edit-bio"
          className="textarea-field"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder={isArtist ? 'Tell clients about your style and process…' : 'A little about you…'}
          rows={4}
          style={{ marginBottom: 20 }}
        />

        {isArtist && (
          <>
            <label className="field-label">Interests</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
              {INTEREST_OPTIONS.map((interest) => {
                const active = interests.includes(interest);
                return (
                  <button
                    key={interest}
                    type="button"
                    className={`chip${active ? ' chip-active' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggleInterest(interest)}
                  >
                    {interest}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <AuthButton type="submit" loading={saving} style={{ marginBottom: 10 }}>
          Save Changes
        </AuthButton>
        {saveError && (
          <div className="field-error" role="alert" style={{ marginBottom: 12 }}>
            <Icon name="alert" style={{ width: 12, height: 12, stroke: 'var(--ag-danger)' }} />
            <span>{saveError}</span>
          </div>
        )}
      </form>
      {toast}
    </ScreenShell>
  );
}
