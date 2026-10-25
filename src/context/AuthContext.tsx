import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import type { AuthResult, AuthUser, MockAccount, UserRole } from '../types/auth';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { getMyProfile, ensureMyProfile, usernameFromEmail } from '../lib/supabaseData';
import { validatePasswordField } from '../utils/validators';
import {
  installAuthInteractionDiagnostics,
  logAuthInteractionDiagnostic,
  updateAuthInteractionDiagnosticState,
} from '../utils/authInteractionDiagnostics';

const ACCOUNTS_KEY = 'artguard.mockAccounts';
const SESSION_KEY = 'artguard.session';
const MOCK_LATENCY_MS = 650;
type ProfileUpdatePatch = Partial<Omit<AuthUser, 'isPro'>>;
type AuthOperation = 'login' | 'signup' | 'oauth';
type AuthenticatedDestination = '/home' | '/onboarding/name' | '/onboarding/interests';
const GOOGLE_SIGNUP_INTENT_KEY = 'artguard.googleSignupIntent';
const GOOGLE_NAME_ONBOARDING_KEY = 'artguard.googleNameOnboarding';

export interface GoogleSignupIntent {
  role: UserRole;
  startedAt: number;
  userId?: string;
  step?: 'name' | 'interests';
}

function clearGoogleSignupIntent() {
  try {
    sessionStorage.removeItem(GOOGLE_SIGNUP_INTENT_KEY);
  } catch {
    // Session storage may be unavailable in restrictive browser modes.
  }
}

function googleDisplayName(authUser: SupabaseAuthUser): string | undefined {
  for (const key of ['full_name', 'name']) {
    const value = authUser.user_metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function storeGoogleNameOnboarding(userId: string, name: string) {
  try {
    sessionStorage.setItem(GOOGLE_NAME_ONBOARDING_KEY, JSON.stringify({ userId, name }));
  } catch {
    console.warn('ArtGuard: could not preserve Google name onboarding state for refresh.');
  }
}

function clearGoogleNameOnboarding() {
  try {
    sessionStorage.removeItem(GOOGLE_NAME_ONBOARDING_KEY);
  } catch {
    // Session storage may be unavailable in restrictive browser modes.
  }
}

export function updateGoogleSignupIntent(
  userId: string,
  update: Partial<Pick<GoogleSignupIntent, 'step'>>,
) {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(GOOGLE_SIGNUP_INTENT_KEY) ?? 'null');
    if (
      typeof stored === 'object'
      && stored !== null
      && 'userId' in stored
      && stored.userId === userId
    ) {
      sessionStorage.setItem(GOOGLE_SIGNUP_INTENT_KEY, JSON.stringify({ ...stored, ...update }));
    }
  } catch {
    console.warn('ArtGuard: could not update Google signup recovery state.');
  }
}

export function completeGoogleSignupOnboarding(userId: string) {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(GOOGLE_SIGNUP_INTENT_KEY) ?? 'null');
    if (
      typeof stored === 'object'
      && stored !== null
      && 'userId' in stored
      && stored.userId === userId
    ) {
      clearGoogleSignupIntent();
      clearGoogleNameOnboarding();
    }
  } catch {
    console.warn('ArtGuard: could not clear completed Google signup recovery state.');
  }
}

interface AuthErrorMetadata {
  code?: string;
  name?: string;
  status?: number;
}

function getAuthErrorMetadata(error: unknown): AuthErrorMetadata {
  if (typeof error !== 'object' || error === null) return {};
  const value = error as Record<string, unknown>;
  return {
    ...(typeof value.code === 'string' ? { code: value.code.toLowerCase() } : {}),
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.status === 'number' ? { status: value.status } : {}),
  };
}

function safeAuthErrorMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error) || typeof error.message !== 'string') {
    return undefined;
  }
  return error.message
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[redacted-id]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .slice(0, 240);
}

function logAuthRequestFailure(operation: AuthOperation, error: unknown) {
  const { code, status } = getAuthErrorMetadata(error);
  console.warn('ArtGuard: authentication request failed.', {
    operation,
    code: code ?? 'unknown',
    status: status ?? null,
  });
}

