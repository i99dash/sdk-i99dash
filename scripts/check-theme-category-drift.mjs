#!/usr/bin/env node
/**
 * Verifies that the canonical THEME category slug list in this SDK is
 * byte-identical to the copy vendored in backend-i99dash. The two MUST
 * stay in sync — Pydantic builds its enum from the backend copy at
 * module init, and any drift produces "category invalid" errors at
 * theme-publish time with no matching client-side hint.
 *
 * Usage:
 *   node scripts/check-theme-category-drift.mjs
 *
 * Override the backend path via env var when running outside the
 * monorepo checkout:
 *   BACKEND_REPO_PATH=/path/to/backend-i99dash node scripts/check-theme-category-drift.mjs
 *
 * Unlike the mini-app drift check, a MISSING backend copy is NOT a
 * failure here: the themes feature is mid-rollout and the backend file
 * lands in a later PR. We EXIT 0 with a clear notice so this check can
 * ship green ahead of the backend side, then becomes a real gate once
 * the backend copy exists. Drift (both files present, contents differ)
 * is still a hard failure.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SDK_FILE = join(ROOT, 'src', 'types', 'theme-category-slugs.json');
const BACKEND_FILE =
  process.env.BACKEND_REPO_PATH !== undefined
    ? join(
        process.env.BACKEND_REPO_PATH,
        'app',
        'api',
        'v1',
        'themes_publish',
        'theme_category_slugs.json',
      )
    : resolve(
        ROOT,
        '..',
        'backend-i99dash',
        'app',
        'api',
        'v1',
        'themes_publish',
        'theme_category_slugs.json',
      );

function fail(msg) {
  console.error(`\n❌ theme-category-slugs drift: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(BACKEND_FILE)) {
  console.log(
    `ℹ theme-category-slugs: backend copy not present yet at\n` +
      `   ${BACKEND_FILE}\n` +
      `   skipping drift check (exit 0). Sync the SDK file there once the\n` +
      `   backend themes_publish dir lands, then this becomes a hard gate.`,
  );
  process.exit(0);
}

const [sdkRaw, backendRaw] = await Promise.all([
  readFile(SDK_FILE, 'utf8'),
  readFile(BACKEND_FILE, 'utf8'),
]);

let sdkSlugs;
let backendSlugs;
try {
  sdkSlugs = JSON.parse(sdkRaw);
  backendSlugs = JSON.parse(backendRaw);
} catch (e) {
  fail(`one of the files is not valid JSON: ${e.message}`);
}

if (!Array.isArray(sdkSlugs) || !sdkSlugs.every((s) => typeof s === 'string')) {
  fail(`SDK file ${SDK_FILE} must be an array of strings`);
}
if (!Array.isArray(backendSlugs) || !backendSlugs.every((s) => typeof s === 'string')) {
  fail(`backend file ${BACKEND_FILE} must be an array of strings`);
}

// Order matters — Pydantic enum values come out in declaration order,
// so a reorder is also drift even though the set is the same.
const sameLength = sdkSlugs.length === backendSlugs.length;
const sameOrder = sameLength && sdkSlugs.every((s, i) => s === backendSlugs[i]);

if (!sameOrder) {
  console.error('\n❌ theme-category-slugs drift detected\n');
  console.error(`   SDK     (${SDK_FILE}):`);
  console.error(`     ${JSON.stringify(sdkSlugs)}`);
  console.error(`   backend (${BACKEND_FILE}):`);
  console.error(`     ${JSON.stringify(backendSlugs)}`);
  console.error('\n   sync the two files (and re-deploy whichever side is behind).\n');
  process.exit(1);
}

console.log(`✓ theme-category-slugs in sync (${sdkSlugs.length} slugs).`);
