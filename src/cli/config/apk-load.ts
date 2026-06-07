import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ManifestInvalidError, LocalIOError } from '../util/errors.js';

/// On-disk filename for a native-APK app's catalog row. Mirrors the
/// mini-app `manifest.json` / theme `theme.json`: an APK project keeps its
/// `apk.json` at the project root next to the built `.apk`.
export const APK_MANIFEST_FILE = 'apk.json';

/// Reverse-DNS Android applicationId (2+ lowercase labels). Must match the
/// backend's `is_valid_native_package_id` so a locally-valid id can't be
/// rejected server-side.
const PACKAGE_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/// First-party names are reserved for the platform's own OTA channels and
/// can never be published by a third party.
const RESERVED_PACKAGE_IDS = new Set(['i99dash', 'dashdoctor', 'fq']);

export const ApkManifestSchema = z
  .object({
    /// = the Android applicationId.
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(PACKAGE_ID_RE, 'must be a reverse-DNS applicationId (e.g. com.acme.dashcam)')
      .refine((v) => !RESERVED_PACKAGE_IDS.has(v), 'this package id is reserved'),
    /// Android versionCode — the monotonic integer ordering key.
    versionCode: z.number().int().positive(),
    /// Display version (e.g. "1.2.0"). Not parsed for ordering.
    versionName: z.string().min(1).max(64),
    /// Relative path to the release-signed `.apk`.
    apkPath: z.string().min(1),
    /// SHA-256 of the APK's Android signing certificate (from
    /// `apksigner verify --print-certs` or `keytool -list`). TOFU-pinned on
    /// first publish and immutable thereafter.
    signerSha256: z.string().min(1).max(128),
    category: z.string().max(64).optional(),
    /// Compatibility requirements the car evaluates (androidSdk / abi / dilink).
    requires: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ApkManifest = z.infer<typeof ApkManifestSchema>;

export function apkManifestPath(projectRoot: string): string {
  return resolve(projectRoot, APK_MANIFEST_FILE);
}

/// Read + Zod-validate `apk.json`. Same error contract as the theme /
/// mini-app loaders so the CLI's top-level handler maps both to the same
/// exit codes.
export async function loadApkManifest(projectRoot: string): Promise<ApkManifest> {
  const file = apkManifestPath(projectRoot);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (cause) {
    throw new LocalIOError(`could not read ${file}`, cause);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ManifestInvalidError('apk.json is not valid JSON', cause);
  }
  const result = ApkManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ManifestInvalidError(
      `apk.json failed schema validation:\n${formatZodIssues(result.error.issues)}`,
      result.error,
    );
  }
  return result.data;
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues.map((i) => `  · ${i.path.join('.') || '<root>'}: ${i.message}`).join('\n');
}
