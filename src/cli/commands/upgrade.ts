/// `i99dash upgrade` — self-update for the standalone CLI binary.
///
/// Reads the latest manifest from the backend
/// (`GET /api/v1/downloads/cli_i99dash` — the same one the website and
/// install scripts use), and if a newer build is published for this OS,
/// downloads it, verifies its SHA-256, and atomically replaces the running
/// executable in place. Only meaningful for the compiled binary — a
/// global npm install is told to update via npm instead.
import { createHash } from 'node:crypto';
import { chmodSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { resolvedBackendUrl } from '../config/paths.js';
import { logger } from '../util/logger.js';

const KIND = 'cli_i99dash';
const NAME = 'i99dash';

interface DownloadAsset {
  platform: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  filename: string;
}
interface DownloadManifest {
  version: string;
  assets: DownloadAsset[];
}

/** Numeric-core version key; pre-release/build metadata is dropped so an
 * `-rc` build never sorts above its release. `v5.4.1` → [5,4,1]. */
export function versionTuple(v: string): number[] {
  const core = v.trim().replace(/^v/i, '').split('-')[0]!.split('+')[0]!;
  return core.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
}

export function isNewer(latest: string, current: string): boolean {
  const a = versionTuple(latest);
  const b = versionTuple(current);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function platformKey(): string | null {
  const p = process.platform;
  const arch = process.arch;
  if (p === 'linux') return 'linux-x64';
  if (p === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  if (p === 'win32') return 'windows-x64';
  return null;
}

/** True when running as a compiled single-file binary (pkg/SEA/bun) rather
 * than `node dist/cli.js`. Only then is `process.execPath` our own binary. */
function isFrozenBinary(): boolean {
  if ((process as unknown as { pkg?: unknown }).pkg !== undefined) return true;
  const exe = basename(process.execPath).toLowerCase();
  return exe.startsWith(NAME); // i99dash / i99dash.exe / i99dash-linux-x64
}

async function fetchManifest(base: string): Promise<DownloadManifest | null> {
  const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/downloads/${KIND}`);
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`download service returned ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const data =
    body && body['success'] === true && 'data' in body
      ? (body['data'] as DownloadManifest)
      : (body as unknown as DownloadManifest);
  return data;
}

function replaceSelf(newBinary: string, target: string): void {
  let mode = 0o755;
  try {
    mode = statSync(target).mode;
  } catch {
    // keep default
  }
  chmodSync(newBinary, mode | 0o700);

  if (process.platform === 'win32') {
    const old = `${target}.old`;
    try {
      rmSync(old, { force: true });
    } catch {
      /* ignore */
    }
    renameSync(target, old); // a running .exe can't be overwritten, only renamed
    renameSync(newBinary, target);
    try {
      rmSync(old, { force: true });
    } catch {
      /* locked until exit — cleaned next run */
    }
  } else {
    renameSync(newBinary, target); // atomic over the running file on POSIX
  }
}

function cleanupStale(target: string): void {
  try {
    rmSync(`${target}.old`, { force: true });
  } catch {
    /* ignore */
  }
}

export async function runUpgrade(opts: {
  currentVersion: string;
  checkOnly?: boolean;
}): Promise<void> {
  const target = process.execPath;
  cleanupStale(target);

  const manifest = await fetchManifest(resolvedBackendUrl());
  if (!manifest?.version) {
    logger.warn(`${NAME} is not available on the download channel right now.`);
    return;
  }

  const latest = manifest.version;
  if (!isNewer(latest, opts.currentVersion)) {
    logger.info(`${NAME} is already up to date (v${opts.currentVersion}).`);
    return;
  }
  if (opts.checkOnly) {
    logger.info(`a newer ${NAME} is available: v${opts.currentVersion} → v${latest}`);
    return;
  }
  if (!isFrozenBinary()) {
    logger.info(
      `v${latest} is available. This is an npm install — update with: npm install -g ${NAME}`,
    );
    return;
  }

  const plat = platformKey();
  const asset = plat ? manifest.assets.find((a) => a.platform === plat) : undefined;
  if (!asset) {
    logger.error(`no ${plat ?? process.platform} build is published for v${latest}.`);
    return;
  }

  logger.info(`updating ${NAME} v${opts.currentVersion} → v${latest} (${plat})…`);
  const res = await fetch(asset.url);
  if (!res.ok) {
    logger.error(`download failed: ${res.status}`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = createHash('sha256').update(buf).digest('hex');
  if (asset.sha256 && digest.toLowerCase() !== asset.sha256.toLowerCase()) {
    logger.error('checksum mismatch — refusing to install.');
    return;
  }

  const tmp = join(tmpdir(), `${NAME}-${latest}-${process.pid}.new`);
  writeFileSync(tmp, buf);
  try {
    replaceSelf(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EACCES' || code === 'EPERM') {
      logger.error(
        `permission denied writing ${target}. Re-run with elevated privileges, ` +
          `or reinstall to a writable location.`,
      );
      return;
    }
    throw err;
  }
  logger.success(`done — ${NAME} is now v${latest}.`);
}
