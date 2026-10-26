import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const PAGE_SIZE = 1000;
const LOCAL_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
];

function allowedOrigins(): Set<string> {
  const configuredOrigins = Deno.env.get('ARTGUARD_ALLOWED_ORIGINS')
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];
  return new Set([...LOCAL_ORIGINS, ...configuredOrigins]);
}

function jsonResponse(
  body: Record<string, string>,
  status: number,
  origin: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      Vary: 'Origin',
    },
  });
}

function credentialFailureStage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'jwt_invalid';
  const details = error as Record<string, unknown>;
  const code = typeof details.code === 'string' ? details.code : '';
  const claim = typeof details.claim === 'string' ? details.claim : '';

  if (code === 'ERR_JWT_EXPIRED') return 'expired_token';
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && claim === 'aud') return 'audience_mismatch';
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && claim === 'iss') return 'invalid_issuer';
  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' || code === 'ERR_JWKS_NO_MATCHING_KEY') {
    return 'signature_invalid';
  }
  if (code.startsWith('ERR_JWKS_') || code === 'ERR_JOSE_ALG_NOT_ALLOWED') {
    return 'key_or_algorithm_verification_failed';
  }
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && claim === 'sub') return 'missing_subject';
  return 'jwt_invalid';
}

async function fingerprint(value: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 12);
  } catch {
    return 'unavailable';
  }
}

async function unverifiedAudienceFingerprints(token: string): Promise<string[]> {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return [];
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as {
      aud?: unknown;
    };
    const audiences = typeof payload.aud === 'string'
      ? [payload.aud]
      : Array.isArray(payload.aud)
        ? payload.aud.filter((audience): audience is string => typeof audience === 'string')
        : [];
    return Promise.all(audiences.map(fingerprint));
  } catch {
    return [];
  }
}

async function verifiedAudienceFingerprints(audience: unknown): Promise<string[]> {
  const audiences = typeof audience === 'string'
    ? [audience]
    : Array.isArray(audience)
      ? audience.filter((value): value is string => typeof value === 'string')
      : [];
  return Promise.all(audiences.map(fingerprint));
}

type AdminIdentityShape = {
  id?: string;
  identity_id?: string;
  identity_data?: Record<string, unknown>;
  provider?: string;
  provider_id?: string;
};

function providerAccountId(identity: AdminIdentityShape): string | undefined {
  // GoTrue's Admin JSON maps its provider_id value to id; identity_id is the row UUID.
  if (typeof identity.provider_id === 'string') return identity.provider_id;
  return typeof identity.id === 'string' ? identity.id : undefined;
}

function findGoogleIdentity(identity: AdminIdentityShape, subject: string): boolean {
  return identity.provider === 'google' && providerAccountId(identity) === subject;
}

type FingerprintMatch = {
  fingerprint: string;
  matchesVerifiedSubject: boolean;
};

type GoogleIdentityDiagnostics = {
  verifiedSubjectFingerprint: string;
  pagesScanned: number;
  usersScanned: number;
  usersWithIdentitiesArray: number;
  usersWithoutIdentitiesArray: number;
  googleIdentitiesObserved: number;
  identityShapes: Map<string, { fields: string[]; count: number }>;
  failedPage?: number;
  candidateFieldPresence: {
    provider: number;
    id: number;
    identity_id: number;
    provider_id: number;
    identity_data_sub: number;
  };
  authoritativeComparisons: Map<string, {
    field: 'id' | 'provider_id';
    fingerprint: string;
    matched: boolean;
  }>;
  candidateFingerprints: {
    id: Map<string, FingerprintMatch>;
    provider_id: Map<string, FingerprintMatch>;
    identity_data_sub: Map<string, FingerprintMatch>;
  };
};

async function createGoogleIdentityDiagnostics(
  subject: string,
): Promise<GoogleIdentityDiagnostics> {
  return {
    verifiedSubjectFingerprint: await fingerprint(subject),
    pagesScanned: 0,
    usersScanned: 0,
    usersWithIdentitiesArray: 0,
    usersWithoutIdentitiesArray: 0,
    googleIdentitiesObserved: 0,
    identityShapes: new Map(),
    candidateFieldPresence: {
      provider: 0,
      id: 0,
      identity_id: 0,
      provider_id: 0,
      identity_data_sub: 0,
    },
    authoritativeComparisons: new Map(),
    candidateFingerprints: {
      id: new Map(),
      provider_id: new Map(),
      identity_data_sub: new Map(),
    },
  };
}

