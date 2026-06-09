import { z } from 'zod';
import {
  MiniAppManifestSchema,
  type MiniAppManifest,
  ThemeManifestSchema,
  type ThemeManifest,
} from '../../types/index.js';

import type { ApiClient } from './client.js';

/// Per-route helpers. Keeps the response-validation parsers in one
/// place so a CLI command that needs `getDevMe` doesn't redefine the
/// shape locally.

// SDK-facing endpoints emit camelCase (matching /mini-apps/upload-url,
// /submit, /mine), even though the rest of the backend uses
// snake_case for the car-side surfaces. Picked for consistency with
// the TypeScript SDK's own types in @i99dash/sdk-types — we never
// want a field the CLI sees under two spellings.
//
// `email` is nullable — a Telegram-primary user who hasn't linked
// email yet still has an identity, just no email address. The CLI
// renders `"<no email>"` in that case.
const DevMeSchema = z.object({
  email: z.string().email().nullable(),
  devId: z.string().min(1),
  displayName: z.string().nullable().optional(),
  isDeveloper: z.boolean(),
});
export type DevMe = z.infer<typeof DevMeSchema>;

export async function getDevMe(api: ApiClient): Promise<DevMe> {
  return api.get('/api/v1/dev/me', (body) => DevMeSchema.parse(body));
}

const UploadUrlResponseSchema = z.object({
  uploadUrl: z.string().url(),
  bundleId: z.string().min(1),
  expiresAt: z.string().optional(),
});
export type UploadUrlResponse = z.infer<typeof UploadUrlResponseSchema>;

export interface UploadUrlRequest {
  appId: string;
  contentLength: number;
  sha256: string;
}

export async function requestUploadUrl(
  api: ApiClient,
  req: UploadUrlRequest,
): Promise<UploadUrlResponse> {
  return api.post('/api/v1/mini-apps/upload-url', req, (body) =>
    UploadUrlResponseSchema.parse(body),
  );
}

const SubmitResponseSchema = z.object({
  ok: z.literal(true),
  reviewStatus: z.enum(['pending', 'auto-approved']),
  publishedAt: z.string().optional(),
});
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;

export async function submitManifest(
  api: ApiClient,
  manifest: MiniAppManifest,
  bundleId: string,
): Promise<SubmitResponse> {
  return api.post(
    '/api/v1/mini-apps/submit',
    { manifest: MiniAppManifestSchema.parse(manifest), bundleId },
    (body) => SubmitResponseSchema.parse(body),
  );
}

// ---------------------------------------------------------------------------
// Theme-marketplace endpoints (mirror the mini-app upload-url + submit
// pair). Backend: ``app/api/v1/themes_publish`` (Pydantic). The wire
// shapes are intentionally identical to the mini-app ones so the publish
// flow is the same two round-trips — only the path + manifest schema
// differ.
// ---------------------------------------------------------------------------

export interface ThemeUploadUrlRequest {
  /// The theme id (`theme.json` `id`). Backend scopes the presigned key
  /// under `themes/<id>/<version>/`.
  themeId: string;
  contentLength: number;
  sha256: string;
}

export async function requestThemeUploadUrl(
  api: ApiClient,
  req: ThemeUploadUrlRequest,
): Promise<UploadUrlResponse> {
  return api.post('/api/v1/themes/upload-url', req, (body) => UploadUrlResponseSchema.parse(body));
}

export async function submitThemeManifest(
  api: ApiClient,
  manifest: ThemeManifest,
  bundleId: string,
): Promise<SubmitResponse> {
  return api.post(
    '/api/v1/themes/submit',
    { manifest: ThemeManifestSchema.parse(manifest), bundleId },
    (body) => SubmitResponseSchema.parse(body),
  );
}

// ---------------------------------------------------------------------------
// Native-APK app-store endpoints (mirror the mini-app / theme upload-url +
// submit pair, for native Android child apps). Backend:
// ``app/api/v1/app_store`` + ``app/api/v1/admin/app_store``. Responses ride
// the standard {success,data,...} envelope (the ApiClient unwraps it).
// ---------------------------------------------------------------------------

const ApkUploadUrlResponseSchema = z.object({
  uploadUrl: z.string().url(),
  objectKey: z.string().min(1),
  expiresAt: z.string().optional(),
});
export type ApkUploadUrlResponse = z.infer<typeof ApkUploadUrlResponseSchema>;

export async function requestApkUploadUrl(
  api: ApiClient,
  req: { package: string; versionCode: number },
): Promise<ApkUploadUrlResponse> {
  return api.post('/api/v1/apps/upload-url', req, (body) => ApkUploadUrlResponseSchema.parse(body));
}

export interface ApkSubmitManifest {
  packageName: string;
  versionCode: number;
  versionName: string;
  apkSha256: string;
  sizeBytes: number;
  apkSignerSha256: string;
}

const ApkSubmitResponseSchema = z.object({
  packageId: z.string().min(1),
  versionCode: z.number().int(),
  reviewStatus: z.string(),
  releaseId: z.string().min(1),
});
export type ApkSubmitResponse = z.infer<typeof ApkSubmitResponseSchema>;

