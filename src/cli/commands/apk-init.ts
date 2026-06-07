import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { LocalIOError, UsageError } from '../util/errors.js';
import { logger } from '../util/logger.js';

export interface ApkInitOptions {
  cwd: string;
  dir: string;
  force: boolean;
}

/// Scaffolds a new native-APK app project: just `apk.json` + `.gitignore`.
/// You bring your own Android build — point `apkPath` at the release-signed
/// `.apk` and fill in `signerSha256` from `apksigner verify --print-certs`.
export async function runApkInit(opts: ApkInitOptions): Promise<void> {
  const target = resolve(opts.cwd, opts.dir);
  await ensureEmptyOrForced(target, opts.force);

  await writeFile(resolve(target, 'apk.json'), apkJsonTemplate(opts.dir));
  await writeFile(resolve(target, '.gitignore'), 'node_modules/\n*.apk\n.DS_Store\n');

  logger.success(`scaffolded native-app project at ${target}`);
  logger.info('next steps:');
  logger.info(`  cd ${opts.dir}`);
  logger.info('  # build + sign your release .apk, then edit apk.json:');
  logger.info('  #   apkPath       → path to the signed .apk');
  logger.info('  #   signerSha256  → apksigner verify --print-certs <apk>');
  logger.info('  i99dash apk validate');
  logger.info('  i99dash apk publish');
}

async function ensureEmptyOrForced(target: string, force: boolean): Promise<void> {
  try {
    const entries = await readdir(target);
    if (entries.length > 0 && !force) {
      throw new UsageError(
        `target ${target} is not empty — pass --force to overwrite, or pick a new dir`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(target, { recursive: true });
      return;
    }
    if (err instanceof UsageError) throw err;
    throw new LocalIOError(`failed to inspect ${target}`, err);
  }
}

function apkJsonTemplate(dirName: string): string {
  const id = `com.example.${(dirName.replace(/[^a-z0-9]/gi, '') || 'app').toLowerCase()}`;
  return `${JSON.stringify(
    {
      id,
      versionName: '1.0.0',
      versionCode: 1,
      apkPath: './app-release.apk',
      signerSha256: 'REPLACE_WITH_APKSIGNER_SHA256',
      category: 'utilities',
      requires: { minAndroidSdk: 29 },
    },
    null,
    2,
  )}\n`;
}
