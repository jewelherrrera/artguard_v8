import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ScreenShell } from '../components/ui/ScreenShell';
import { IconButton } from '../components/ui/IconButton';
import { useChat } from '../context/ChatContext';
import { getPublicProfile, relativeTimeLabel, type PublicProfile } from '../lib/supabaseData';
import { isSupabaseConfigured } from '../lib/supabase';
import { useMockToast } from '../components/ui/MockToast';
import { Icon } from '../assets/icons';
import { isVerifiedArtistStatus } from '../types/auth';

export function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { startConversation, getUserPresence } = useChat();
  const { toast, showToast } = useMockToast();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    if (!userId || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    void getPublicProfile(userId).then((result) => {
      if (active) setProfile(result);
    }).catch(() => {
      if (active) setProfile(null);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [userId]);

  if (loading) {
    return (
      <ScreenShell header={<div className="px-hd"><IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" /></div>}>
        <div className="card t-sm c-mid" style={{ textAlign: 'center', padding: 24 }}>Loading profile…</div>
      </ScreenShell>
    );
  }

  if (!profile) {
    return (
      <ScreenShell header={<div className="px-hd"><IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" /></div>}>
        <div className="card t-sm c-mid" style={{ textAlign: 'center', padding: 24 }}>User profile not found.</div>
      </ScreenShell>
    );
  }

  const presence = getUserPresence(profile);
  const initials = profile.name.slice(0, 2).toUpperCase();

  const handleMessage = async () => {
    const conversationId = await startConversation(profile.id);
    if (conversationId) navigate(`/chat/${conversationId}`);
    else showToast('Could not start the conversation. Please try again.');
  };

  return (
    <ScreenShell
      header={<div className="px-hd row-between"><IconButton icon="chevron-l" onClick={() => navigate(-1)} ariaLabel="Back" /><span className="h-title">Profile</span><span style={{ width: 38 }} /></div>}
    >
      <div style={{ textAlign: 'center', paddingTop: 12, marginBottom: 22 }}>
        <div className="avatar avatar-xl" style={{ margin: '0 auto 12px', background: 'var(--ag-grad-accent)', backgroundImage: profile.avatar_data_url ? `url(${profile.avatar_data_url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
          {!profile.avatar_data_url && initials}
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 7 }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{profile.name}</span>
          {profile.role === 'artist' && isVerifiedArtistStatus(profile.artist_verification_status) && (
            <Icon name="check-circle" style={{ width: 15, height: 15, stroke: 'var(--ag-sky)' }} aria-label="Verified Artist" />
          )}
        </div>
        <div className="t-sm c-low" style={{ marginTop: 3 }}>@{profile.username}</div>
        <div className="row" style={{ justifyContent: 'center', gap: 7, marginTop: 8 }}>
          <span className={`presence-dot-inline presence-${presence.presence}`} />
          <span className="t-xs c-low">{presence.presence === 'online' ? 'Active now' : relativeTimeLabel(profile.last_seen_at)}</span>
          <span className="t-xs c-low">· {profile.role === 'artist' ? 'Artist' : 'Client'}</span>
        </div>
      </div>

      {profile.bio && <div className="card" style={{ marginBottom: 16 }}><div className="t-xs c-mid" style={{ lineHeight: 1.65 }}>{profile.bio}</div></div>}

      {profile.interests?.length ? (
        <div style={{ marginBottom: 18 }}>
          <div className="section-title" style={{ marginBottom: 9 }}>Interests</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{profile.interests.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>
        </div>
      ) : null}

      <button type="button" className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }} onClick={() => void handleMessage()}>
        <Icon name="chat" style={{ width: 16, height: 16, stroke: '#fff' }} />
        Message @{profile.username}
      </button>
      {toast}
    </ScreenShell>
  );
}
