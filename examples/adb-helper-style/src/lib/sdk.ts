import { MiniAppClient, NotInsideHostError } from 'i99dash';

/// Per-session singleton so a re-render doesn't reconstruct the
/// client. Returns null when called outside a host (SSR / tests /
/// plain browser without the dev-server shim) so React components
/// can render a "no host" fallback instead of try/catch-ing every
/// call.
let cached: MiniAppClient | undefined;

export function getClient(): MiniAppClient | null {
  if (cached) return cached;
  try {
    cached = MiniAppClient.fromWindow();
    return cached;
  } catch (err) {
    if (err instanceof NotInsideHostError) return null;
    throw err;
  }
}
