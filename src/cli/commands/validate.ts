/// `i99dash validate` — pre-flight checks that catch dev mistakes
/// BEFORE the build. Each gap below corresponds to an entry in
/// `i99dash/sdk-workflow/cli.md`. Closing them at validate time
/// (cheap, ~150ms, no upload) is the difference between a 5-second
/// "fix it and retry" loop and a 15-second-build-then-fail loop.
///
/// Layered checks, in order of cost:
///   1. Schema-validate manifest.json (instant; same as the original
///      validate.ts behaviour).
///   2. APP_VERSION drift across src/**/*.html literals (fs scan;
///      closes cli.md §3).
///   3. Same-version-as-latest-published warning (one HTTP; closes
///      cli.md §4; needs auth).
///
/// The schema check is fatal; everything else is structured so a
/// caller can opt to demote warnings to info via flags.

import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

import { ApiClient } from '../api/client.js';
import { getDevStatus } from '../api/endpoints.js';
import { requireAccessToken } from '../auth/session.js';
import { loadManifest, loadSdkConfig } from '../config/load.js';
import { resolvedBackendUrl } from '../config/paths.js';
import { formatIssue, validateAssets } from '../util/assets.js';
import { logger } from '../util/logger.js';

export interface ValidateOptions {
  cwd: string;
  /// Skip every network-dependent check (republish warning).
  /// Used by CI / offline workflows so a missing token doesn't fail
  /// the schema-only validation that's the historical contract.
  offline?: boolean;
}

/// Schema-validate `manifest.json` + run cheap pre-flight checks.
/// Returns nothing — fatal failures throw, warnings log + return ok.
/// Safe to run from `publish` (which calls this first).
export async function runValidate(opts: ValidateOptions): Promise<void> {
  // 1. Schema. Throws ManifestInvalidError on a malformed file —
  // unchanged from the historical contract of this command.
  const manifest = await loadManifest(opts.cwd);
  logger.success(`manifest.json is valid (id=${manifest.id}, version=${manifest.version})`);

  // 2. Asset checks against the source tree (vanilla: appRoot; framework
  // projects may put assets in public/ — those are checked again at
  // build time against distDir, where they MUST be present). Source-
  // tree pass downgrades "missing" to a warning but always enforces
  // dimension/extension/size checks for files it does find.
  const config = await loadSdkConfig(opts.cwd);
  const appRoot = join(opts.cwd, config.appRoot);
  const sourceIssues = await validateAssets(manifest, { rootDir: appRoot, warnOnMissing: true });
  const sourceFatal = sourceIssues.filter((i) => i.kind !== 'missing');
  if (sourceFatal.length > 0) {
    for (const i of sourceFatal) logger.error(formatIssue(i));
    throw new ValidationFailedError('asset validation failed (see errors above)');
  }
  if (sourceIssues.length > 0) {
    // Only "missing" can land here (warnOnMissing downgrade).
    const missing = sourceIssues.filter((i) => i.kind === 'missing');
    for (const i of missing) {
      logger.info(
        `${i.field}: not found under appRoot — relying on framework public/ to ` +
          `produce it at build time. Will re-check after build.`,
      );
    }
  }

  // 3. APP_VERSION drift in starter-template HTML (sdk-workflow/cli.md §3).
  // Manifest version vs. hardcoded `const APP_VERSION = '...'` — most
  // starters render the version in the header from this constant and
  // forget to bump it on release. Warn, don't fail; some apps may
  // deliberately decouple the two strings.
  await warnAppVersionDrift({ cwd: opts.cwd, manifestVersion: manifest.version });

  // 3. Network-dependent checks. Skip on --offline or when no token
  // is present.
  if (opts.offline) {
    logger.info('skipping network checks (--offline)');
    return;
  }

  let token: string;
  try {
    token = await requireAccessToken();
  } catch {
    logger.info('not logged in — skipping republish check');
    return;
  }

  const api = new ApiClient(resolvedBackendUrl(), token);

  // 3. Same-version warning (sdk-workflow/cli.md §4). The backend
  // accepts a same-version resubmit but treats it as a no-op — the
  // CDN keeps the old bytes, the device never sees the new bundle.
  // Warn loudly so the dev bumps the version before publishing.
  try {
    const status = await getDevStatus(api, manifest.id);
    const app = status.apps.find((a) => a.appId === manifest.id);
    if (app && app.latestVersion === manifest.version) {
      logger.warn(
        `manifest.version=${manifest.version} matches the latest published version. ` +
          `The backend accepts the resubmit but the CDN keeps the old bytes — ` +
          `the device will not see your changes. Bump the version (e.g. ${suggestNextVersion(manifest.version)}) before publishing.`,
      );
    }
  } catch (err) {
    // Best-effort — a 404 on /dev/status is fine for first-time apps.
    logger.info(`skipping republish check (${(err as Error).message})`);
  }
}

export class ValidationFailedError extends Error {
  override name = 'ValidationFailedError' as const;
}

/// Scan src/**/*.html for `const APP_VERSION = '...'` and warn on
/// any literal that doesn't match the manifest. Linear scan; tiny
/// directory. Safe to run unconditionally — no false positives because
/// the regex is anchored on the const-keyword + quote pair.
async function warnAppVersionDrift(args: { cwd: string; manifestVersion: string }): Promise<void> {
  const srcDir = join(args.cwd, 'src');
  const re = /const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/g;
  const drifted: { file: string; literal: string }[] = [];
  for await (const file of walkHtml(srcDir)) {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw)) !== null) {
      if (match[1] !== args.manifestVersion) {
        drifted.push({ file: relative(args.cwd, file), literal: match[1]! });
      }
    }
  }
  if (drifted.length === 0) return;

  for (const { file, literal } of drifted) {
    logger.warn(
      `${file}: APP_VERSION='${literal}' but manifest.version='${args.manifestVersion}' — ` +
        `the deployed mini-app's header will show the stale value. ` +
        `Update the literal or wire it from manifest.json at build time (cli.md §3).`,
    );
  }
}

async function* walkHtml(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkHtml(full);
    } else if (extname(entry.name) === '.html') {
      yield full;
    }
  }
}

/// Best-effort SemVer patch bump suggestion for the warning message.
/// Falls back to `<version>-next` if the input doesn't look like SemVer.
function suggestNextVersion(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(v);
  if (!m) return `${v}-next`;
  const [, major, minor, patch, suffix] = m;
  return `${major}.${minor}.${Number(patch) + 1}${suffix ?? ''}`;
}
