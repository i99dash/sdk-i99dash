import { MiniAppClient, NotInsideHostError } from 'i99dash';

/// Per-session singleton so a re-render doesn't reconstruct the
/// client. `MiniAppClient` is stateless beyond the bridge reference,
/// so this is a convenience, not a correctness requirement.
let cached: MiniAppClient | undefined;

/// Returns the client, or null when called outside a host (SSR, a
/// test, or a plain browser without the dev-server shim). Null is
/// preferable to throwing here because React components would have
/// to wrap every call in try/catch otherwise — callers render a
/// "no host" fallback from null instead.
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
