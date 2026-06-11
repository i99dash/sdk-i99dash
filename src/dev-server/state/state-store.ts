import type { MiniAppContext } from '../../types/index.js';

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

export class StateStore {
  private snapshot: DevServerState;
  private listeners = new Set<(s: DevServerState) => void>();

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
}
