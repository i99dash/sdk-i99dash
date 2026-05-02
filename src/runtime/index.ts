export { MiniAppClient, type CallOptions } from './client.js';
export {
  HostBridge,
  HOST_EVENTS_GLOBAL,
  HOST_GLOBAL,
  LEGACY_HOST_GLOBAL,
  isCapabilitiesBridge,
  isCarStatusBridge,
  isClimateBridge,
  isConnectivityBridge,
  isLocationBridge,
  isMediaBridge,
  isNavigationBridge,
  isSystemBridge,
  isVehicleDiagnosticsBridge,
  isVehicleEnvironmentBridge,
  resolveHostApi,
  type Bridge,
  type CapabilitiesBridge,
  type CarStatusBridge,
  type ClimateBridge,
  type ConnectivityBridge,
  type HostBridgeApi,
  type LocationBridge,
  type MediaBridge,
  type NavigationBridge,
  type SystemBridge,
  type VehicleDiagnosticsBridge,
  type VehicleEnvironmentBridge,
  type WindowWithHost,
} from './bridge.js';
export { BootController, type BootEntry, type SetOptions as BootSetOptions } from './boot.js';
export { CarStatusController, type CarConnectionListener, type CarStatusListener } from './car.js';
export { ClimateController, type ClimateListener } from './climate.js';
export { ConnectivityController, type ConnectivityListener } from './connectivity.js';
export {
  CursorController,
  type CursorAttachOptions,
  type CursorHandle,
  type CursorStyle,
} from './cursor.js';
export { DisplayController, type DisplaySnapshot, type DisplayEvent } from './display.js';
export {
  GestureController,
  type GestureLongPressOptions,
  type GestureResult,
  type GestureSwipeOptions,
  type GestureTapOptions,
} from './gesture.js';
export { LocationController, type LocationListener } from './location.js';
export { MediaController, type MediaListener } from './media.js';
export { NavigationController, type NavigationListener } from './navigation.js';
export {
  PkgController,
  type ForegroundInfo,
  type LaunchOptions,
  type LaunchResult,
  type ListOptions as PkgListOptions,
  type PackageInfo,
  type UsageResult,
  type UsageRow,
} from './pkg.js';
export { SystemController, type SystemListener } from './system.js';
export {
  VehicleDiagnosticsController,
  type VehicleDiagnosticsListener,
} from './vehicle-diagnostics.js';
export {
  VehicleEnvironmentController,
  type VehicleEnvironmentListener,
} from './vehicle-environment.js';
export {
  BridgeTimeoutError,
  BridgeTransportError,
  CallApiFailedError,
  CarStatusQuotaExceededError,
  CarStatusUnavailableError,
  ClimateUnavailableError,
  ConnectivityUnavailableError,
  InvalidResponseError,
  LocationUnavailableError,
  MediaUnavailableError,
  NavigationUnavailableError,
  NotInsideHostError,
  SDKError,
  SystemUnavailableError,
  VehicleDiagnosticsUnavailableError,
  VehicleEnvironmentUnavailableError,
  type SDKErrorCode,
} from './errors.js';
export { PermissionDeniedAggregator, type PermissionDeniedListener } from './permission-denied.js';
export { createClientOrSSR } from './ssr.js';
// Centralised: any package in the monorepo that needs timeout-with-
// abort lives behind this one helper. Admin-sdk in particular MUST
// import this rather than ship its own (fixes a real "no timeouts on
// privileged calls" gap discovered during the SDK audit).
export { withTimeout } from './util/timeout.js';

// Re-export the wire types so a consumer only needs `@i99dash/sdk`.
export type {
  MiniAppContext,
  CallApiRequest,
  CallApiResponse,
  ApiMethod,
  CarStatus,
  CarStatusStaleness,
  CarConnectionState,
  CarDoors,
  CarDoorState,
  HostCapabilities,
  MediaSnapshot,
  MediaSource,
  MediaPlayState,
  ClimateSnapshot,
  ClimateMode,
  VehicleDiagnosticsSnapshot,
  GearPosition,
  TirePressure,
  VehicleEnvironmentSnapshot,
  SystemSnapshot,
  DistanceUnit,
  TemperatureUnit,
  OtaStatus,
  ConnectivitySnapshot,
  NetworkType,
  LocationSnapshot,
  NavigationSnapshot,
  NavManeuver,
} from '../types/index.js';
