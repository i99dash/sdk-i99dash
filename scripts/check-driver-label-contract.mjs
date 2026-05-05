#!/usr/bin/env node
/**
 * Verifies that every `overrideLabel` value the host's
 * `VehicleProfile.kt` emits is in the SDK's reserved-labels enum
 * (`RESERVED_OVERRIDE_LABELS` in `src/runtime/display.ts`).
 *
 * Why this matters: the SDK promises `overrideLabel === 'Driver'`
 * means *the driver-eyeline display on this trim, regardless of
 * role*. If the host adds a new label without coordinating an SDK
 * release that documents the semantic, mini-apps reading
 * `overrideLabel` get an opaque string they can't program against.
 * This check fails the SDK PR (or the host PR, depending on which
 * side ran out of sync) so the mismatch surfaces in code review,
 * not at runtime on a customer's car.
 *
 * Asymmetric on purpose:
 *   * SDK enum → Kotlin: NOT checked. The SDK can reserve a label
 *     before any host emits it (forward declaration is fine).
 *   * Kotlin → SDK enum: REQUIRED. Every `overrideLabels = mapOf(N
 *     to "X")` value across every profile must be in the SDK enum.
 *
 * Usage:
 *   node scripts/check-driver-label-contract.mjs
 *
 * Override the host repo path when running outside the monorepo:
 *   CAR_REPO_PATH=/path/to/car-i99dash
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SDK_FILE = join(ROOT, 'src', 'runtime', 'display.ts');
const CAR_REPO = process.env.CAR_REPO_PATH ?? resolve(ROOT, '..', 'car-i99dash');
const KOTLIN_FILE = join(
  CAR_REPO,
  'android',
  'app',
  'src',
  'main',
  'kotlin',
  'com',
  'i99dev',
  'i99dash',
  'car',
  'VehicleProfile.kt',
);

function fail(msg) {
  console.error(`\n❌ driver-label contract: ${msg}\n`);
  process.exit(1);
}

function stripLineComments(s) {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/// SDK: `export const RESERVED_OVERRIDE_LABELS = ['Driver', ...] as const`.
async function loadSdkReserved() {
  const raw = await readFile(SDK_FILE, 'utf8');
  const match = raw.match(/RESERVED_OVERRIDE_LABELS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!match) fail(`couldn't locate RESERVED_OVERRIDE_LABELS in ${SDK_FILE}`);
  return new Set([...stripLineComments(match[1]).matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

/// Kotlin: every `overrideLabels = mapOf(N to "X", M to "Y")` block
/// in VehicleProfile.kt. Walks each VehicleProfile object's
/// `overrideLabels` field and pulls the string values verbatim.
///
/// Pattern: `overrideLabels = mapOf(<int> to "<label>", ...)` —
/// straightforward except for the `emptyMap()` form which we skip.
async function loadKotlinLabels() {
  if (!existsSync(KOTLIN_FILE)) {
    fail(
      `expected host file at ${KOTLIN_FILE} — set CAR_REPO_PATH if your local clone is named differently.`,
    );
  }
  const raw = stripLineComments(await readFile(KOTLIN_FILE, 'utf8'));
  // Match every `overrideLabels = mapOf(...)` block. The negative
  // lookahead skips `emptyMap()` calls. Profiles use exactly this
  // shape — no helper functions wrapping the map literal.
  const blocks = [...raw.matchAll(/overrideLabels\s*=\s*mapOf\(([\s\S]*?)\)/g)];
  const labels = new Set();
  for (const block of blocks) {
    for (const m of block[1].matchAll(/"([^"]+)"/g)) {
      labels.add(m[1]);
    }
  }
  return labels;
}

const reserved = await loadSdkReserved();
const used = await loadKotlinLabels();

const undeclared = [...used].filter((label) => !reserved.has(label));
if (undeclared.length > 0) {
  console.error(`\n❌ driver-label contract: host emits label(s) not in SDK enum\n`);
  console.error(`   SDK enum (${SDK_FILE}):`);
  console.error(`     ${JSON.stringify([...reserved].sort())}`);
  console.error(`   Host emits (${KOTLIN_FILE}):`);
  console.error(`     ${JSON.stringify([...used].sort())}`);
  console.error(`   Missing from SDK enum:`);
  console.error(`     ${JSON.stringify(undeclared.sort())}`);
  console.error(
    `\n   Add the missing label(s) to RESERVED_OVERRIDE_LABELS and document the semantic`,
  );
  console.error(
    `   in /docs/api/i99dash/runtime/display-snapshot before merging the host change.\n`,
  );
  process.exit(1);
}

const reservedNotEmittedYet = [...reserved].filter((label) => !used.has(label));
if (reservedNotEmittedYet.length > 0) {
  // Soft warning — the SDK can reserve a label ahead of any host
  // that emits it. Telemetry-only; doesn't fail the check.
  console.error(
    `\n⚠️  ${reservedNotEmittedYet.length} reserved label(s) not yet emitted by any host profile: ${JSON.stringify(reservedNotEmittedYet)}\n`,
  );
}

console.log(
  `✅ driver-label contract: ${used.size} host label(s) in sync with SDK enum (${reserved.size} reserved).`,
);
