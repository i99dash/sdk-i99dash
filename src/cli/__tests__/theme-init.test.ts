/// Tests for the `i99dash theme` command group:
///   * `theme init`     — scaffolds theme.json + icon + wallpaper note.
///   * `theme validate`  — zod-validates theme.json + asset checks.
///   * `theme build`     — produces a deterministic .i99theme tarball.
///
/// Exercised end-to-end against a tmp dir (init → validate → build) so a
/// refactor can't silently drop the icon copy or break the packer. No
/// network: publish's upload leg is not covered here (the same as the
/// mini-app suite, which mocks the API separately).

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runThemeInit } from '../commands/theme-init.js';
import { runThemeValidate, ThemeValidationFailedError } from '../commands/theme-validate.js';
import { runThemeBuild, themeBundleName } from '../commands/theme-build.js';
import { ManifestInvalidError, LocalIOError } from '../util/errors.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'theme-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runThemeInit', () => {
  it('scaffolds the standard set of files', async () => {
    await runThemeInit({ cwd: dir, dir: 'my-theme', force: false, yes: true });
    const target = join(dir, 'my-theme');
    const entries = (await readdir(target, { withFileTypes: true })).map((e) => e.name);
    expect(entries).toEqual(
      expect.arrayContaining(['package.json', 'theme.json', 'assets', 'wallpaper', '.gitignore']),
    );

    const manifest = JSON.parse(await readFile(join(target, 'theme.json'), 'utf8'));
    expect(manifest.id).toBe('my-theme');
    expect(manifest.icon).toBe('./assets/icon.svg');
    expect(manifest.category).toBe('other'); // non-interactive default
    expect(manifest.spec.brightness).toBe('dark');
    // The 8 surface keys + 3 required brand keys are present.
    expect(Object.keys(manifest.spec.colors)).toEqual(
      expect.arrayContaining([
        'background',
        'surfaceLow',
        'surfaceContainer',
        'surfaceHigh',
        'outline',
        'outlineVariant',
        'onSurface',
        'onSurfaceVariant',
        'accent',
        'secondary',
        'error',
      ]),
    );

    // The placeholder icon and wallpaper note made it in.
    const iconStat = await stat(join(target, 'assets', 'icon.svg'));
    expect(iconStat.isFile()).toBe(true);
    const wp = await readFile(join(target, 'wallpaper', 'WALLPAPER.md'), 'utf8');
    expect(wp).toMatch(/wallpaper/i);
  });

  it('honours --category when valid', async () => {
    await runThemeInit({ cwd: dir, dir: 'neon-theme', force: false, yes: true, category: 'neon' });
    const manifest = JSON.parse(await readFile(join(dir, 'neon-theme', 'theme.json'), 'utf8'));
    expect(manifest.category).toBe('neon');
  });

  it('rejects an unknown --category with a typed UsageError', async () => {
    await expect(
      runThemeInit({ cwd: dir, dir: 'x', force: false, yes: true, category: 'fashion' }),
    ).rejects.toThrow(/unknown theme category/);
  });

  it('refuses to clobber a non-empty dir without --force', async () => {
    await runThemeInit({ cwd: dir, dir: 'twice', force: false, yes: true });
    await expect(runThemeInit({ cwd: dir, dir: 'twice', force: false, yes: true })).rejects.toThrow(
      /not empty/,
    );
  });
});

describe('runThemeValidate', () => {
  it('passes on a freshly scaffolded theme', async () => {
    await runThemeInit({ cwd: dir, dir: 'my-theme', force: false, yes: true });
    const target = join(dir, 'my-theme');
    await expect(runThemeValidate({ cwd: target })).resolves.not.toThrow();
  });

  it('throws ManifestInvalidError on a bad-shape theme.json', async () => {
    await rm(join(dir, 'theme.json'), { force: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'theme.json'), JSON.stringify({ id: 'X' }));
    await expect(runThemeValidate({ cwd: dir })).rejects.toBeInstanceOf(ManifestInvalidError);
  });

  it('throws LocalIOError when theme.json is missing', async () => {
    await expect(runThemeValidate({ cwd: dir })).rejects.toBeInstanceOf(LocalIOError);
  });

  it('throws ThemeValidationFailedError when a declared asset is missing', async () => {
    await runThemeInit({ cwd: dir, dir: 'my-theme', force: false, yes: true });
    const target = join(dir, 'my-theme');
    // Delete the icon the manifest references — validate must catch it.
    await rm(join(target, 'assets', 'icon.svg'), { force: true });
    await expect(runThemeValidate({ cwd: target })).rejects.toBeInstanceOf(
      ThemeValidationFailedError,
    );
  });
});

describe('runThemeBuild', () => {
  it('produces a deterministic .i99theme tarball', async () => {
    await runThemeInit({ cwd: dir, dir: 'my-theme', force: false, yes: true });
    const target = join(dir, 'my-theme');

    const first = await runThemeBuild({ cwd: target });
    expect(first.tarballPath.endsWith(themeBundleName('my-theme', '0.1.0'))).toBe(true);
    expect(first.bytes).toBeGreaterThan(0);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);

    // Rebuilding the same inputs hashes identically (server dedupe).
    const second = await runThemeBuild({ cwd: target });
    expect(second.sha256).toBe(first.sha256);

    const built = await stat(first.tarballPath);
    expect(built.isFile()).toBe(true);
  });

  it('honours a custom --out dir', async () => {
    await runThemeInit({ cwd: dir, dir: 'my-theme', force: false, yes: true });
    const target = join(dir, 'my-theme');
    const res = await runThemeBuild({ cwd: target, out: 'out' });
    expect(res.tarballPath).toContain(`${join(target, 'out')}`);
  });
});
