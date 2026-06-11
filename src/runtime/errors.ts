/// Sealed error hierarchy for the runtime.
///
/// Typed errors exist so consumers can distinguish "my mini-app isn't
/// running in a host" (common dev-time mistake) from "the bridge
/// itself blew up" (rare, needs an issue). Family-op protocol failures
/// (`{success: false, error}`) surface as `FamilyOpError` from the
/// family controller, not as a thrown bridge error.
///
/// Every concrete subclass exposes:
///   - `name`     — class name, survives minification.
///   - `code`     — stable string id, safe to switch on. Documented
///                  in `docs/api-ref/errors.md`.
///   - `docsUrl`  — repo-relative path to the matching docs section.
///   - `cause`    — original underlying error when wrapped, per the
///                  ES2022 `Error` cause spec. Walk it for full
///                  stack context.

const DOCS_BASE = 'docs/api-ref/errors.md';

/// Stable, switch-safe identifiers. Add new entries as a non-breaking
/// change; never reuse or repurpose an existing one.
export type SDKErrorCode =
  | 'NOT_INSIDE_HOST'
  | 'BRIDGE_TRANSPORT'
  | 'BRIDGE_TIMEOUT'
  | 'INVALID_RESPONSE';

export abstract class SDKError extends Error {
  // Custom class names survive minification gotchas better via this
  // pattern than `this.constructor.name`.
  override readonly name: string;
  /// Stable identifier — safe to switch on from consumer code.
  /// Typed as `string` (not `SDKErrorCode`) so downstream packages
  /// like `@i99dash/admin-sdk` can extend the hierarchy with their
  /// own codes while still using the same base class.
  readonly code: string;
  /// Repo-relative docs path — e.g. `docs/api-ref/errors.md#bridge_timeout`.
  /// Always populated; intended for inclusion in error pages and dev
  /// tooling. Not a fully-qualified URL because the same SDK ships in
  /// docs at multiple bases (npm, GitHub, internal).
  readonly docsUrl: string;
  constructor(
    name: string,
    code: string,
    docsUrl: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = name;
    this.code = code;
    this.docsUrl = docsUrl;
  }
}

/// No host bridge reachable from the current global scope.
///
/// Fires when:
///   - `window` is undefined (SSR, Node, web worker);
///   - the host global isn't present on `window` — your app isn't
///     running inside the i99dash host.
///
/// In dev, use the `i99dash dev` server which provides a local host
/// so the client can run outside a real car.
export class NotInsideHostError extends SDKError {
  constructor(detail: string) {
    super(
      'NotInsideHostError',
      'NOT_INSIDE_HOST',
      `${DOCS_BASE}#not_inside_host`,
      `mini-app SDK: no host bridge — ${detail} (see ${DOCS_BASE}#not_inside_host)`,
    );
  }
}

/// The bridge itself threw or rejected. Distinct from a protocol
/// failure, which is carried inside the response envelope (e.g. a
/// family controller's `{success: false, error}`).
export class BridgeTransportError extends SDKError {
  constructor(message: string, cause: unknown) {
    super(
      'BridgeTransportError',
      'BRIDGE_TRANSPORT',
      `${DOCS_BASE}#bridge_transport`,
      `${message} (see ${DOCS_BASE}#bridge_transport)`,
      { cause },
    );
  }
}

/// The bridge didn't respond within the configured timeout.
/// Default 10s; override per call via `timeoutMs`.
export class BridgeTimeoutError extends SDKError {
  readonly operation: string;
  readonly timeoutMs: number;
  constructor(operation: string, timeoutMs: number) {
    super(
      'BridgeTimeoutError',
      'BRIDGE_TIMEOUT',
      `${DOCS_BASE}#bridge_timeout`,
      `${operation} timed out after ${timeoutMs}ms (see ${DOCS_BASE}#bridge_timeout)`,
    );
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/// The host returned a payload that didn't match the expected schema
/// (`MiniAppContextSchema` for `getContext`, `HostCapabilitiesSchema`
/// for the capability handshake). Almost always means a version drift
/// between the SDK and the host.
export class InvalidResponseError extends SDKError {
  constructor(detail: string, cause: unknown) {
    super(
      'InvalidResponseError',
      'INVALID_RESPONSE',
      `${DOCS_BASE}#invalid_response`,
      `invalid host response: ${detail} (see ${DOCS_BASE}#invalid_response)`,
      { cause },
    );
  }
}
