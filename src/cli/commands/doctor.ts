/// `i99dash doctor` — preflight check for a mini-app project.
///
/// Runs a small set of read-only checks and prints a colour-coded
/// pass/fail report. Designed to cut the "why isn't my mini-app
/// working?" loop from minutes of digging to one command. None of
/// the checks mutate state — safe to run in CI, in a hook, on a
/// teammate's laptop.
///
/// Categories (each is a row in the report):
///   • manifest      — schema-valid manifest.json
///   • config        — sdk.config.json present + parses
///   • dist          — dist/ exists if buildCommand was declared
///   • dev-server    — http://127.0.0.1:<port>/_sdk/state reachable
///
/// Exit codes:
///   0 — every required check passed
///   1 — one or more checks failed
///   2 — a check could not run (e.g. manifest unreadable). Treated
///       as failure for CI but printed differently.

import { stat } from 'node:fs/promises';

import { MiniAppManifestSchema } from '../../types/index.js';

import { loadManifest, loadSdkConfig } from '../config/load.js';
import { projectPaths } from '../config/paths.js';
import { ManifestInvalidError, UsageError } from '../util/errors.js';
import { logger } from '../util/logger.js';

/// Top-level manifest fields the CLI was built against. If the resolved
/// `@i99dash/sdk-types` is missing any of these, the dev's `pnpm` has
/// hoisted a stale copy and `MiniAppManifestSchema.parse(manifest)` is
/// silently stripping fields before the publish request goes out. This
/// is `sdk-workflow/cli.md` §2 — pnpm-hoist hazard.
///
/// Update this list whenever a new top-level field lands in
/// `@i99dash/sdk-types`. The set is small and rarely churns; keeping
/// it as an explicit constant makes drift visible in PR review.
const REQUIRED_MANIFEST_FIELDS = [
  'id',
  'name',
  'icon',
  'url',
  'version',
  'category',
  'safeWhileDriving',
] as const;

export interface DoctorOptions {
  cwd: string;
  /// Skip the dev-server reachability check. Useful in CI where there
  /// is no `pnpm dev` process running.
  skipDevServer?: boolean;
}

type Status = 'pass' | 'fail' | 'skip';
interface Check {
  name: string;
  status: Status;
  detail: string;
}

export async function runDoctor(opts: DoctorOptions): Promise<void> {
  const checks: Check[] = [];
  const paths = projectPaths(opts.cwd);

  // 1. Manifest — fundamental; everything downstream depends on it.
  let manifestOk = false;
  try {
    const m = await loadManifest(paths.root);
    checks.push({
      name: 'manifest',
      status: 'pass',
      detail: `${m.id}@${m.version}`,
    });
    manifestOk = true;
  } catch (e) {
    checks.push({
      name: 'manifest',
      status: 'fail',
      detail:
        e instanceof ManifestInvalidError
          ? (e.message.split('\n')[0] ?? 'invalid')
          : `unreadable: ${(e as Error).message}`,
    });
  }

  // 1.5. sdk-types schema-shape check (sdk-workflow/cli.md §2).
  // The resolved `@i99dash/sdk-types` must know about every field the
  // CLI was built against; pnpm hoist drift means a stale copy may
  // still be on the resolver's path and silently strip fields on
  // `MiniAppManifestSchema.parse(...)`. Inspect the schema's keys
  // directly so we don't have to maintain a separate version string.
  try {
    const schemaShape = (MiniAppManifestSchema as unknown as { shape: Record<string, unknown> })
      .shape;
    const knownKeys = new Set(Object.keys(schemaShape));
    const missing = REQUIRED_MANIFEST_FIELDS.filter((k) => !knownKeys.has(k));
    if (missing.length === 0) {
      checks.push({
        name: 'sdk-types',
        status: 'pass',
        detail: `${REQUIRED_MANIFEST_FIELDS.length} expected fields present`,
      });
    } else {
      checks.push({
        name: 'sdk-types',
        status: 'fail',
        detail:
          `resolved @i99dash/sdk-types is missing field(s): ${missing.join(', ')} — ` +
          `pnpm hoist drift. Run \`rm -rf node_modules pnpm-lock.yaml && pnpm install\` ` +
          `then re-run this command (cli.md §2).`,
      });
    }
  } catch (e) {
    checks.push({
      name: 'sdk-types',
      status: 'fail',
      detail: `could not read MiniAppManifestSchema.shape: ${(e as Error).message}`,
    });
  }

  // 2. Config — optional, but flag a malformed file.
  let configPort = 5173;
  try {
    const cfg = await loadSdkConfig(paths.root);
    configPort = cfg.dev.port;
    checks.push({
      name: 'config',
      status: 'pass',
      detail: `port=${cfg.dev.port}, host=${cfg.dev.host}`,
    });
  } catch (e) {
    checks.push({
      name: 'config',
      status: 'fail',
      detail: `sdk.config.json failed to parse: ${(e as Error).message}`,
    });
  }

  // 3. Dev-server — best-effort probe; skipped under --skip-dev-server.
  if (opts.skipDevServer) {
    checks.push({
      name: 'dev-server',
      status: 'skip',
      detail: 'skipped (--skip-dev-server)',
    });
  } else {
    const url = `http://127.0.0.1:${configPort}/_sdk/state`;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 1500);
      const res = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      if (res.ok) {
        checks.push({ name: 'dev-server', status: 'pass', detail: url });
      } else {
        checks.push({
          name: 'dev-server',
          status: 'fail',
          detail: `${url} -> HTTP ${res.status}`,
        });
      }
    } catch {
      checks.push({
        name: 'dev-server',
        status: 'skip',
        detail: `${url} unreachable (is \`pnpm dev\` running?)`,
      });
    }
  }

  // 4. dist — only meaningful if a manifest exists and points at a
  //    static tree we can verify.
  if (manifestOk) {
    const distExists = await pathExists(paths.distDir);
    checks.push({
      name: 'dist',
      status: distExists ? 'pass' : 'skip',
      detail: distExists ? paths.distDir : 'no dist/ — run `i99dash build` before publish',
    });
  }

  printReport(checks);

  const failed = checks.some((c) => c.status === 'fail');
  if (failed) {
    throw new UsageError('one or more doctor checks failed');
  }
}

function printReport(checks: Check[]): void {
  const colWidth = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const tag = badge(c.status);
    const padded = c.name.padEnd(colWidth);
    if (c.status === 'fail') {
      logger.error(`${tag}  ${padded}  ${c.detail}`);
    } else if (c.status === 'skip') {
      logger.warn(`${tag}  ${padded}  ${c.detail}`);
    } else {
      logger.info(`${tag}  ${padded}  ${c.detail}`);
    }
  }
}

function badge(s: Status): string {
  if (s === 'pass') return '\x1b[32m PASS \x1b[0m';
  if (s === 'fail') return '\x1b[31m FAIL \x1b[0m';
  return '\x1b[33m SKIP \x1b[0m';
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
