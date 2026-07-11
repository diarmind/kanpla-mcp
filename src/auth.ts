/**
 * Firebase (Google Identity Toolkit) auth used by the Kanpla web app.
 *
 * Two stateless calls:
 *   1. signInWithPassword — exchange email/password for an idToken + refreshToken.
 *   2. refreshIdToken     — exchange a refreshToken for a fresh idToken (~1h TTL).
 *
 * Neither function stores state; the caller (kanpla.ts) owns the token cache.
 */

const IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";
const SECURE_TOKEN = "https://securetoken.googleapis.com/v1/token";

export interface FirebaseSession {
  idToken: string;
  refreshToken: string;
  /** Absolute epoch-ms after which the idToken is considered stale. */
  expiresAt: number;
  /** Firebase local user id — sent to Kanpla as `userId`. */
  localId: string;
}

interface SignInResponse {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
}

interface RefreshResponse {
  id_token: string;
  refresh_token: string;
  expires_in: string;
  user_id: string;
}

/** Refresh a bit before the real expiry to avoid racing an in-flight request. */
const EXPIRY_SKEW_MS = 60_000;

function expiryFromSeconds(expiresIn: string): number {
  const seconds = Number(expiresIn);
  const ttl = Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;
  return Date.now() + ttl * 1000 - EXPIRY_SKEW_MS;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    // fall through to status text
  }
  return `${res.status} ${res.statusText}`;
}

export async function signInWithPassword(
  apiKey: string,
  email: string,
  password: string,
): Promise<FirebaseSession> {
  const res = await fetch(`${IDENTITY_TOOLKIT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });

  if (!res.ok) {
    throw new Error(`Kanpla login failed: ${await readError(res)}`);
  }

  const data = (await res.json()) as SignInResponse;
  return {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    localId: data.localId,
    expiresAt: expiryFromSeconds(data.expiresIn),
  };
}

export async function refreshIdToken(
  apiKey: string,
  refreshToken: string,
): Promise<Omit<FirebaseSession, "localId">> {
  const res = await fetch(`${SECURE_TOKEN}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`Kanpla token refresh failed: ${await readError(res)}`);
  }

  const data = (await res.json()) as RefreshResponse;
  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: expiryFromSeconds(data.expires_in),
  };
}
