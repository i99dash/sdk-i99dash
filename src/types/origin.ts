import fixturesJson from './origin-fixtures.json' with { type: 'json' };

/// The canonical mini-app egress-origin grammar — the SINGLE definition of
/// "an allowed network origin", mirrored byte-for-byte by the backend
/// (Pydantic) and the car host (Dart). A manifest `network[]` entry is valid
/// iff this returns non-null; the returned value is the canonical form that
/// gets stored, served, and turned into a CSP `connect-src` token.
///
/// Grammar: `https://host[:port]` — HTTPS only, a real registrable DNS name
/// (≥ 2 ASCII LDH labels), optional port, and NOTHING else: no path, query,
/// fragment, userinfo, wildcard, IP literal, `localhost`, or trailing dot.
/// Returns the lowercased canonical origin (default `:443` stripped) or null.
///
/// Why this strict (see the mini-app egress threat model): three hand-written
/// origin parsers in three languages = the loosest one becomes the real
/// policy. Rejecting IP literals / `localhost` closes SSRF-shaped
/// declarations; rejecting wildcards/paths keeps the resulting CSP exact-host;
/// canonicalizing makes the CSP byte-stable and forces all three validators to
/// agree. The shared [ORIGIN_FIXTURES] corpus is the cross-repo drift gate.
export function canonicalizeMiniAppOrigin(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 253) return null;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }

  if (u.protocol !== 'https:') return null;
  if (u.username !== '' || u.password !== '') return null;
  if (u.pathname !== '' && u.pathname !== '/') return null;
  if (u.search !== '' || u.hash !== '') return null;

  const host = u.hostname.toLowerCase();
  if (!isRegistrableDnsHost(host)) return null;

  return u.port ? `https://${host}:${u.port}` : `https://${host}`;
}

/// One DNS label: ASCII letter/digit, optional internal hyphens, no leading or
/// trailing hyphen, ≥ 1 char.
const LDH_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/// Dotted-quad IPv4 literal — rejected outright (covers loopback + RFC1918).
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/// True iff `host` is a registrable, ASCII, multi-label DNS name. Rejects IPv4
/// / IPv6 literals, single-label hosts (`localhost`, internal names), wildcards
/// and trailing dots.
function isRegistrableDnsHost(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  if (host.includes('*')) return false; // no wildcards
  if (host.startsWith('[') || host.includes(':')) return false; // IPv6 literal
  if (IPV4.test(host)) return false; // IPv4 literal (incl. loopback / RFC1918)
  const labels = host.split('.');
  if (labels.length < 2) return false; // reject single-label (e.g. localhost)
  return labels.every((label) => LDH_LABEL.test(label));
}

/// Cross-repo origin fixture corpus — every `invalid` entry MUST canonicalize
/// to null in the SDK, to None in the backend Pydantic validator, and to null
/// in the car Dart `normalizeMiniAppOrigin`. Vendored into backend + car test
/// suites so the three grammars cannot silently drift.
export const ORIGIN_FIXTURES = fixturesJson as {
  valid: { input: string; canonical: string }[];
  invalid: string[];
};
