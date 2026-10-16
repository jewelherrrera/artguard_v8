import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthResult, AuthUser, MockAccount, UserRole } from '../types/auth';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { getMyProfile, ensureMyProfile, usernameFromEmail } from '../lib/supabaseData';

const ACCOUNTS_KEY = 'artguard.mockAccounts';
const SESSION_KEY = 'artguard.session';
const MOCK_LATENCY_MS = 650;
type ProfileUpdatePatch = Partial<Omit<AuthUser, 'isPro'>>;

function delay<T>(value: T, ms = MOCK_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function readAccounts(): MockAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? (JSON.parse(raw) as MockAccount[]) : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: MockAccount[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function toPublicUser(account: MockAccount): AuthUser {
  const { password: _password, dateOfBirth: _dateOfBirth, ...publicUser } = account;
  return publicUser;
}

const mockApi = {
  async signUp(
    name: string,
    email: string,
    password: string,
    role: UserRole,
    dateOfBirth: string,
  ): Promise<AuthResult & { user?: AuthUser }> {
    const accounts = readAccounts();
    const normalizedEmail = email.trim().toLowerCase();
    if (accounts.some((a) => a.email.toLowerCase() === normalizedEmail)) {
      return delay({ success: false, error: 'An account with that email already exists.' });
    }
    const account: MockAccount = {
      id: `usr_${Date.now().toString(36)}`,
      name: name.trim(),
      email: normalizedEmail,
      username: usernameFromEmail(normalizedEmail),
      role,
      createdAt: new Date().toISOString(),
      dateOfBirth,
      password,
    };
    writeAccounts([...accounts, account]);
    return delay({ success: true, user: toPublicUser(account) });
  },
  async login(email: string, password: string): Promise<AuthResult & { user?: AuthUser }> {
    const accounts = readAccounts();
    const normalizedEmail = email.trim().toLowerCase();
    const account = accounts.find((a) => a.email.toLowerCase() === normalizedEmail);
    if (!account) return delay({ success: false, error: 'No account found with that email.' });
    if (account.password !== password) return delay({ success: false, error: 'Incorrect password. Try again.' });
    return delay({ success: true, user: toPublicUser(account) });
  },
  async requestPasswordReset(email: string): Promise<AuthResult> {
    void readAccounts().some((a) => a.email.toLowerCase() === email.trim().toLowerCase());
    return delay({ success: true });
  },
  async updateProfile(userId: string, patch: Partial<AuthUser>): Promise<AuthResult & { user?: AuthUser }> {
    const accounts = readAccounts();
    const index = accounts.findIndex((a) => a.id === userId);
    if (index === -1) return delay({ success: false, error: 'Account not found.' }, 150);
    const updated: MockAccount = { ...accounts[index], ...patch };
    const nextAccounts = [...accounts];
    nextAccounts[index] = updated;
    writeAccounts(nextAccounts);
    return delay({ success: true, user: toPublicUser(updated) }, 150);
  },
};

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  initializing: boolean;
  backendMode: 'supabase' | 'mock';
  login: (email: string, password: string) => Promise<AuthResult>;
  signUp: (name: string, email: string, password: string, role: UserRole, dateOfBirth: string) => Promise<AuthResult>;
  changeEmail: (email: string) => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  passwordRecoverySession: boolean;
  clearPasswordRecoverySession: () => void;
  updateProfile: (patch: ProfileUpdatePatch) => Promise<AuthResult>;
  enableMockPremium: () => Promise<AuthResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function publicUserFromSession(authUser: { id: string; email?: string | null; created_at?: string; user_metadata?: Record<string, unknown> }): Promise<AuthUser> {
  let profile = null;
  try {
    profile = await getMyProfile(authUser.id);
  } catch (error) {
    // Do not blank the app if the profile row is briefly unavailable right after signup.
    console.warn('ArtGuard: profile lookup failed; using auth metadata for now.', error);
  }

  return {
    id: authUser.id,
    name: (profile?.name ?? authUser.user_metadata?.name ?? authUser.email?.split('@')[0] ?? 'User') as string,
    email: authUser.email ?? '',
    username: profile?.username ?? usernameFromEmail(authUser.email),
    role: ((profile?.role ?? authUser.user_metadata?.role ?? 'client') as UserRole),
    createdAt: authUser.created_at,
    bio: profile?.bio ?? undefined,
    interests: profile?.interests ?? undefined,
    avatarDataUrl: profile?.avatar_data_url ?? undefined,
    onboarded: Boolean(profile?.onboarded ?? authUser.user_metadata?.onboarded),
    isPro: Boolean(profile?.is_pro),
    lastSeenAt: profile?.last_seen_at ?? undefined,
    artistVerificationStatus: profile?.artist_verification_status ?? undefined,
    artistVerificationSubmittedAt: profile?.artist_verification_submitted_at ?? undefined,
    artistVerificationReviewedAt: profile?.artist_verification_reviewed_at ?? undefined,
    artistVerificationReviewedBy: profile?.artist_verification_reviewed_by ?? undefined,
    artistVerificationRejectionReason: profile?.artist_verification_rejection_reason ?? undefined,
    artistVerificationArtworkId: profile?.artist_verification_artwork_id ?? undefined,
    isAdmin: Boolean(profile?.is_admin),
  };
}

async function refreshProfileForUser(userId: string, fallback: AuthUser): Promise<AuthUser> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const profile = await getMyProfile(userId);
      if (profile) {
        return {
          ...fallback,
          name: profile.name ?? fallback.name,
          username: profile.username ?? fallback.username,
          role: profile.role ?? fallback.role,
          bio: profile.bio ?? undefined,
          interests: profile.interests ?? undefined,
          avatarDataUrl: profile.avatar_data_url ?? undefined,
          onboarded: Boolean(profile.onboarded),
          isPro: Boolean(profile.is_pro),
          lastSeenAt: profile.last_seen_at ?? undefined,
          artistVerificationStatus: profile.artist_verification_status ?? undefined,
          artistVerificationSubmittedAt: profile.artist_verification_submitted_at ?? undefined,
          artistVerificationReviewedAt: profile.artist_verification_reviewed_at ?? undefined,
          artistVerificationReviewedBy: profile.artist_verification_reviewed_by ?? undefined,
          artistVerificationRejectionReason: profile.artist_verification_rejection_reason ?? undefined,
          artistVerificationArtworkId: profile.artist_verification_artwork_id ?? undefined,
          isAdmin: Boolean(profile.is_admin),
        };
      }
    } catch (error) {
      if (attempt === 3) console.warn('ArtGuard: profile refresh failed.', error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [passwordRecoverySession, setPasswordRecoverySession] = useState(false);
  const authStateRevision = useRef(0);

  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured || !supabase) {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) setUser(JSON.parse(raw) as AuthUser);
      } finally {
        setInitializing(false);
      }
      return;
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') return;
      const revision = ++authStateRevision.current;
      if (!session?.user) {
        if (event === 'SIGNED_OUT') {
          setPasswordRecoverySession(false);
        }
        setUser(null);
        if (event === 'INITIAL_SESSION') setInitializing(false);
        return;
      }
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoverySession(true);
        setInitializing(false);
      } else if (event === 'SIGNED_IN') {
        setPasswordRecoverySession(false);
      }
      void publicUserFromSession(session.user).then((next) => {
        if (!active || revision !== authStateRevision.current) return;
        setUser(next);
        if (event === 'INITIAL_SESSION') setInitializing(false);
        void refreshProfileForUser(session.user.id, next).then((refreshed) => {
          if (active && revision === authStateRevision.current) setUser(refreshed);
        });
      }).catch((error) => {
        if (active && revision === authStateRevision.current) {
          if (event === 'INITIAL_SESSION') setInitializing(false);
          console.error('ArtGuard: auth state update failed', error);
        }
      });
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const persistSession = useCallback((nextUser: AuthUser | null) => {
    setUser(nextUser);
    if (!isSupabaseConfigured) {
      if (nextUser) localStorage.setItem(SESSION_KEY, JSON.stringify(nextUser));
      else localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured || !supabase) {
      const result = await mockApi.login(email, password);
      if (result.success && result.user) persistSession(result.user);
      return { success: result.success, error: result.error };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.user) return { success: false, error: error?.message ?? 'Unable to sign in.' };
      const fallbackUser = await publicUserFromSession(data.user);
      try {
        await ensureMyProfile({
          id: data.user.id,
          name: String(data.user.user_metadata?.name ?? data.user.email?.split('@')[0] ?? fallbackUser.name ?? 'User'),
          username: usernameFromEmail(data.user.email),
          role: ((data.user.user_metadata?.role ?? fallbackUser.role ?? 'client') as UserRole),
          onboarded: Boolean(data.user.user_metadata?.onboarded ?? fallbackUser.onboarded),
        });
      } catch (profileError) {
        console.warn('ArtGuard: profile repair during login skipped.', profileError);
      }
      persistSession(fallbackUser);
      return { success: true };
    } catch (error) {
      const message = error instanceof TypeError && /fetch/i.test(error.message)
        ? 'Could not reach Supabase. Check your VITE_SUPABASE_URL, Publishable Key, internet connection, and restart the Vite server.'
        : error instanceof Error ? error.message : 'Unable to sign in.';
      return { success: false, error: message };
    }
  }, [persistSession]);

  const signUp = useCallback(async (name: string, email: string, password: string, role: UserRole, dateOfBirth: string) => {
    if (!isSupabaseConfigured || !supabase) {
      const result = await mockApi.signUp(name, email, password, role, dateOfBirth);
      if (result.success && result.user) persistSession(result.user);
      return { success: result.success, error: result.error };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { name: name.trim(), role, onboarded: false, date_of_birth: dateOfBirth } },
      });
      if (error) return { success: false, error: error.message };
      if (!data.user || !data.session) {
        return { success: false, error: 'Account created. Check your email to confirm your account, then log in.' };
      }
      let fallbackUser = await publicUserFromSession(data.user);
      try {
        const profile = await ensureMyProfile({
          id: data.user.id,
          name: name.trim(),
          username: usernameFromEmail(email),
          role,
          onboarded: false,
        });
        if (profile) {
          fallbackUser = {
            ...fallbackUser,
            name: profile.name,
            role: profile.role,
            bio: profile.bio ?? undefined,
            interests: profile.interests ?? undefined,
            avatarDataUrl: profile.avatar_data_url ?? undefined,
            onboarded: Boolean(profile.onboarded),
            isPro: Boolean(profile.is_pro),
          };
        }
      } catch (profileError) {
        console.error('ArtGuard: could not create profile after signup', profileError);
      }
      persistSession(fallbackUser);
      void refreshProfileForUser(data.user.id, fallbackUser).then(persistSession);
      return { success: true };
    } catch (error) {
      const message = error instanceof TypeError && /fetch/i.test(error.message)
        ? 'Could not reach Supabase. Check your VITE_SUPABASE_URL, Publishable Key, internet connection, and restart the Vite server.'
        : error instanceof Error ? error.message : 'Unable to create account.';
      return { success: false, error: message };
    }
  }, [persistSession]);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!isSupabaseConfigured || !supabase) return mockApi.requestPasswordReset(email);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    return error ? { success: false, error: error.message } : { success: true };
  }, []);

  const clearPasswordRecoverySession = useCallback(() => {
    setPasswordRecoverySession(false);
  }, []);

  const changeEmail = useCallback(async (email: string) => {
    if (!user) return { success: false, error: 'Not signed in.' };
    const normalizedEmail = email.trim().toLowerCase();

    if (!isSupabaseConfigured || !supabase) {
      const accounts = readAccounts();
      if (accounts.some((account) => account.id !== user.id && account.email.toLowerCase() === normalizedEmail)) {
        return { success: false, error: 'An account with that email already exists.' };
      }
      const result = await mockApi.updateProfile(user.id, { email: normalizedEmail });
      if (result.success && result.user) persistSession(result.user);
      return { success: result.success, error: result.error };
    }

    try {
      const { error } = await supabase.auth.updateUser({ email: normalizedEmail });
      return error ? { success: false, error: error.message } : { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unable to change email.' };
    }
  }, [persistSession, user]);

  const updateProfile = useCallback(async (patch: ProfileUpdatePatch) => {
    if (!user) return { success: false, error: 'Not signed in.' };
    if (!isSupabaseConfigured || !supabase) {
      const result = await mockApi.updateProfile(user.id, patch);
      if (result.success && result.user) persistSession(result.user);
      return { success: result.success, error: result.error };
    }

    const dbPatch = {
      name: patch.name,
      username: patch.username,
      bio: patch.bio,
      interests: patch.interests,
      avatar_data_url: patch.avatarDataUrl,
    };
    const { error } = await supabase.from('profiles').update(dbPatch).eq('id', user.id);
    if (error) return { success: false, error: error.message };
    const { error: metadataError } = await supabase.auth.updateUser({
      data: {
        name: patch.name ?? user.name,
        role: patch.role ?? user.role,
        onboarded: patch.onboarded ?? user.onboarded ?? false,
      },
    });
    if (metadataError) return { success: false, error: metadataError.message };
    const realPatch = { ...patch } as Partial<AuthUser>;
    delete realPatch.isPro;
    const refreshed = { ...user, ...realPatch };
    persistSession(refreshed);
    return { success: true };
  }, [persistSession, user]);

  const enableMockPremium = useCallback(async () => {
    if (!user) return { success: false, error: 'Not signed in.' };
    if (isSupabaseConfigured && supabase) {
      return { success: false, error: 'Premium subscriptions are not available yet.' };
    }
    const result = await mockApi.updateProfile(user.id, { isPro: true });
    if (result.success && result.user) persistSession(result.user);
    return { success: result.success, error: result.error };
  }, [persistSession, user]);

  const logout = useCallback(() => {
    authStateRevision.current += 1;
    clearPasswordRecoverySession();
    if (isSupabaseConfigured && supabase) void supabase.auth.signOut();
    persistSession(null);
  }, [clearPasswordRecoverySession, persistSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      initializing,
      backendMode: isSupabaseConfigured ? 'supabase' : 'mock',
      login,
      signUp,
      changeEmail,
      requestPasswordReset,
      passwordRecoverySession,
      clearPasswordRecoverySession,
      updateProfile,
      enableMockPremium,
      logout,
    }),
    [user, initializing, login, signUp, changeEmail, requestPasswordReset, passwordRecoverySession, clearPasswordRecoverySession, updateProfile, enableMockPremium, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
