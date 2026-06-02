import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, platform } from 'node:os';
import { logger } from '../util/logger.js';
import { LocalIOError } from '../util/errors.js';

/// Service + account identifiers for the OS keychain entry. The
/// account is always `default` in v1 (one identity per machine); a
/// future multi-account feature would switch to the email as the
/// account.
const SERVICE = 'i99dash.sdk';
const ACCOUNT = 'default';

/// Plaintext fallback location. Only used when keytar isn't
/// available — we still log a warning so the dev knows.
const FALLBACK_DIR = join(homedir(), '.config', 'i99dash');
const FALLBACK_FILE = join(FALLBACK_DIR, 'sdk.json');

/// Port for the keychain surface, so unit tests substitute an
/// in-memory impl without monkey-patching `keytar`.
export interface KeychainStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
  /// True iff the underlying impl keeps the value off the disk in
  /// plaintext. Used by `login` to decide whether to print the
  /// plaintext-fallback warning.
  readonly isSecure: boolean;
}

class KeytarKeychain implements KeychainStore {
  readonly isSecure = true;
  // Resolved via dynamic import so keytar stays an optional dep.

  private constructor(private readonly keytar: any) {}

  static async tryLoad(): Promise<KeytarKeychain | null> {
    try {
      // keytar is an optional dep; if the native build failed or the
      // platform doesn't provide a secret-store (locked-down Linux),
      // fall back gracefully.
      const mod = await import('keytar');
      return new KeytarKeychain(mod.default ?? mod);
    } catch {
      return null;
    }
  }

  async get(): Promise<string | null> {
    return (await this.keytar.getPassword(SERVICE, ACCOUNT)) ?? null;
  }

  async set(value: string): Promise<void> {
    await this.keytar.setPassword(SERVICE, ACCOUNT, value);
  }

  async clear(): Promise<void> {
    await this.keytar.deletePassword(SERVICE, ACCOUNT);
  }
}

class FileFallbackKeychain implements KeychainStore {
  readonly isSecure = false;

  async get(): Promise<string | null> {
    try {
      const raw = await readFile(FALLBACK_FILE, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && 'token' in parsed) {
        const token = (parsed as { token: unknown }).token;
        return typeof token === 'string' ? token : null;
      }
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new LocalIOError(`failed to read ${FALLBACK_FILE}`, err);
    }
  }

  async set(value: string): Promise<void> {
    await mkdir(dirname(FALLBACK_FILE), { recursive: true });
    // Write-then-chmod; on Windows chmod is mostly a no-op but the
    // mode bits are still set in the file record.
    await writeFile(FALLBACK_FILE, JSON.stringify({ token: value }), {
      mode: 0o600,
    });
  }

  async clear(): Promise<void> {
    await rm(FALLBACK_FILE, { force: true });
  }

  async exists(): Promise<boolean> {
    try {
      await readFile(FALLBACK_FILE, 'utf8');
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }
}

/// Composite store: queries the secure keychain first and falls back to
/// the plaintext file. Solves a real-world divergence — a developer
/// who first logged in via ``pnpm dlx`` (where keytar's native build is
/// missing) lands their token in the file, then runs ``whoami`` from a
/// local clone where keytar IS importable, and the file is silently
/// ignored. Composite makes both invocation paths see the same token.
///
/// Migration on read: if the secure store is empty but the file holds
/// a token AND keytar is available, ``get()`` migrates the token into
/// keytar and deletes the plaintext file. The plaintext copy never
/// lingers once the secure store can take over.
///
/// Writes go to the most-secure available store; the unused store is
/// cleared at the same time so there's never a stale duplicate.
/// Clears unconditionally affect both stores for the same reason —
/// logout actually clears your machine, regardless of which path it
/// was last invoked through.
class CompositeKeychain implements KeychainStore {
  private constructor(
    private readonly secure: KeytarKeychain | null,
    private readonly file: FileFallbackKeychain,
  ) {}

  /// Composite is "secure" iff its preferred backend is keytar;
  /// callers that warn on plaintext fallback (e.g. ``login``) read
  /// this flag.
  get isSecure(): boolean {
    return this.secure !== null;
  }

  static async load(): Promise<CompositeKeychain> {
    const secure = await KeytarKeychain.tryLoad();
    return new CompositeKeychain(secure, new FileFallbackKeychain());
  }

  async get(): Promise<string | null> {
    if (this.secure) {
      const fromKeytar = await this.secure.get();
      if (fromKeytar) return fromKeytar;
      // Keytar is empty but the file might carry a token from a
      // pre-keytar login; read it, migrate up, then return.
      const fromFile = await this.file.get();
      if (fromFile) {
        try {
          await this.secure.set(fromFile);
          await this.file.clear();
          logger.info(
            `migrated access token from ${FALLBACK_FILE} into the OS keychain; plaintext copy removed.`,
          );
        } catch {
          // Migration is best-effort. If the secure write fails for
          // some reason, the file copy stays in place and the next
          // call retries. We still return the token to the caller
          // because the user IS logged in.
        }
        return fromFile;
      }
      return null;
    }
    return await this.file.get();
  }

  async set(value: string): Promise<void> {
    if (this.secure) {
      await this.secure.set(value);
      // Defensive: if a previous login wrote the file fallback, clear
      // it so we never leave a stale plaintext copy. ``rm --force``
      // is a no-op when the file doesn't exist.
      if (await this.file.exists()) {
        await this.file.clear();
      }
    } else {
      logger.warn(
        `OS keychain unavailable on ${platform()}; falling back to ${FALLBACK_FILE} (mode 0600). ` +
          `Install keytar prerequisites to keep the access token out of your home directory.`,
      );
      await this.file.set(value);
    }
  }

  async clear(): Promise<void> {
    // Clear both unconditionally — logout should leave no trace,
    // regardless of which backend received the most recent set().
    if (this.secure) {
      try {
        await this.secure.clear();
      } catch {
        // Already absent / not-found is fine.
      }
    }
    if (await this.file.exists()) {
      await this.file.clear();
    }
  }
}

let cached: KeychainStore | undefined;

/// Loads the best available keychain for this OS. Caches the choice
/// per-process so a login+whoami round-trip doesn't re-probe keytar.
export async function getKeychain(): Promise<KeychainStore> {
  if (cached) return cached;
  cached = await CompositeKeychain.load();
  return cached;
}

/// Test seam — lets unit tests install an in-memory keychain.
export function __setKeychainForTest(store: KeychainStore | undefined): void {
  cached = store;
}
