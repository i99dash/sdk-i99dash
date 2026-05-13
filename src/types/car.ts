/// v2 bridge wire types for the unified `client.car` controller.
///
/// Mirrors the host-side `CarBridgeService` (see
/// `car-i99dash/lib/features/mini_apps/bridge/car_bridge_service.dart`) —
/// every shape here is the literal JSON the host emits over the
/// `car.*` handlers, validated by Zod on receipt. Brand-keyed catalog
/// names ("ac_power", "speed_kmh", etc.) live in the per-brand public
/// catalog (see `byd_public_catalog.dart`); this module is shape-only,
/// not name-typed.

import { z } from 'zod';

/// Single catalog entry returned by `car.list`. Mirrors
/// `PublicCatalogEntry.toJson()` on the host. The `range`/`units`
/// fields are present per-entry when the host knows them; absent
/// otherwise. `threeD: true` marks entries that drive 3D model
/// animations (door open, headlight on, wheel spin).
export const CarCatalogEntrySchema = z
  .object({
    name: z.string(),
    category: z.string(),
    description: z.string().optional(),
    units: z.string().optional().nullable(),
    range: z.object({ min: z.number(), max: z.number() }).optional().nullable(),
    writeable: z.boolean(),
    writeActionId: z.string().optional().nullable(),
    threeD: z.boolean(),
  })
  .passthrough();
export type CarCatalogEntry = z.infer<typeof CarCatalogEntrySchema>;

/// Full response of `car.list`. The host echoes its bridge version
/// (`'2.0.0'`) + the active brand + every catalog category, then the
/// filtered entry array.
export const CarCatalogListSchema = z.object({
  bridgeVersion: z.string(),
  brand: z.string(),
  categories: z.array(z.string()),
  names: z.array(CarCatalogEntrySchema),
});
export type CarCatalogList = z.infer<typeof CarCatalogListSchema>;

/// `car.read` happy-path response. Names that aren't in the catalog
/// come back with `null` value; the SDK passes them through unchanged.
export const CarReadResponseSchema = z.object({
  values: z.record(z.string(), z.number().nullable()),
  at: z.string(),
});
export type CarReadResponse = z.infer<typeof CarReadResponseSchema>;

/// `car.subscribe` happy-path response. `rejected` is omitted when
/// every name was accepted.
export const CarSubscribeResponseSchema = z.object({
  subscriptionId: z.string(),
  rejected: z.array(z.string()).optional(),
});
export type CarSubscribeResponse = z.infer<typeof CarSubscribeResponseSchema>;

/// Push payload for the `car.signal` channel. The service emits one
/// of these per (subscriptionId, changed name) tuple. `value` is `null`
/// when the host hasn't observed the name yet.
export const CarSignalEventSchema = z.object({
  name: z.string(),
  value: z.number().nullable(),
  at: z.string(),
});
export type CarSignalEvent = z.infer<typeof CarSignalEventSchema>;

/// `car.identity` response. Used by 3D mini-apps to load the GLB +
/// know which clips / variants the artist authored. `clips` is the
/// canonical animation-clip name set; `variants` is a per-channel
/// list of asset variants the model exposes.
export const CarIdentitySchema = z.object({
  brand: z.string(),
  modelCode: z.string().nullable(),
  modelDisplay: z.string().nullable(),
  modelAssetPath: z.string().nullable(),
  clips: z.array(z.string()),
  variants: z.object({
    paint: z.array(z.string()),
    wheels: z.array(z.string()),
    glass: z.array(z.string()),
  }),
});
export type CarIdentity = z.infer<typeof CarIdentitySchema>;

/// `car.asset` happy-path response. `bytesBase64` is decoded to
/// `Uint8Array` before reaching consumer code; the wire schema is
/// kept here only for runtime validation of the raw envelope.
export const CarAssetResponseSchema = z.object({
  path: z.string(),
  contentType: z.string(),
  size: z.number(),
  bytesBase64: z.string(),
});
export type CarAssetResponse = z.infer<typeof CarAssetResponseSchema>;

/// Connection-state classification emitted on `car.connection`.
/// `unknown` is the bootstrap state (no SDK push frame seen yet).
export const CarConnectionStateSchema = z.enum([
  'connected',
  'degraded',
  'disconnected',
  'unknown',
]);
export type CarConnectionState = z.infer<typeof CarConnectionStateSchema>;

/// Push envelope shape the host wraps every `car.signal` event in
/// (see `mini_app_viewer.dart`'s `_pushSignal`). Demuxed on
/// `subscriptionId` so a single mini-app holding multiple
/// subscriptions can route correctly.
export const CarSignalPushEnvelopeSchema = z.object({
  subscriptionId: z.string(),
  data: CarSignalEventSchema,
});
export type CarSignalPushEnvelope = z.infer<typeof CarSignalPushEnvelopeSchema>;

/// Push envelope shape for the `car.connection` channel
/// (see `mini_app_viewer.dart`'s `_pushConnection`).
export const CarConnectionPushEnvelopeSchema = z.object({
  subscriptionId: z.string(),
  state: CarConnectionStateSchema,
});
export type CarConnectionPushEnvelope = z.infer<typeof CarConnectionPushEnvelopeSchema>;

/// `car.command` envelope returned by the host's `CarCommandRouter`.
/// `code`/`data` are optional — the router includes them when the
/// underlying action emitted them. `ok: false` is a legitimate value
/// (e.g. precondition failed); the SDK surfaces it as-is.
export const CarCommandResponseSchema = z
  .object({
    ok: z.boolean(),
    code: z.number().optional(),
    data: z.unknown().optional(),
  })
  .passthrough();
export type CarCommandResponse = z.infer<typeof CarCommandResponseSchema>;
