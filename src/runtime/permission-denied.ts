/// Single-listener aggregator for `permission_denied` envelopes seen
/// across any client surface (family controllers, future media/climate
/// controllers). Lets app authors wire one analytics handler instead
/// of bolting `if (r.error.code === 'permission_denied') ...` to every
/// call site.
///
/// Why a separate object: the aggregator is shared by all controllers
/// on the client, but it's not part of the bridge protocol — the host
/// already encodes the failure inside the response envelope. This
/// lives entirely SDK-side.

export type PermissionDeniedListener = (scope: string) => void;

export class PermissionDeniedAggregator {
  private readonly _listeners = new Set<PermissionDeniedListener>();

  /// Subscribe a handler for any `permission_denied` envelope the SDK
  /// observes. Returns an idempotent unsubscribe fn.
  ///
  /// `scope` is the family identifier the failed call was nominally
  /// asking for — e.g. `'car.status'`, `'media.read'`. The aggregator
  /// does not normalise; it forwards whatever the controller declared.
  on(listener: PermissionDeniedListener): () => void {
    this._listeners.add(listener);
    let off = false;
    return () => {
      if (off) return;
      off = true;
      this._listeners.delete(listener);
    };
  }

  /// Internal — controllers call this when they see a
  /// `permission_denied` envelope. Catches per-listener throws so one
  /// buggy analytics handler can't silence the others.
  emit(scope: string): void {
    for (const l of [...this._listeners]) {
      try {
        l(scope);
      } catch (e) {
        console.error('[i99dash] permission-denied listener threw:', e);
      }
    }
  }
}
