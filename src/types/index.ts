export { MiniAppContextSchema, type MiniAppContext } from './context.js';

export {
  ApiMethodSchema,
  type ApiMethod,
  CallApiRequestSchema,
  type CallApiRequest,
  CallApiResponseSchema,
  type CallApiResponse,
} from './call-api.js';

export {
  LocaleMapSchema,
  type LocaleMap,
  MiniAppManifestSchema,
  type MiniAppManifest,
  CATEGORY_SLUGS,
} from './manifest.js';

export {
  CarStatusSchema,
  type CarStatus,
  CarStatusStalenessSchema,
  type CarStatusStaleness,
  CarDoorsSchema,
  type CarDoors,
  CarDoorStateSchema,
  type CarDoorState,
  CarConnectionStateSchema,
  type CarConnectionState,
} from './car-status.js';

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

export {
  MediaSnapshotSchema,
  type MediaSnapshot,
  MediaSourceSchema,
  type MediaSource,
  MediaPlayStateSchema,
  type MediaPlayState,
} from './media.js';

export {
  ClimateSnapshotSchema,
  type ClimateSnapshot,
  ClimateModeSchema,
  type ClimateMode,
} from './climate.js';

export {
  VehicleDiagnosticsSnapshotSchema,
  type VehicleDiagnosticsSnapshot,
  GearPositionSchema,
  type GearPosition,
  TirePressureSchema,
  type TirePressure,
} from './vehicle-diagnostics.js';

export {
  VehicleEnvironmentSnapshotSchema,
  type VehicleEnvironmentSnapshot,
} from './vehicle-environment.js';

export {
  SystemSnapshotSchema,
  type SystemSnapshot,
  DistanceUnitSchema,
  type DistanceUnit,
  TemperatureUnitSchema,
  type TemperatureUnit,
  OtaStatusSchema,
  type OtaStatus,
} from './system.js';

export {
  ConnectivitySnapshotSchema,
  type ConnectivitySnapshot,
  NetworkTypeSchema,
  type NetworkType,
} from './connectivity.js';

export { LocationSnapshotSchema, type LocationSnapshot } from './location.js';

export {
  NavigationSnapshotSchema,
  type NavigationSnapshot,
  NavManeuverSchema,
  type NavManeuver,
} from './navigation.js';