export async function submitApkManifest(
  api: ApiClient,
  req: {
    manifest: ApkSubmitManifest;
    devSignature: string;
    category?: string;
    requires?: Record<string, unknown>;
    /// Storefront metadata (cosmetic; NOT part of the K1-signed manifest).
    displayName?: Record<string, string>;
    description?: Record<string, string>;
    /// base64 of the launcher icon bytes (PNG/WEBP/JPEG).
    icon?: string;
  },
): Promise<ApkSubmitResponse> {
  return api.post('/api/v1/apps/submit', req, (body) => ApkSubmitResponseSchema.parse(body));
}

const ApkMineSchema = z.object({
  apps: z.array(z.record(z.string(), z.unknown())),
});

/// List the caller's published native apps (raw manifest summaries).
export async function listMyApks(api: ApiClient): Promise<Record<string, unknown>[]> {
  const res = await api.get('/api/v1/apps/mine', (body) => ApkMineSchema.parse(body));
  return res.apps;
}

const ApkPromoteResponseSchema = z.object({
  id: z.string(),
  versionCode: z.number().int(),
  status: z.string(),
  rolloutPercent: z.number().int(),
});

/// Promote the latest approved release: draft→rolling at a rollout %.
export async function promoteApk(
  api: ApiClient,
  packageId: string,
  rolloutPercent: number,
  status?: string,
): Promise<z.infer<typeof ApkPromoteResponseSchema>> {
  return api.post(
    `/api/v1/apps/${encodeURIComponent(packageId)}/promote`,
    { rolloutPercent, ...(status ? { status } : {}) },
    (body) => ApkPromoteResponseSchema.parse(body),
  );
}

const MyAppsSchema = z.object({
  apps: z.array(
    z.object({
      manifest: MiniAppManifestSchema,
      status: z.string(),
      version: z.string(),
      updatedAt: z.string().optional(),
    }),
  ),
});
export type MyApps = z.infer<typeof MyAppsSchema>;

export async function listMyApps(api: ApiClient): Promise<MyApps> {
  return api.get('/api/v1/mini-apps/mine', (body) => MyAppsSchema.parse(body));
}

// ---------------------------------------------------------------------------
// SSH-key management — the CLI login credential. Bootstrap your FIRST key
// in the web console (Account → SSH keys); once logged in you can manage
// the rest here. Backend: ``app/api/v1/ssh_keys/routes.py`` (/account/ssh-keys).
// ---------------------------------------------------------------------------

const SshKeySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  fingerprint: z.string().min(1),
  keyType: z.string(),
  /// "login" (full session) or "attest" (publish-scoped CI key only).
  /// Optional for back-compat with a backend that predates the column.
  purpose: z.string().optional(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable().optional(),
});
export type SshKey = z.infer<typeof SshKeySchema>;

const SshKeyListSchema = z.object({ keys: z.array(SshKeySchema) });

/// List the caller's registered SSH public keys.
export async function listSshKeys(api: ApiClient): Promise<SshKey[]> {
  const res = await api.get('/api/v1/account/ssh-keys', (body) => SshKeyListSchema.parse(body));
  return res.keys;
}

/// Register an OpenSSH public key on the caller's account. ``name`` is a
/// free-text label; ``publicKey`` is the one-line ``ssh-ed25519 AAAA...``
/// string (the contents of a ``.pub`` file). ``purpose`` is "login" (full
/// session, default) or "attest" (a dedicated CI signing key that can only
/// obtain a publish-scoped token — never a full session).
export async function addSshKey(
  api: ApiClient,
  publicKey: string,
  name: string,
  purpose?: string,
): Promise<SshKey> {
  return api.post(
    '/api/v1/account/ssh-keys',
    { public_key: publicKey, name, ...(purpose ? { purpose } : {}) },
    (body) => SshKeySchema.parse(body),
  );
}

/// Revoke one of the caller's SSH keys by id. Login with that key fails
/// on the next request.
export async function removeSshKey(api: ApiClient, keyId: string): Promise<void> {
  await api.delete(`/api/v1/account/ssh-keys/${encodeURIComponent(keyId)}`, () => undefined);
}

// ---------------------------------------------------------------------------
// Beta-track endpoints
// ---------------------------------------------------------------------------

/// Promote a specific version to the beta track for an app.
export async function promoteAppToBeta(
  api: ApiClient,
  appId: string,
  version: string,
  releaseNotes?: string,
): Promise<void> {
  await api.post(
    `/api/v1/dev/apps/${encodeURIComponent(appId)}/beta/promote`,
    { version, ...(releaseNotes !== undefined ? { releaseNotes } : {}) },
    () => undefined,
  );
}

/// Clear the beta track pointer — sets beta_bundle_id back to NULL.
export async function demoteAppBeta(api: ApiClient, appId: string): Promise<void> {
  await api.delete(`/api/v1/dev/apps/${encodeURIComponent(appId)}/beta`, () => undefined);
}

