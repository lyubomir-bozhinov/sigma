// Cloudflare Turnstile edge gate for the assistant endpoints (spec §7 — pre-LLM launch gate).
//
// The dock renders the keyless/invisible Turnstile widget and sends its token on the request; here
// we verify that token server-side (Cloudflare siteverify) BEFORE any body buffering or paid
// model/D1 work, so a bot/CSRF flood can't start a turn.
//
// Graceful degradation: when `TURNSTILE_SECRET` is unset (local dev, previews, staging), the gate is
// a NO-OP — the assistant stays usable without it. It only activates once the secret is provisioned,
// which is a deliberate launch-gate step (spec §8). Pairs with the client widget (sends the token
// header); ship both before setting the secret in production.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Header the client transport attaches the Turnstile token on (mirrors Cloudflare's field name).
export const TURNSTILE_TOKEN_HEADER = 'cf-turnstile-response';

export interface TurnstileEnv {
  TURNSTILE_SECRET?: string;
}

export interface TurnstileRejection {
  status: number;
  error: string;
}

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Verify a Turnstile token against Cloudflare siteverify. Any network/parse failure or a non-2xx
 * response is treated as NOT verified (fail closed).
 */
export async function verifyTurnstileToken(
  token: string,
  secret: string,
  remoteip?: string,
): Promise<boolean> {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteip) form.append('remoteip', remoteip);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form });
    if (!res.ok) return false;
    const data = (await res.json()) as SiteverifyResponse;
    return data.success === true;
  } catch {
    return false;
  }
}

/**
 * Gate an assistant request. Returns a rejection to send back, or `null` to proceed.
 * No-op (null) when `TURNSTILE_SECRET` is unset — dev/preview/staging run without the gate.
 */
export async function turnstileRejection(
  request: Request,
  env: TurnstileEnv,
): Promise<TurnstileRejection | null> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return null; // gate not provisioned → degrade to no-op (spec §7/§8)

  const token = request.headers.get(TURNSTILE_TOKEN_HEADER);
  if (!token) {
    return {
      status: 403,
      error: 'изисква се потвърждение, че не си робот. Опресни страницата и опитай пак.',
    };
  }

  // Cloudflare sets `cf-connecting-ip` on the edge; passing it tightens the check (optional per Turnstile).
  const remoteip = request.headers.get('cf-connecting-ip') ?? undefined;
  const ok = await verifyTurnstileToken(token, secret, remoteip);
  if (!ok) {
    return {
      status: 403,
      error: 'проверката за сигурност не бе успешна. Опресни страницата и опитай пак.',
    };
  }
  return null;
}
