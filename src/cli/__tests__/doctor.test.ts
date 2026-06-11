import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../commands/doctor.js';
import { UsageError } from '../util/errors.js';

const validManifest = {
  id: 'fuel_prices',
  name: { en: 'Fuel Prices' },
  icon: './assets/icon.svg',
  url: 'https://miniapps.i99dash.app/fuel/',
  version: '1.0.0',
  category: 'services',
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'doctor-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runDoctor', () => {
  it('passes on a canonical project (dev-server skipped)', async () => {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(validManifest));
    await expect(runDoctor({ cwd: dir, skipDevServer: true })).resolves.not.toThrow();
  });

  it('fails when manifest is invalid', async () => {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ id: 'X' }));
    await expect(runDoctor({ cwd: dir, skipDevServer: true })).rejects.toBeInstanceOf(UsageError);
  });
});
