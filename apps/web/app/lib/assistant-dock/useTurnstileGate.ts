import { useEffect } from 'react';
import { setTurnstileMinter } from './turnstile-token';

// EXPERIMENT (do not merge as-is): a VISIBLE "Managed" Turnstile widget instead of the invisible
// `execution:'execute'` one. The invisible widget forces Turnstile's Private-Access-Token path, which
// in Firefox fetches from the IPv6-only `brunhild.challenges.cloudflare.com` and 401s on IPv6-less
// networks (no token → the gate 403s the chat). A visible Managed widget has an interactive fallback,
// so it doesn't dead-end on PAT. See docs/turnstile-firefox-pat-ipv6.md.
//
// Token model changes with it: a Managed widget solves once on render (callback delivers a token); the
// minter hands that token over and reset()s to pre-solve the next one. No-op without a site key.

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const MINT_TIMEOUT_MS = 8000;

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null; // allow a later retry
      reject(new Error('turnstile script failed to load'));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export function useTurnstileGate(siteKey?: string | null): void {
  useEffect(() => {
    if (!siteKey || typeof window === 'undefined') return;

    let widgetId: string | null = null;
    let container: HTMLDivElement | null = null;
    let cancelled = false;

    // A Managed widget pre-solves and holds one token. `currentToken` is the ready-to-use one; a single
    // waiter (`resolve`/`timer`) covers the case where a send arrives before the first solve completes.
    let currentToken: string | null = null;
    let resolve: ((token: string | null) => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const deliver = (token: string | null) => {
      if (resolve) {
        if (timer) clearTimeout(timer);
        timer = null;
        const r = resolve;
        resolve = null;
        r?.(token); // hand straight to the waiting send (single-use — don't also cache it)
        return;
      }
      currentToken = token; // no waiter yet → cache the pre-solved token for the next send
    };

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        container = document.createElement('div');
        // EXPERIMENT: render it visibly (fixed, bottom-left) so the Managed challenge can show its
        // interactive fallback instead of dead-ending on the PAT path.
        container.style.position = 'fixed';
        container.style.bottom = '12px';
        container.style.left = '12px';
        container.style.zIndex = '2147483647';
        document.body.appendChild(container);
        widgetId = window.turnstile.render(container, {
          sitekey: siteKey,
          callback: (token: string) => deliver(token),
          'error-callback': () => deliver(null),
          'expired-callback': () => {
            currentToken = null;
          },
          'timeout-callback': () => deliver(null),
        });

        setTurnstileMinter(
          () =>
            new Promise<string | null>((res) => {
              if (!widgetId || !window.turnstile || resolve) return res(null);
              // Pre-solved token ready → use it, then reset() to pre-solve the next one.
              if (currentToken) {
                const t = currentToken;
                currentToken = null;
                try {
                  window.turnstile.reset(widgetId);
                } catch {
                  /* ignore */
                }
                return res(t);
              }
              // Not solved yet (first solve in flight, or re-solving) → wait for the next callback.
              resolve = res;
              timer = setTimeout(() => {
                const r = resolve;
                resolve = null;
                timer = null;
                r?.(null);
              }, MINT_TIMEOUT_MS);
            }),
        );
      })
      .catch(() => {
        /* script blocked/offline → no gate; server gate is a no-op without a token anyway */
      });

    return () => {
      cancelled = true;
      setTurnstileMinter(null);
      if (timer) clearTimeout(timer);
      if (resolve) {
        const r = resolve;
        resolve = null;
        r(null);
      }
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          /* already gone */
        }
      }
      container?.remove();
    };
  }, [siteKey]);
}