function getAuthErrorMessage(error: unknown, operation: AuthOperation): string {
  const { code, name, status } = getAuthErrorMetadata(error);

  if (operation === 'login' && code === 'invalid_credentials') return 'Invalid email or password.';
  if (operation === 'login' && code === 'email_not_confirmed') {
    return 'Please confirm your email before signing in.';
  }
  if (operation === 'signup' && ['email_exists', 'user_already_exists', 'user_already_registered'].includes(code ?? '')) {
    return 'An account with this email may already exist. Try signing in or resetting your password.';
  }
  if (status === 429 || ['over_request_rate_limit', 'over_email_send_rate_limit', 'rate_limit_exceeded', 'too_many_requests'].includes(code ?? '')) {
    return 'Too many attempts. Please wait a little before trying again.';
  }
  if (
    code === 'network_error' ||
    name === 'AuthRetryableFetchError' ||
    (error instanceof TypeError && /fetch|network/i.test(error.message))
  ) {
    return 'Unable to connect. Check your connection and try again.';
  }
  return operation === 'login'
    ? 'Unable to sign in right now. Please try again.'
    : 'Unable to create your account right now. Please try again.';
}

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
  signUp: (name: string, email: string, password: string, role: UserRole) => Promise<AuthResult>;
  startGoogleSignIn: (role?: UserRole) => Promise<AuthResult>;
  completeGoogleSignIn: (intent?: GoogleSignupIntent) => Promise<AuthResult & { destination?: AuthenticatedDestination }>;
  changeEmail: (email: string) => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  passwordRecoverySession: boolean;
  clearPasswordRecoverySession: () => void;
  updateProfile: (patch: ProfileUpdatePatch) => Promise<AuthResult>;
  enableMockPremium: () => Promise<AuthResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  created_at?: string;
  user_metadata?: Record<string, unknown>;
};

function authUserFromMetadata(authUser: SupabaseAuthUser): AuthUser {
  const metadataName = authUser.user_metadata?.full_name ?? authUser.user_metadata?.name;
  const metadataRole = authUser.user_metadata?.role;
  return {
    id: authUser.id,
    name: typeof metadataName === 'string' && metadataName.trim()
      ? metadataName
      : authUser.email?.split('@')[0] ?? 'User',
    email: authUser.email ?? '',
    username: usernameFromEmail(authUser.email),
    role: metadataRole === 'artist' ? 'artist' : 'client',
    createdAt: authUser.created_at,
    onboarded: Boolean(authUser.user_metadata?.onboarded),
  };
}