/// Copy the current beta bundle into the production track.
export async function promoteAppToProduction(api: ApiClient, appId: string): Promise<void> {
  await api.post(
    `/api/v1/dev/apps/${encodeURIComponent(appId)}/promote-production`,
    {},
    () => undefined,
  );
}

const TesterSchema = z.object({
  userId: z.string().min(1),
  telegramUsername: z.string(),
  status: z.enum(['invited', 'accepted', 'revoked']),
  invitedAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  revokedAt: z.string().nullable().optional(),
});
export type Tester = z.infer<typeof TesterSchema>;

const TestersResponseSchema = z.object({
  testers: z.array(TesterSchema),
});

/// List the tester roster for an app.
export async function listTesters(api: ApiClient, appId: string): Promise<Tester[]> {
  const res = await api.get(`/api/v1/dev/apps/${encodeURIComponent(appId)}/testers`, (body) =>
    TestersResponseSchema.parse(body),
  );
  return res.testers;
}

/// Invite a single tester by Telegram username.
/// The backend always returns 200 even when the username isn't resolved yet
/// (account-enumeration mitigation). We print a generic "invite recorded"
/// message — only the `beta testers` roster reveals actual status.
export async function inviteTester(
  api: ApiClient,
  appId: string,
  telegramUsername: string,
): Promise<void> {
  await api.post(
    `/api/v1/dev/apps/${encodeURIComponent(appId)}/testers`,
    { telegramUsername },
    () => undefined,
  );
}

/// Invite multiple testers in one request. The backend applies the same
/// account-enumeration mitigation as the single-invite endpoint.
export async function inviteTestersBatch(
  api: ApiClient,
  appId: string,
  telegramUsernames: string[],
): Promise<void> {
  await api.post(
    `/api/v1/dev/apps/${encodeURIComponent(appId)}/testers/batch`,
    { telegramUsernames },
    () => undefined,
  );
}

/// Remove (revoke) a specific tester by their user_id.
export async function revokeTester(api: ApiClient, appId: string, userId: string): Promise<void> {
  await api.delete(
    `/api/v1/dev/apps/${encodeURIComponent(appId)}/testers/${encodeURIComponent(userId)}`,
    () => undefined,
  );
}

const BetaStatusSchema = z.object({
  appId: z.string(),
  betaActive: z.boolean(),
  betaVersion: z.string().nullable(),
  betaBundleSha256: z.string().nullable(),
  betaExpiresAt: z.string().nullable(),
  daysUntilExpiry: z.number().int().nullable(),
  betaReleaseNotes: z.string().nullable(),
  lastPublishedAt: z.string().nullable(),
  testerCount: z.number().int().nonnegative(),
  testerCap: z.number().int().nonnegative(),
});
export type BetaStatus = z.infer<typeof BetaStatusSchema>;

/// Single-call snapshot of an app's beta-track state. Composes
/// manifest pointers + bundle SHA + tester count so `beta status` and
/// the dev-portal Testing tab don't make 3 round trips just to render
/// the status block. Always returns a row when the caller owns the
/// app (with `betaActive: false` when no beta is running).
export async function getBetaStatus(api: ApiClient, appId: string): Promise<BetaStatus> {
  return api.get(`/api/v1/dev/apps/${encodeURIComponent(appId)}/beta/status`, (body) =>
    BetaStatusSchema.parse(body),
  );
}

// ---------------------------------------------------------------------------
// Developer-lifecycle snapshot — `i99dash status` consumes this.
// Backend: ``app/api/v1/dev_status/schemas.py:DevStatusOut`` (Pydantic).
// Drift between the two shapes is caught at integration-test time.
// ---------------------------------------------------------------------------

const DevStatusAppSchema = z.object({
  appId: z.string().min(1),
  latestVersion: z.string(),
  reviewStatus: z.string(),
  rejectionReason: z.string().nullable().optional(),
  lastPublishedAt: z.string().nullable().optional(),
  betaActive: z.boolean(),
  betaVersion: z.string().nullable().optional(),
});
export type DevStatusApp = z.infer<typeof DevStatusAppSchema>;

const DevStatusSchema = z.object({
  isDeveloper: z.boolean(),
  hasPendingRequest: z.boolean(),
  apps: z.array(DevStatusAppSchema),
  appsTotal: z.number(),
  lastNotificationAttempt: z.string().nullable().optional(),
  lastNotificationError: z.string().nullable().optional(),
});
export type DevStatus = z.infer<typeof DevStatusSchema>;

/// One round-trip lifecycle snapshot. ``appId`` filters the apps
/// list server-side so the response stays small for power devs.
export async function getDevStatus(api: ApiClient, appId?: string): Promise<DevStatus> {
  const path = appId
    ? `/api/v1/dev/status?app_id=${encodeURIComponent(appId)}`
    : '/api/v1/dev/status';
  return api.get(path, (body) => DevStatusSchema.parse(body));
}