function countShape(shapes: Map<string, { fields: string[]; count: number }>, fields: string[]): void {
  const sortedFields = [...fields].sort();
  const key = JSON.stringify(sortedFields);
  const shape = shapes.get(key);
  if (shape) {
    shape.count += 1;
  } else {
    shapes.set(key, { fields: sortedFields, count: 1 });
  }
}

async function recordCandidateFingerprint(
  field: keyof GoogleIdentityDiagnostics['candidateFingerprints'],
  value: unknown,
  subject: string,
  diagnostics: GoogleIdentityDiagnostics,
): Promise<void> {
  if (typeof value !== 'string') return;

  const valueFingerprint = await fingerprint(value);
  const matchesVerifiedSubject = value === subject;
  const fingerprintKey = `${valueFingerprint}:${matchesVerifiedSubject}`;
  if (!diagnostics.candidateFingerprints[field].has(fingerprintKey)) {
    diagnostics.candidateFingerprints[field].set(fingerprintKey, {
      fingerprint: valueFingerprint,
      matchesVerifiedSubject,
    });
  }
}

async function recordGoogleIdentityDiagnostic(
  identity: AdminIdentityShape,
  subject: string,
  diagnostics: GoogleIdentityDiagnostics,
): Promise<void> {
  diagnostics.googleIdentitiesObserved += 1;
  const knownIdentityFields = ['provider', 'id', 'identity_id', 'provider_id', 'identity_data'];
  countShape(
    diagnostics.identityShapes,
    Object.keys(identity).filter((field) => knownIdentityFields.includes(field)),
  );

  const identityDataSubject = identity.identity_data?.sub;
  if (typeof identity.provider === 'string') diagnostics.candidateFieldPresence.provider += 1;
  if (typeof identity.id === 'string') diagnostics.candidateFieldPresence.id += 1;
  if (typeof identity.identity_id === 'string') diagnostics.candidateFieldPresence.identity_id += 1;
  if (typeof identity.provider_id === 'string') diagnostics.candidateFieldPresence.provider_id += 1;
  if (typeof identityDataSubject === 'string') {
    diagnostics.candidateFieldPresence.identity_data_sub += 1;
  }

  await Promise.all([
    recordCandidateFingerprint('id', identity.id, subject, diagnostics),
    recordCandidateFingerprint('provider_id', identity.provider_id, subject, diagnostics),
    recordCandidateFingerprint('identity_data_sub', identityDataSubject, subject, diagnostics),
  ]);

  const authoritativeField = typeof identity.provider_id === 'string' ? 'provider_id' : 'id';
  const authoritativeValue = providerAccountId(identity);
  if (authoritativeValue !== undefined) {
    const valueFingerprint = await fingerprint(authoritativeValue);
    const matched = authoritativeValue === subject;
    const comparisonKey = `${authoritativeField}:${valueFingerprint}:${matched}`;
    diagnostics.authoritativeComparisons.set(comparisonKey, {
      field: authoritativeField,
      fingerprint: valueFingerprint,
      matched,
    });
  }
}

function logGoogleIdentityDiagnostics(
  diagnostics: GoogleIdentityDiagnostics,
  outcome: 'match_found' | 'no_match' | 'auth_admin_error',
): void {
  const candidates = (field: keyof GoogleIdentityDiagnostics['candidateFingerprints']) =>
    [...diagnostics.candidateFingerprints[field].values()];

  console.info('google-login-existing: Google identity scan diagnostic.', {
    stage: 'google_identity_scan_diagnostic',
    outcome,
    pagesScanned: diagnostics.pagesScanned,
    usersScanned: diagnostics.usersScanned,
    usersWithIdentitiesArray: diagnostics.usersWithIdentitiesArray,
    usersWithoutIdentitiesArray: diagnostics.usersWithoutIdentitiesArray,
    googleIdentitiesObserved: diagnostics.googleIdentitiesObserved,
    identityShapes: [...diagnostics.identityShapes.values()],
    failedPage: diagnostics.failedPage,
    candidateFieldPresence: diagnostics.candidateFieldPresence,
    verifiedSubjectFingerprint: diagnostics.verifiedSubjectFingerprint,
    candidateFingerprints: {
      id: candidates('id'),
      provider_id: candidates('provider_id'),
      identity_data_sub: candidates('identity_data_sub').map((candidate) => ({
        ...candidate,
        diagnosticOnly: true,
      })),
    },
    authoritativeComparisons: [...diagnostics.authoritativeComparisons.values()],
    authoritativeComparison: {
      field: 'provider_id_or_go_true_wire_id',
      matched: [...diagnostics.authoritativeComparisons.values()]
        .some((candidate) => candidate.matched),
    },
  });
}