async function publicUserFromSession(authUser: SupabaseAuthUser): Promise<AuthUser> {
  const fallback = authUserFromMetadata(authUser);
  let profile = null;
  try {
    profile = await getMyProfile(authUser.id);
  } catch (error) {
    // Do not blank the app if the profile row is briefly unavailable right after signup.
    console.warn('ArtGuard: profile lookup failed; using auth metadata for now.', error);
  }

  return {
    ...fallback,
    name: profile?.name ?? fallback.name,
    username: profile?.username ?? fallback.username,
    role: profile?.role ?? fallback.role,
    bio: profile?.bio ?? undefined,
    interests: profile?.interests ?? undefined,
    avatarDataUrl: profile?.avatar_data_url ?? undefined,
    onboarded: Boolean(profile?.onboarded ?? fallback.onboarded),
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
    updateAuthInteractionDiagnosticState({
      initializing,
      hasUser: Boolean(user),
      isAuthenticated: Boolean(user),
      supabaseConfigured: isSupabaseConfigured,
    });
  }, [initializing, user]);

  useEffect(() => installAuthInteractionDiagnostics(), []);

  useEffect(() => {
    let active = true;
    logAuthInteractionDiagnostic('auth.initialization.started', {
      initializing: true,
      hasUser: false,
      isAuthenticated: false,
      supabaseConfigured: isSupabaseConfigured,
    });
    if (!isSupabaseConfigured || !supabase) {
      let hasUser = false;
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
          setUser(JSON.parse(raw) as AuthUser);
          hasUser = true;
        }
      } finally {
        setInitializing(false);
        logAuthInteractionDiagnostic('auth.initialization.completed', {
          initializing: false,
          hasUser,
          isAuthenticated: hasUser,
          supabaseConfigured: false,
        });
      }
      return;
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      logAuthInteractionDiagnostic('auth.state.changed', {
        eventType: event,
        hasUser: Boolean(session?.user),
        initializing,
        isAuthenticated: Boolean(session?.user),
        supabaseConfigured: true,
      });
      if (event === 'TOKEN_REFRESHED') return;
      const revision = ++authStateRevision.current;
      if (!session?.user) {
        if (event === 'SIGNED_OUT') {
          setPasswordRecoverySession(false);
        }
        setUser(null);
        if (event === 'INITIAL_SESSION') {
          setInitializing(false);
          logAuthInteractionDiagnostic('auth.initialization.completed', {
            eventType: event,
            initializing: false,
            hasUser: false,
            isAuthenticated: false,
            supabaseConfigured: true,
          });
        }
        return;
      }
      if (window.location.pathname === '/auth/callback') return;
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoverySession(true);
      } else if (event === 'SIGNED_IN') {
        setPasswordRecoverySession(false);
      }
      window.setTimeout(() => {
        void publicUserFromSession(session.user).then((next) => {
          if (!active || revision !== authStateRevision.current) return;
          setUser(next);
          if (event === 'INITIAL_SESSION') {
            setInitializing(false);
            logAuthInteractionDiagnostic('auth.initialization.completed', {
              eventType: event,
              initializing: false,
              hasUser: true,
              isAuthenticated: true,
              supabaseConfigured: true,
            });
          }
          void refreshProfileForUser(session.user.id, next).then((refreshed) => {
            if (active && revision === authStateRevision.current) setUser(refreshed);
          });
        }).catch((error) => {
          if (active && revision === authStateRevision.current) {
            if (event === 'INITIAL_SESSION') {
              setInitializing(false);
              logAuthInteractionDiagnostic('auth.initialization.failed', {
                eventType: event,
                initializing: false,
                hasUser: true,
                isAuthenticated: true,
                supabaseConfigured: true,
              });
            } else {
              logAuthInteractionDiagnostic('auth.state.hydration-failed', {
                eventType: event,
                hasUser: true,
                isAuthenticated: true,
                supabaseConfigured: true,
              });
            }
            console.error('ArtGuard: auth state update failed', error);
          }
        });
      }, 0);
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
      const error = result.error === 'No account found with that email.'
        ? "This account doesn't exist. Create an account first."
        : result.error;
      return { success: result.success, error };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        logAuthRequestFailure('login', error);
        return { success: false, error: getAuthErrorMessage(error, 'login') };
      }
      if (!data.user) return { success: false, error: 'Unable to sign in right now. Please try again.' };
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
      logAuthRequestFailure('login', error);
      return { success: false, error: getAuthErrorMessage(error, 'login') };
    }
  }, [persistSession]);

  const signUp = useCallback(async (name: string, email: string, password: string, role: UserRole) => {
    const passwordError = validatePasswordField(password);
    if (passwordError) return { success: false, error: passwordError };

    if (!isSupabaseConfigured || !supabase) {
      const result = await mockApi.signUp(name, email, password, role);
      if (result.success && result.user) persistSession(result.user);
      const error = result.error === 'An account with that email already exists.'
        ? 'An account with this email may already exist. Try signing in or resetting your password.'
        : result.error;
      return { success: result.success, error };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { name: name.trim(), role, onboarded: false } },
      });
      if (error) {
        logAuthRequestFailure('signup', error);
        return { success: false, error: getAuthErrorMessage(error, 'signup') };
      }
      if (!data.user || !data.session) {
        return {
          success: false,
          error: "Check your email for confirmation instructions. If you don't receive one, try signing in or resetting your password.",
        };
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
      logAuthRequestFailure('signup', error);
      return { success: false, error: getAuthErrorMessage(error, 'signup') };
    }
  }, [persistSession]);

  const startGoogleSignIn = useCallback(async (role?: UserRole): Promise<AuthResult> => {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Google sign-in requires a configured Supabase connection.' };
    }
    if (Capacitor.isNativePlatform()) {
      return { success: false, error: 'Google sign-in on the native app is not configured yet. Please use the web app.' };
    }

    if (role) {
      try {
        const stored: unknown = JSON.parse(sessionStorage.getItem(GOOGLE_SIGNUP_INTENT_KEY) ?? 'null');
        const hasPendingSignup = typeof stored === 'object'
          && stored !== null
          && 'role' in stored
          && (stored.role === 'artist' || stored.role === 'client')
          && 'startedAt' in stored
          && typeof stored.startedAt === 'number'
          && Number.isFinite(stored.startedAt);
        if (!hasPendingSignup) {
          const intent: GoogleSignupIntent = { role, startedAt: Date.now() };
          sessionStorage.setItem(GOOGLE_SIGNUP_INTENT_KEY, JSON.stringify(intent));
        }
      } catch {
        return { success: false, error: 'Unable to start Google sign-in. Please enable session storage and try again.' };
      }
    } else {
      try {
        const stored: unknown = JSON.parse(sessionStorage.getItem(GOOGLE_SIGNUP_INTENT_KEY) ?? 'null');
        const hasBoundPendingSignup = typeof stored === 'object'
          && stored !== null
          && 'userId' in stored
          && typeof stored.userId === 'string';
        if (!hasBoundPendingSignup) clearGoogleSignupIntent();
      } catch {
        clearGoogleSignupIntent();
      }
    }

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        logAuthRequestFailure('oauth', error);
        return { success: false, error: 'Unable to start Google sign-in. Please try again.' };
      }
      return { success: true };
    } catch (error) {
      logAuthRequestFailure('oauth', error);
      return {
        success: false,
        error: error instanceof TypeError && /fetch|network/i.test(error.message)
          ? 'Unable to connect. Check your connection and try again.'
          : 'Unable to start Google sign-in. Please try again.',
      };
    }
  }, []);

  const completeGoogleSignIn = useCallback(async (
    intent?: GoogleSignupIntent,
  ): Promise<AuthResult & { destination?: AuthenticatedDestination }> => {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Google sign-in requires a configured Supabase connection.' };
    }

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        if (sessionError) logAuthRequestFailure('oauth', sessionError);
        return { success: false, error: 'Unable to complete Google sign-in. Please try again.' };
      }
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user || data.user.id !== sessionData.session.user.id) {
        if (error) logAuthRequestFailure('oauth', error);
        return { success: false, error: 'Unable to verify your Google account. Please try again.' };
      }

      const authUser = data.user;
      const createdAt = Date.parse(authUser.created_at);
      const isBoundSignupIntent = intent?.userId === authUser.id;
      const canBindSignupIntent = intent !== undefined
        && intent.userId === undefined
        && Number.isFinite(createdAt)
        && createdAt >= intent.startedAt;
      const isNewGoogleAccount = isBoundSignupIntent || canBindSignupIntent;
      const signupStep = isNewGoogleAccount ? intent?.step ?? 'name' : undefined;
      if (intent && !isNewGoogleAccount) {
        clearGoogleSignupIntent();
        clearGoogleNameOnboarding();
      }
      if (canBindSignupIntent && intent) {
        intent.userId = authUser.id;
        intent.step = 'name';
        try {
          sessionStorage.setItem(GOOGLE_SIGNUP_INTENT_KEY, JSON.stringify(intent));
        } catch {
          console.warn('ArtGuard: could not bind Google signup recovery state.');
        }
      }
      let existingProfile;
      try {
        existingProfile = await getMyProfile(authUser.id);
      } catch (error) {
        logAuthRequestFailure('oauth', error);
        return { success: false, error: 'Unable to load your profile. Check your connection and try again.' };
      }
      const metadataName = googleDisplayName(authUser);
      const metadataRole = authUser.user_metadata?.role;
      const role: UserRole = isNewGoogleAccount
        ? intent.role
        : metadataRole === 'artist' ? 'artist' : 'client';
      let profile = existingProfile;
      if (!profile) {
        try {
          profile = await ensureMyProfile({
            id: authUser.id,
            name: String(authUser.user_metadata?.full_name ?? authUser.user_metadata?.name ?? authUser.email?.split('@')[0] ?? 'User'),
            username: usernameFromEmail(authUser.email),
            role,
            onboarded: false,
          });
        } catch (error) {
          logAuthRequestFailure('oauth', error);
          return { success: false, error: 'Unable to create your profile. Check your connection and try again.' };
        }
      }
      if (!profile) {
        return { success: false, error: 'Unable to set up your profile. Please try again.' };
      }
      const isCompletedProfile = Boolean(profile.onboarded || profile.interests?.length);
      const isIncompleteGoogleSignup = isNewGoogleAccount && !isCompletedProfile;
      if (isIncompleteGoogleSignup && profile.role !== role) {
        let roleUpdateError: { code?: string; status?: number; message?: string } | null = null;
        try {
          const result = await supabase
            .from('profiles')
            .update({ role })
            .eq('id', authUser.id);
          roleUpdateError = result.error;
        } catch (error) {
          const { code, status } = getAuthErrorMetadata(error);
          console.warn('ArtGuard: Google signup role update failed.', {
            code: code ?? 'unknown',
            status: status ?? null,
            message: safeAuthErrorMessage(error),
          });
          return { success: false, error: 'Unable to save your selected account type. Please try again.' };
        }
        if (roleUpdateError) {
          let persistedProfile = null;
          try {
            persistedProfile = await getMyProfile(authUser.id);
          } catch (verificationError) {
            const { code, status } = getAuthErrorMetadata(verificationError);
            console.warn('ArtGuard: Google signup role verification failed after update error.', {
              code: code ?? 'unknown',
              status: status ?? null,
              message: safeAuthErrorMessage(verificationError),
            });
          }
          if (persistedProfile?.role === role) {
            profile = persistedProfile;
          } else {
            const { code, status } = getAuthErrorMetadata(roleUpdateError);
            console.warn('ArtGuard: Google signup role update failed.', {
              code: code ?? 'unknown',
              status: status ?? null,
              message: safeAuthErrorMessage(roleUpdateError),
            });
            return { success: false, error: 'Unable to save your selected account type. Please try again.' };
          }
        }
        if (!roleUpdateError) {
          try {
            const savedProfile = await getMyProfile(authUser.id);
            if (!savedProfile || savedProfile.role !== role) {
              console.warn('ArtGuard: Google signup role update was not confirmed.');
              return { success: false, error: 'Unable to verify your selected account type. Please try again.' };
            }
            profile = savedProfile;
          } catch (error) {
            logAuthRequestFailure('oauth', error);
            return { success: false, error: 'Unable to verify your profile update. Check your connection and try again.' };
          }
        }
      }

      const authenticatedUser: AuthUser = {
        ...authUserFromMetadata(authUser),
        name: isNewGoogleAccount ? metadataName ?? '' : profile.name,
        username: profile.username,
        role: profile.role,
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
      persistSession(authenticatedUser);
      setInitializing(false);
      if (isNewGoogleAccount) storeGoogleNameOnboarding(authUser.id, metadataName ?? '');
      const hasDisplayName = Boolean(profile.name?.trim());
      const hasSavedInterests = Boolean(profile.interests?.length);
      const onboardingComplete = Boolean(profile.onboarded || hasSavedInterests);
      const destination: AuthenticatedDestination = isNewGoogleAccount
        ? isCompletedProfile
          ? '/home'
          : signupStep === 'interests'
          ? '/onboarding/interests'
          : '/onboarding/name'
        : !hasDisplayName || !existingProfile
          ? '/onboarding/name'
          : onboardingComplete
            ? '/home'
            : '/onboarding/interests';
      if ((!isNewGoogleAccount || isCompletedProfile) && onboardingComplete) {
        clearGoogleSignupIntent();
        clearGoogleNameOnboarding();
      }
      return {
        success: true,
        destination,
      };
    } catch (error) {
      logAuthRequestFailure('oauth', error);
      return {
        success: false,
        error: error instanceof TypeError && /fetch|network/i.test(error.message)
          ? 'Unable to connect. Check your connection and try again.'
          : 'Unable to set up your profile. Please try again.',
      };
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
      onboarded: patch.onboarded,
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
      startGoogleSignIn,
      completeGoogleSignIn,
      changeEmail,
      requestPasswordReset,
      passwordRecoverySession,
      clearPasswordRecoverySession,
      updateProfile,
      enableMockPremium,
      logout,
    }),
    [user, initializing, login, signUp, startGoogleSignIn, completeGoogleSignIn, changeEmail, requestPasswordReset, passwordRecoverySession, clearPasswordRecoverySession, updateProfile, enableMockPremium, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
