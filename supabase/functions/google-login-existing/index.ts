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

function findGoogleIdentity(user: {
  identities?: Array<{
    id?: string;
    provider?: string;
    identity_data?: Record<string, unknown>;
  }> | null;
}, subject: string): boolean {
  return Boolean(user.identities?.some((identity) =>
    identity.provider === 'google'
    && (identity.id === subject || identity.identity_data?.sub === subject)
  ));
}

async function findExistingGoogleUser(
  admin: ReturnType<typeof createClient>,
  email: string,
  subject: string,
) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;

    const match = data.users.find((user) =>
      user.email?.trim().toLowerCase() === email
      && findGoogleIdentity(user, subject)
    );
    if (match) return match;
    if (data.users.length < PAGE_SIZE) return null;
  }
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
    const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!googleClientId || !supabaseUrl || !serviceRoleKey || !publishableKey) {
      throw new Error('Server authentication configuration is incomplete.');
    }

    const bodyText = await request.text();
    if (bodyText.length > 16_384) {
      return jsonResponse({ error: 'Invalid request.' }, 400, origin);
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return jsonResponse({ error: 'Invalid request.' }, 400, origin);
    }
    const credential = typeof body === 'object' && body !== null && 'credential' in body
      ? body.credential
      : undefined;
    if (typeof credential !== 'string' || credential.length < 20 || credential.length > 12_000) {
      return jsonResponse({ error: 'Invalid Google credential.' }, 401, origin);
    }

    let claims;
    try {
      ({ payload: claims } = await jwtVerify(credential, GOOGLE_JWKS, {
        algorithms: ['RS256'],
        audience: googleClientId,
        issuer: GOOGLE_ISSUERS,
      }));
    } catch {
      return jsonResponse({ error: 'Invalid Google credential.' }, 401, origin);
    }

    const subject = typeof claims.sub === 'string' ? claims.sub : '';
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!subject || !email || claims.email_verified !== true) {
      return jsonResponse({ error: 'Invalid Google credential.' }, 401, origin);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    let user: Awaited<ReturnType<typeof findExistingGoogleUser>>;
    try {
      user = await findExistingGoogleUser(admin, email, subject);
    } catch {
      return jsonResponse({ code: 'account_not_found' }, 404, origin);
    }
    if (!user || !user.email) {
      return jsonResponse({ code: 'account_not_found' }, 404, origin);
    }

    let profile: { id: string; role: string } | null;
    try {
      const result = await admin
        .from('profiles')
        .select('id, role')
        .eq('id', user.id)
        .maybeSingle();
      if (result.error) throw result.error;
      profile = result.data;
    } catch {
      return jsonResponse({ code: 'account_not_found' }, 404, origin);
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
      stillExistingUser = await findExistingGoogleUser(admin, email, subject);
    } catch {
      return jsonResponse({ code: 'account_not_found' }, 404, origin);
    }
    if (!stillExistingUser || stillExistingUser.id !== user.id) {
      return jsonResponse({ code: 'account_not_found' }, 404, origin);
    }

    let confirmedProfile: { id: string; role: string } | null;
    try {
      const result = await admin
        .from('profiles')
        .select('id, role')
        .eq('id', user.id)
        .maybeSingle();
      if (result.error) throw result.error;
      confirmedProfile = result.data;
    } catch {
      return jsonResponse({ code: 'account_not_found' }, 404, origin);
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
