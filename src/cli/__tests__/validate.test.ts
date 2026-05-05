import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runValidate } from '../commands/validate.js';
import { ManifestInvalidError, LocalIOError } from '../util/errors.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'validate-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runValidate', () => {
  it('accepts a canonical manifest', async () => {
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'fuel_prices',
        name: { en: 'Fuel Prices' },
        icon: './assets/icon.svg',
        url: 'https://miniapps.i99dash.app/fuel/',
        version: '1.0.0',
        category: 'services',
      }),
    );
    // ``offline: true`` skips the network-dependent republish-status
    // check. Without it the test runner inherits any
    // ambient access token from the dev's keychain and calls the live
    // backend, which can exceed the 5s vitest timeout in CI / on slow
    // network and surface as a flaky timeout instead of a logic error.
    await expect(runValidate({ cwd: dir, offline: true })).resolves.not.toThrow();
  });

  it('throws ManifestInvalidError on bad shape', async () => {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ id: 'X' }));
    await expect(runValidate({ cwd: dir })).rejects.toBeInstanceOf(ManifestInvalidError);
  });

  it('throws LocalIOError when manifest.json is missing', async () => {
    await expect(runValidate({ cwd: dir })).rejects.toBeInstanceOf(LocalIOError);
  });
});
