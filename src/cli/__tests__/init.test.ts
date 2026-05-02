/// Tests for `i99dash init --template <name>`.
///
/// Targets the two paths the command supports today:
///   * vanilla — generates files inline (string templates), exercised
///     end-to-end so a refactor can't silently drop the icon copy.
///   * cluster-widget — bundles `src/index.html` + `src/cluster.html`
///     from `src/cli/templates/cluster-widget/`. Asserts the manifest
///     declares the right Phase A permissions
///     (`display.read`, `surface.write`).
///
/// Doesn't network or sideload — pure filesystem scaffolding test.

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runInit, TEMPLATES } from '../commands/init.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'init-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runInit', () => {
  it('TEMPLATES enumerates both supported names', () => {
    expect(TEMPLATES).toContain('vanilla');
    expect(TEMPLATES).toContain('cluster-widget');
  });

  it('vanilla scaffold writes the standard set of files', async () => {
    await runInit({
      cwd: dir,
      dir: 'my-app',
      template: 'vanilla',
      force: false,
      yes: true,
    });
    const target = join(dir, 'my-app');
    const entries = (await readdir(target, { withFileTypes: true })).map((e) => e.name);
    expect(entries).toEqual(
      expect.arrayContaining([
        'package.json',
        'manifest.json',
        'sdk.config.json',
        'src',
        'mocks',
        '.gitignore',
      ]),
    );
    const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
    expect(manifest.id).toBe('my-app');
    expect(manifest.icon).toBe('./assets/icon.svg');
    // Vanilla scaffolds leave `requiredPermissions` off — Phase A
    // families need to be opted into per-template.
    expect(manifest.requiredPermissions).toBeUndefined();
  });

  it('cluster-widget scaffold copies the bundled HTML + declares Phase A perms', async () => {
    await runInit({
      cwd: dir,
      dir: 'my-cluster',
      template: 'cluster-widget',
      force: false,
      yes: true,
    });
    const target = join(dir, 'my-cluster');

    // Both bundled HTML files made it into src/.
    const srcEntries = (await readdir(join(target, 'src'))).filter((n) => !n.startsWith('.'));
    expect(srcEntries).toEqual(expect.arrayContaining(['index.html', 'cluster.html']));

    const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
    expect(manifest.id).toBe('my-cluster');
    expect(manifest.requiredPermissions).toEqual(['display.read', 'surface.write']);
    expect(manifest.minHostVersion).toBe('1.3.0');
    expect(manifest.category).toBe('developer');
  });

  it('rejects an unknown template with a typed UsageError', async () => {
    await expect(
      runInit({
        cwd: dir,
        dir: 'should-not-exist',
        // Cast through unknown to bypass the type guard the CLI
        // entry point already enforces — testing the runtime side.
        template: 'mystery' as unknown as 'vanilla',
        force: false,
        yes: true,
      }),
    ).rejects.toThrow(/unknown template/);
  });
});
