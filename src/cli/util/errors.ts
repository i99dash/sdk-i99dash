/// CLI-side error hierarchy. The top-level handler in `src/index.ts`
/// catches these, prints a friendly message, and returns the
/// associated exit code. Every thrown error funnels through here so
/// exit codes are stable + scriptable.
export abstract class CLIError extends Error {
  abstract readonly exitCode: number;
  override readonly name: string;
  constructor(name: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = name;
  }
}

/// Not logged in / keychain miss. Exit 2.
export class NotAuthenticatedError extends CLIError {
  override readonly exitCode = 2;
  constructor(detail = 'not logged in; run `i99dash login` first') {
    super('NotAuthenticatedError', detail);
  }
}

/// Manifest / config schema error. Exit 3.
export class ManifestInvalidError extends CLIError {
  override readonly exitCode = 3;
  constructor(detail: string, cause?: unknown) {
    super('ManifestInvalidError', detail, cause === undefined ? undefined : { cause });
  }
}

/// Transport / DNS / TLS failure. Exit 4. Distinguished from
/// ServerError so CI scripts can retry one but not the other.
export class NetworkError extends CLIError {
  override readonly exitCode = 4;
  constructor(detail: string, cause?: unknown) {
    super('NetworkError', detail, cause === undefined ? undefined : { cause });
  }
}

/// 4xx / 5xx from the backend. The `statusCode` is captured so the
/// handler can render a specific hint ("try logging in again" on 401).
export class ServerError extends CLIError {
  override readonly exitCode = 5;
  constructor(
    public readonly statusCode: number,
    public readonly apiCode: string | undefined,
    message: string,
  ) {
    super('ServerError', message);
  }
}

/// Local FS / permissions failure. Exit 6.
export class LocalIOError extends CLIError {
  override readonly exitCode = 6;
  constructor(detail: string, cause?: unknown) {
    super('LocalIOError', detail, cause === undefined ? undefined : { cause });
  }
}

/// User-visible argument mistake (invalid flag combo, missing file).
/// Exit 64 to match `sysexits.h` EX_USAGE.
export class UsageError extends CLIError {
  override readonly exitCode = 64;
  constructor(detail: string) {
    super('UsageError', detail);
  }
}