async function findExistingGoogleUser(
  admin: ReturnType<typeof createClient>,
  subject: string,
  emitDiagnostics = false,
) {
  const diagnostics = emitDiagnostics
    ? await createGoogleIdentityDiagnostics(subject)
    : null;
  let outcome: 'match_found' | 'no_match' | 'auth_admin_error' = 'no_match';
  for (let page = 1; ; page += 1) {
    let result: Awaited<ReturnType<typeof admin.auth.admin.listUsers>>;
    try {
      result = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    } catch {
      outcome = 'auth_admin_error';
      if (diagnostics) diagnostics.failedPage = page;
      console.error('google-login-existing: Auth Admin API request failed.', {
        stage: 'auth_admin_list_users_error',
        page,
      });
      if (diagnostics) logGoogleIdentityDiagnostics(diagnostics, outcome);
      throw new Error('Auth Admin API request failed.');
    }
    const { data, error } = result;
    if (error) {
      outcome = 'auth_admin_error';
      if (diagnostics) diagnostics.failedPage = page;
      console.error('google-login-existing: Auth Admin API request failed.', {
        stage: 'auth_admin_list_users_error',
        page,
      });
      if (diagnostics) {
        logGoogleIdentityDiagnostics(diagnostics, outcome);
      }
      throw error;
    }
    if (diagnostics) {
      diagnostics.pagesScanned += 1;
    }

    let match: (typeof data.users)[number] | undefined;
    for (const user of data.users) {
      if (diagnostics) {
        diagnostics.usersScanned += 1;
        if (Array.isArray(user.identities)) diagnostics.usersWithIdentitiesArray += 1;
        else diagnostics.usersWithoutIdentitiesArray += 1;
      }
      for (const identity of user.identities ?? []) {
        if (identity.provider !== 'google') continue;
        if (diagnostics) {
          await recordGoogleIdentityDiagnostic(identity, subject, diagnostics);
        }
        if (findGoogleIdentity(identity, subject)) {
          match = user;
          break;
        }
      }
      if (match) break;
    }
    if (match) {
      outcome = 'match_found';
      console.info('google-login-existing: Google identity match found.', {
        stage: 'google_identity_match_found',
      });
      if (diagnostics) logGoogleIdentityDiagnostics(diagnostics, outcome);
      return match;
    }
    if (data.users.length < PAGE_SIZE) {
      console.info('google-login-existing: Google identity match not found.', {
        stage: 'google_identity_match_not_found',
      });
      if (diagnostics) logGoogleIdentityDiagnostics(diagnostics, outcome);
      return null;
    }
  }
}

