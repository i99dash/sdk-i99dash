import type { CallApiRequest, MiniAppContext } from '../../types/index.js';

/// Runtime state the UI toggles + the shim reads from.
///
/// Kept in-process (single-dev use, not a multi-tenant server), so a
/// plain object behind a typed accessor is plenty — no need for an
/// event-sourced store or Redux etc.
///
/// The `speedKmh` field isn't part of the real `MiniAppContext` (the
/// host doesn't leak speed through the bridge) — but the host gates
/// viewer-visibility on it via the driver-safety gate. Exposing it
/// here as a first-class dev-server concern lets tests exercise both
/// paths without needing a real car.
export interface DevServerState {
  context: MiniAppContext;
  speedKmh: number;
}

export type DevServerStatePatch = Partial<{
  context: Partial<MiniAppContext>;
  speedKmh: number;
}>;

/// One row in the inspector ring buffer. Captures what the dev-server
/// did in response to a `callApi` request — primarily so a developer
/// can see why their fixture didn't match.
export interface CallApiDecision {
  /// ISO-8601 timestamp captured at request time.
  at: string;
  request: {
    path: string;
    method: string;
    query?: Record<string, unknown>;
  };
  /// One of:
  ///   - `matched`     — a fixture file matched and was served
  ///   - `no_fixture`  — no fixture matched; envelope returned `NO_FIXTURE`
  ///   - `bad_request` — the request itself failed schema validation
  outcome: 'matched' | 'no_fixture' | 'bad_request';
  /// Filename of the matched fixture, when `outcome === 'matched'`.
  /// Otherwise undefined.
  fixtureFile?: string;
  /// Human-readable note — for `bad_request` carries the zod message;
  /// for `no_fixture` describes which fixtures were considered.
  detail?: string;
}

const INSPECT_RING_CAPACITY = 20;

export class StateStore {
  private snapshot: DevServerState;
  private listeners = new Set<(s: DevServerState) => void>();
  /// Ring buffer of the last [INSPECT_RING_CAPACITY] callApi decisions.
  /// Insertion is O(1); read-out copies for display so the UI can't
  /// see a half-shifted state.
  private readonly decisions: CallApiDecision[] = [];

  constructor(initial: DevServerState) {
    this.snapshot = initial;
  }

  get(): DevServerState {
    return this.snapshot;
  }

  patch(patch: DevServerStatePatch): DevServerState {
    this.snapshot = {
      context: { ...this.snapshot.context, ...(patch.context ?? {}) },
      speedKmh: patch.speedKmh ?? this.snapshot.speedKmh,
    };
    for (const l of this.listeners) l(this.snapshot);
    return this.snapshot;
  }

  subscribe(cb: (s: DevServerState) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /// Record a callApi decision. Bounded by [INSPECT_RING_CAPACITY] —
  /// once full, the oldest entry drops on each new insert. No
  /// persistence: dev-server is short-lived; the inspector is for
  /// "why didn't this match just now" debugging, not historical audit.
  recordCallApiDecision(
    req: CallApiRequest,
    outcome: CallApiDecision['outcome'],
    extras: {
      fixtureFile?: string;
      detail?: string;
    } = {},
  ): void {
    const entry: CallApiDecision = {
      at: new Date().toISOString(),
      request: {
        path: req.path,
        method: req.method,
        ...(req.query ? { query: req.query } : {}),
      },
      outcome,
      ...(extras.fixtureFile ? { fixtureFile: extras.fixtureFile } : {}),
      ...(extras.detail ? { detail: extras.detail } : {}),
    };
    this.decisions.push(entry);
    if (this.decisions.length > INSPECT_RING_CAPACITY) this.decisions.shift();
  }

  /// Return the buffered decisions, newest-last. Cheap copy — the
  /// inspector polls this at ~1 Hz; no need for a subscription stream.
  getCallApiDecisions(): CallApiDecision[] {
    return [...this.decisions];
  }
}
