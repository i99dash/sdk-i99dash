import { z } from 'zod';
import { MiniAppManifestSchema, type MiniAppManifest } from '../../types/index.js';

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

/// Revoke the API key that authenticated this request. Powers
/// `i99dash logout --revoke` — the CLI doesn't know its own
/// key_id locally, so the backend resolves it from the Bearer
/// header and revokes that specific row. Returns void (204 on
/// success); the caller swallows non-2xx so logout never errors.
export async function revokeCurrentKey(api: ApiClient): Promise<void> {
  await api.post('/api/v1/dev/keys/me/revoke', {}, () => undefined);
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

const DevStatusKeySchema = z.object({
  label: z.string(),
  lastUsedAt: z.string().nullable().optional(),
});
export type DevStatusKey = z.infer<typeof DevStatusKeySchema>;

const DevStatusSchema = z.object({
  isDeveloper: z.boolean(),
  hasPendingRequest: z.boolean(),
  apps: z.array(DevStatusAppSchema),
  appsTotal: z.number(),
  keys: z.array(DevStatusKeySchema),
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

