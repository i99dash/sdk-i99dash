/// Mini-app-facing controller for location.
///
/// Backed by the **standard browser HTML5 Geolocation API**
/// (`navigator.geolocation`) — the host enables it on the WebView
/// (`InAppWebViewSettings.geolocationEnabled = true`) and grants
/// per-origin permission via `onGeolocationPermissionsShowPrompt`
/// only when the calling mini-app's manifest declares
/// `location.read`. Earlier versions of this controller talked to a
/// bespoke `LocationBridge` JS handler that the host never wired up;
/// every call returned `LocationUnavailableError` regardless of the
/// manifest. The shape of the public API hasn't changed — mini-apps
/// keep calling `client.location.getSnapshot()` and `onChange(...)`
/// — so existing apps just need a bundle rebuild to pick this up.
///
/// Coords mapping (Geolocation API → SDK `LocationSnapshot`):
///   * coords.latitude     → lat
///   * coords.longitude    → lng
///   * coords.heading      → heading (null when stationary)
///   * coords.speed        → speedMps (null when unknown)
///   * coords.accuracy     → accuracyM (always present per spec; we
///                            still mark it nullable for parity with
///                            non-GNSS fallbacks)
///   * timestamp           → at (ISO-8601 UTC)

import { LocationSnapshotSchema, type LocationSnapshot } from '../types/index.js';

import type { Bridge } from './bridge.js';
import { InvalidResponseError, LocationUnavailableError } from './errors.js';

export type LocationListener = (snapshot: LocationSnapshot) => void;

export class LocationController {
  /** Kept on the constructor for signature compat — the SDK builds
   *  this controller via the same factory shape every other family
   *  uses. The bridge isn't consulted by the new geolocation path. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_bridge: Bridge) {}

  private _shape: string | null = null;
  private _visibilityInstalled = false;
  private _hidden = false;
  private _listeners = new Set<LocationListener>();
  private _watchId: number | null = null;
  private _lastWhilePaused: LocationSnapshot | null = null;

  /// One-shot fix. Resolves with the current `LocationSnapshot` or
  /// rejects with `LocationUnavailableError` when:
  ///   * `navigator.geolocation` is missing (e.g. SSR / unit tests),
  ///   * the WebView denied the permission (manifest didn't declare
  ///     `location.read`, or the user revoked at the OS level), or
  ///   * the host took longer than 10 s to return a fix.
  async getSnapshot(): Promise<LocationSnapshot> {
    const geo = _geo();
    if (geo === null) {
      throw new LocationUnavailableError('navigator.geolocation not available');
    }
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      geo.getCurrentPosition(
        resolve,
        (err) => reject(_geoError(err)),
        // High accuracy: GNSS fix preferred over wifi/cell. timeout
        // 10s — same budget the legacy bridge used; matches the
        // user's perception window for "show me where I am". Cached
        // fix up to 30s old is fine — it's location for a weather
        // refresh / navigation ETA, not surveying.
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
      );
    });
    return this._parse(_positionToSnapshot(position));
  }

  /// Subscribe to position updates. The SDK fans out a single
  /// `watchPosition` call to N listeners, then unsubscribes from
  /// the platform when the last listener leaves — same lifecycle
  /// the legacy bridge offered, just sourced from the standard
  /// API. The returned cleanup is idempotent.
  onChange(listener: LocationListener): () => void {
    const geo = _geo();
    if (geo === null) {
      throw new LocationUnavailableError('navigator.geolocation not available');
    }
    this._listeners.add(listener);
    this._installVisibility();
    if (this._watchId === null) {
      this._watchId = geo.watchPosition(
        (position) => {
          let parsed: LocationSnapshot;
          try {
            parsed = this._parse(_positionToSnapshot(position));
          } catch (e) {
            console.warn('[i99dash] dropped malformed location event:', e);
            return;
          }
          if (this._hidden) {
            this._lastWhilePaused = parsed;
            return;
          }
          for (const l of [...this._listeners]) this._invokeSafe(l, parsed);
        },
        (err) => {
          // Don't tear down on transient errors — `watchPosition`
          // recovers on the next fix. Just log so a developer
          // poking at the dev console sees what's happening.
          console.warn('[i99dash] watchPosition error:', err.message);
        },
        { enableHighAccuracy: true, maximumAge: 30_000 },
      );
    }
    let off = false;
    return () => {
      if (off) return;
      off = true;
      this._listeners.delete(listener);
      if (this._listeners.size === 0 && this._watchId !== null) {
        const id = this._watchId;
        this._watchId = null;
        geo.clearWatch(id);
      }
    };
  }

  private _installVisibility(): void {
    if (this._visibilityInstalled) return;
    this._visibilityInstalled = true;
    if (typeof document === 'undefined') return;
    const onChange = (): void => {
      this._hidden = document.hidden;
      if (!this._hidden && this._lastWhilePaused !== null) {
        const buffered = this._lastWhilePaused;
        this._lastWhilePaused = null;
        for (const l of [...this._listeners]) this._invokeSafe(l, buffered);
      }
    };
    document.addEventListener('visibilitychange', onChange);
  }

  private _invokeSafe(l: LocationListener, s: LocationSnapshot): void {
    try {
      l(s);
    } catch (e) {
      console.error('[i99dash] location listener threw:', e);
    }
  }

  private _parse(raw: unknown): LocationSnapshot {
    const shape = _shapeFingerprint(raw);
    if (shape !== null && shape === this._shape) return raw as LocationSnapshot;
    const result = LocationSnapshotSchema.safeParse(raw);
    if (!result.success) {
      throw new InvalidResponseError('location payload did not match schema', result.error);
    }
    this._shape = shape;
    return result.data;
  }
}

// ── helpers (module-private) ─────────────────────────────────────────

function _geo(): Geolocation | null {
  if (typeof navigator === 'undefined') return null;
  // Older Android WebViews ship `navigator.geolocation` even when
  // the host hasn't enabled it — calls just fail with PERMISSION_DENIED.
  // Treating "object exists" as available is fine; getCurrentPosition's
  // error callback handles the rest.
  return navigator.geolocation ?? null;
}

function _positionToSnapshot(p: GeolocationPosition): LocationSnapshot {
  const c = p.coords;
  return {
    lat: c.latitude,
    lng: c.longitude,
    heading: typeof c.heading === 'number' && !Number.isNaN(c.heading) ? c.heading : null,
    speedMps: typeof c.speed === 'number' && !Number.isNaN(c.speed) ? c.speed : null,
    accuracyM: typeof c.accuracy === 'number' && Number.isFinite(c.accuracy) ? c.accuracy : null,
    at: new Date(p.timestamp).toISOString(),
  };
}

function _geoError(err: GeolocationPositionError): LocationUnavailableError {
  // Map the spec's three codes to one user-actionable error so
  // existing mini-app catch blocks (which already check for
  // `LocationUnavailableError`) keep working.
  switch (err.code) {
    case 1:
      return new LocationUnavailableError(`permission denied: ${err.message}`);
    case 2:
      return new LocationUnavailableError(`position unavailable: ${err.message}`);
    case 3:
      return new LocationUnavailableError(`timeout: ${err.message}`);
    default:
      return new LocationUnavailableError(err.message || 'geolocation failed');
  }
}

function _shapeFingerprint(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null;
  const keys = Object.keys(raw as Record<string, unknown>).sort();
  return keys.join('\x1f');
}
