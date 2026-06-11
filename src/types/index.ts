export { MiniAppContextSchema, type MiniAppContext } from './context.js';

export {
  LocaleMapSchema,
  type LocaleMap,
  MiniAppManifestSchema,
  type MiniAppManifest,
  MiniAppRequiresSchema,
  type MiniAppRequires,
  REQUIRES_SCHEMA,
  CATEGORY_SLUGS,
} from './manifest.js';

export { canonicalizeMiniAppOrigin, ORIGIN_FIXTURES } from './origin.js';

export {
  THEME_SCHEMA,
  THEME_CATEGORY_SLUGS,
  ThemeColorsSchema,
  type ThemeColors,
  ThemeWallpaperSchema,
  type ThemeWallpaper,
  ThemeTypographySchema,
  type ThemeTypography,
  ThemeShapeSchema,
  type ThemeShape,
  ThemeGaugeSchema,
  type ThemeGauge,
  ThemeSpecSchema,
  type ThemeSpec,
  ThemeManifestSchema,
  type ThemeManifest,
} from './theme-manifest.js';

export {
  CompatTargetSchema,
  type CompatTarget,
  COMPAT_REASON_CODES,
  type CompatReasonCode,
  type CompatReason,
  type CompatResult,
  evaluateCompatibility,
  isCompatible,
} from './compat.js';

export {
  WEBVIEW_BASELINE,
  type WebviewBaselineViolationKind,
  type WebviewBaselineViolation,
  type WebviewBaselineResult,
  checkWebviewBaseline,
} from './webview-baseline.js';

export {
  CarAssetResponseSchema,
  type CarAssetResponse,
  CarCatalogEntrySchema,
  type CarCatalogEntry,
  CarCatalogListSchema,
  type CarCatalogList,
  CarCommandResponseSchema,
  type CarCommandResponse,
  CarConnectionPushEnvelopeSchema,
  type CarConnectionPushEnvelope,
  CarConnectionStateSchema,
  type CarConnectionState,
  CarIdentitySchema,
  type CarIdentity,
  CarReadResponseSchema,
  type CarReadResponse,
  CarSignalEventSchema,
  type CarSignalEvent,
  CarSignalPushEnvelopeSchema,
  type CarSignalPushEnvelope,
  CarSubscribeResponseSchema,
  type CarSubscribeResponse,
} from './car.js';

export { HostCapabilitiesSchema, type HostCapabilities } from './capabilities.js';

export {
  VEHICLE_CAPABILITIES,
  type VehicleCapability,
  CAPABILITY_BITS,
  bitsFromCapabilities,
  capabilitiesFromBits,
  hasAllCapabilities,
  DILINK_FAMILIES,
  type DilinkFamily,
  SUB_TRIMS,
  type SubTrim,
  ProfileKeySchema,
  type ProfileKey,
  VehicleCapabilitiesSnapshotSchema,
  type VehicleCapabilitiesSnapshot,
  VehicleCapabilityProbeReportSchema,
  type VehicleCapabilityProbeReport,
} from './vehicle-capabilities.js';
