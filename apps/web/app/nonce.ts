import { createContext, useContext } from 'react';

/** Per-request CSP nonce, provided during SSR and read by <Scripts>/<ScrollRestoration>. */
export const NonceContext = createContext<string | undefined>(undefined);

export function useNonce(): string | undefined {
  return useContext(NonceContext);
}
