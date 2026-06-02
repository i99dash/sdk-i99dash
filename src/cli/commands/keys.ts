import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import { ApiClient } from '../api/client.js';
import { addSshKey, listSshKeys, removeSshKey, type SshKey } from '../api/endpoints.js';
import { requireAccessToken } from '../auth/session.js';
import { resolvedBackendUrl } from '../config/paths.js';
import { LocalIOError, UsageError } from '../util/errors.js';
import { logger } from '../util/logger.js';

/// Build and return the `keys` parent command subtree — manage the SSH
/// public keys that authenticate `i99dash login`. Bootstrap your FIRST
/// key in the web console (Account → SSH keys); the CLI can't add a key
/// before it can authenticate (the GitHub model). Once logged in, manage
/// the rest here. Registered in src/cli.ts via `program.addCommand(...)`.
export function makeKeysCommand(): Command {
  const keys = new Command('keys').description('manage the SSH keys that authenticate your CLI');

  // -------------------------------------------------------------------------
  // keys list
  // -------------------------------------------------------------------------
  keys
    .command('list')
    .description('list the SSH public keys registered on your account')
    .action(async () => {
      const api = await makeApi();
      const rows = await listSshKeys(api);
      if (rows.length === 0) {
        logger.info('No SSH keys registered. Add one with `i99dash keys add <path-to-pub>`.');
        return;
      }
      const header = padRow(['FINGERPRINT', 'NAME', 'TYPE', 'LAST USED']);
      logger.log(header);
      logger.log('-'.repeat(header.length));
      for (const k of rows) {
        logger.log(
          padRow([
            k.fingerprint,
            k.name || '—',
            k.keyType,
            k.lastUsedAt ? fmtRelative(k.lastUsedAt) : 'never',
          ]),
        );
      }
    });

  // -------------------------------------------------------------------------
  // keys add <pubkey_path>
  // -------------------------------------------------------------------------
  keys
    .command('add <pubkey_path>')
    .description('register an OpenSSH public key (the contents of an *.pub file)')
    .option('--name <label>', 'label for the key (defaults to the key comment, then the filename)')
    .action(async (pubkeyPath: string, opts: { name?: string }) => {
      const publicKey = readPublicKey(pubkeyPath);
      const name = (opts.name ?? deriveName(publicKey, pubkeyPath)).slice(0, 80);
      const api = await makeApi();
      logger.start(`registering SSH key from ${pubkeyPath}…`);
      const key = await addSshKey(api, publicKey, name);
      logger.success(`added "${key.name || key.fingerprint}" (${key.fingerprint}).`);
    });

  // -------------------------------------------------------------------------
  // keys remove <id>
  // -------------------------------------------------------------------------
  keys
    .command('remove <id>')
    .description('revoke one of your SSH keys by id (see `keys list`)')
    .action(async (id: string) => {
      const api = await makeApi();
      logger.start(`revoking SSH key ${id}…`);
      await removeSshKey(api, id);
      logger.success(`SSH key ${id} revoked — it can no longer log in.`);
    });

  return keys;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function makeApi(): Promise<ApiClient> {
  const token = await requireAccessToken();
  return new ApiClient(resolvedBackendUrl(), token);
}

/// Read a single OpenSSH public-key line from disk. Public keys are
/// one line; we take the first non-empty one and reject anything that
/// looks like a PRIVATE key (a common copy-paste mistake — and one we
/// must never transmit).
function readPublicKey(path: string): string {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new LocalIOError(`could not read public key at ${path}`, cause);
  }
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) {
    throw new UsageError(`${path} is empty`);
  }
  if (line.includes('PRIVATE KEY')) {
    throw new UsageError(
      `${path} looks like a PRIVATE key — pass the PUBLIC key (the *.pub file) instead`,
    );
  }
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-)/.test(line)) {
    throw new UsageError(`${path} doesn't look like an OpenSSH public key`);
  }
  return line;
}

/// Default a key's label from its trailing comment (`ssh-ed25519 AAAA…
/// user@host` → `user@host`), falling back to the source filename.
function deriveName(publicKey: string, path: string): string {
  const parts = publicKey.split(/\s+/);
  if (parts.length >= 3 && parts[2]) return parts[2];
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.pub$/, '');
}

const COL_WIDTHS = [50, 24, 14, 12];

function padRow(cells: string[]): string {
  return cells.map((cell, i) => cell.padEnd(COL_WIDTHS[i] ?? 12)).join('  ');
}

function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// `SshKey` is re-exported for callers that render key rows elsewhere.
export type { SshKey };