async function findProfile(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ id: string; role: string } | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('google-login-existing: Profile query failed.', {
      stage: 'profile_query_error',
    });
    throw error;
  }

  if (!data) {
    console.info('google-login-existing: Profile row not found.', {
      stage: 'profile_row_not_found',
    });
    return null;
  }
  console.info('google-login-existing: Profile row found.', {
    stage: 'profile_row_found',
  });

  if (data.role !== 'artist' && data.role !== 'client') {
    console.warn('google-login-existing: Profile role is invalid.', {
      stage: 'profile_role_invalid',
    });
    return data;
  }
  console.info('google-login-existing: Profile role is valid.', {
    stage: 'profile_role_valid',
  });
  return data;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') ?? '';
  if (!allowedOrigins().has(origin)) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
      },
    });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, origin);
  }

  try {
    const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID')?.trim();
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!googleClientId) {
      console.error('google-login-existing: credential rejected.', { stage: 'google_client_id_missing' });
      return jsonResponse({ error: 'Unable to verify Google sign-in.', code: 'google_client_id_missing' }, 500, origin);
    }
    if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
      console.error('google-login-existing: server configuration is incomplete.', { stage: 'supabase_configuration_missing' });
      return jsonResponse({ error: 'Unable to complete Google sign-in.' }, 500, origin);
    }

    const bodyText = await request.text();
    if (bodyText.length > 16_384) {
      console.warn('google-login-existing: credential rejected.', { stage: 'request_too_large' });
      return jsonResponse({ error: 'Invalid request.' }, 400, origin);
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      console.warn('google-login-existing: credential rejected.', { stage: 'invalid_request_json' });
      return jsonResponse({ error: 'Invalid request.' }, 400, origin);
    }
    const credential = typeof body === 'object' && body !== null && 'credential' in body
      ? body.credential
      : undefined;
    if (typeof credential !== 'string' || credential.length === 0) {
      console.warn('google-login-existing: credential rejected.', { stage: 'missing_credential' });
      return jsonResponse({ error: 'Invalid Google credential.', code: 'missing_credential' }, 401, origin);
    }
    if (credential.length < 20 || credential.length > 12_000) {
      console.warn('google-login-existing: credential rejected.', { stage: 'credential_malformed' });
      return jsonResponse({ error: 'Invalid Google credential.', code: 'credential_malformed' }, 401, origin);
    }

    let claims;
    try {
      ({ payload: claims } = await jwtVerify(credential, GOOGLE_JWKS, {
        algorithms: ['RS256'],
        audience: googleClientId,
        issuer: GOOGLE_ISSUERS,
      }));
    } catch (error) {
      const stage = credentialFailureStage(error);
      if (stage === 'audience_mismatch') {
        const expectedClientIdFingerprint = await fingerprint(googleClientId);
        const unverifiedTokenAudienceFingerprints = await unverifiedAudienceFingerprints(credential);
        console.warn(`[AG GoogleAudienceDiag] ${JSON.stringify({
          stage,
          expectedClientIdFingerprint,
          tokenAudienceTrust: 'unverified_diagnostic_only',
          unverifiedTokenAudienceFingerprints,
        })}`);
      } else {
        console.warn('google-login-existing: credential rejected.', { stage });
      }
      return jsonResponse({ error: 'Invalid Google credential.', code: stage }, 401, origin);
    }

    console.info(`[AG GoogleAudienceDiag] ${JSON.stringify({
      stage: 'jwt_verified',
      expectedClientIdFingerprint: await fingerprint(googleClientId),
      verifiedTokenAudienceFingerprints: await verifiedAudienceFingerprints(claims.aud),
    })}`);

    const subject = typeof claims.sub === 'string' ? claims.sub : '';
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!subject) {
      console.warn('google-login-existing: credential rejected.', { stage: 'missing_subject' });
      return jsonResponse({ error: 'Invalid Google credential.', code: 'missing_subject' }, 401, origin);
    }
    if (!email) {
      console.warn('google-login-existing: credential rejected.', { stage: 'missing_email' });
      return jsonResponse({ error: 'Invalid Google credential.', code: 'missing_email' }, 401, origin);
    }
    if (claims.email_verified !== true) {
      console.warn('google-login-existing: credential rejected.', { stage: 'email_not_verified' });
      return jsonResponse({ error: 'Invalid Google credential.', code: 'email_not_verified' }, 401, origin);
    }
    console.info('google-login-existing: Google token verified.', {
      stage: 'google_token_verified',
    });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    let user: Awaited<ReturnType<typeof findExistingGoogleUser>>;
    try {
      user = await findExistingGoogleUser(admin, subject, true);
    } catch {
      return jsonResponse({ error: 'Unable to complete Google sign-in.' }, 500, origin);
    }
    if (!user || !user.email) {
      return jsonResponse({ code: 'account_not_found' }, 404, origin);
    }

    let profile: { id: string; role: string } | null;
    try {
      profile = await findProfile(admin, user.id);
    } catch {
      return jsonResponse({ error: 'Unable to complete Google sign-in.' }, 500, origin);
    }
    if (!profile || (profile.role !== 'artist' && profile.role !== 'client')) {
      return jsonResponse({ code: 'account_not_found' }, 404, origin);
    }

    const emailAuth = createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const emailRedirectTo = `${origin}/auth/callback?flow=existing-google-login`;
    const { error: otpError } = await emailAuth.auth.signInWithOtp({
      email: user.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo,
      },
    });
    if (otpError) {
      return jsonResponse({ error: 'Unable to send the sign-in email.' }, 503, origin);
    }

    let stillExistingUser: Awaited<ReturnType<typeof findExistingGoogleUser>>;
    try {
      stillExistingUser = await findExistingGoogleUser(admin, subject);
    } catch {
      return jsonResponse({ error: 'Unable to complete Google sign-in.' }, 500, origin);
    }
    if (!stillExistingUser || stillExistingUser.id !== user.id) {
      return jsonResponse({ code: 'account_not_found' }, 404, origin);
    }

    let confirmedProfile: { id: string; role: string } | null;
    try {
      confirmedProfile = await findProfile(admin, user.id);
    } catch {
      return jsonResponse({ error: 'Unable to complete Google sign-in.' }, 500, origin);
    }
    if (!confirmedProfile || (confirmedProfile.role !== 'artist' && confirmedProfile.role !== 'client')) {
      return jsonResponse({ code: 'account_not_found' }, 404, origin);
    }

    return jsonResponse({ accepted: 'true' }, 200, origin);
  } catch {
    console.error('google-login-existing: request failed.');
    return jsonResponse({ error: 'Unable to complete Google sign-in.' }, 500, origin);
  }
});
