export { MiniAppClient, type CallOptions } from './client.js';
export {
  HostBridge,
  HOST_EVENTS_GLOBAL,
  HOST_GLOBAL,
  LEGACY_HOST_GLOBAL,
  ensureHostEvents,
  isCapabilitiesBridge,
  isCarBridge,
  isFamilyBridge,
  resolveHostApi,
  type Bridge,
  type CapabilitiesBridge,
  type CarBridge,
  type FamilyBridge,
  type HostBridgeApi,
  type HostEventsApi,
  type WindowWithHost,
} from './bridge.js';
export { BootController, type BootEntry, type SetOptions as BootSetOptions } from './boot.js';
export {
  CAR_MAX_NAMES,
  CarController,
  type CarAssetBytes,
  type CarAssetResponse,
  type CarCatalogEntry,
  type CarCatalogList,
  type CarCommandResponse,
  type CarConnectionListener,
  type CarConnectionState,
  type CarIdentity,
  type CarReadResponse,
  type CarSignalEvent,
  type CarSignalListener,
  type CarSubscribeResponse,
} from './car.js';
export {
  CursorController,
  type CursorAttachOptions,
  type CursorHandle,
  type CursorStyle,
} from './cursor.js';
export {
  DisplayController,
  type DisplaySnapshot,
  type DisplayEvent,
  type DisplayListResult,
  type VehicleContext,
  type ReservedOverrideLabel,
  RESERVED_OVERRIDE_LABELS,
} from './display.js';
export {
  GestureController,
  type GestureLongPressOptions,
  type GestureResult,
  type GestureSwipeOptions,
  type GestureTapOptions,
} from './gesture.js';
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
export {
  SurfaceController,
  SurfaceRouteError,
  SURFACE_ROUTE_REGEX,
  type SurfaceCreateRequest,
  type SurfaceCreateResult,
  type SurfaceSnapshot,
} from './surface.js';
export {
  FamilyOpError,
  FamilyUnavailableError,
  decodeFamilyEnvelope,
  invokeFamily,
  newIdempotencyKey,
  type FamilyResponse,
  type InvokeFamilyOptions,
  type UnsubscribeFn,
} from './family-controller.js';
export {
  BridgeTimeoutError,
  BridgeTransportError,
  InvalidResponseError,
  NotInsideHostError,
  SDKError,
  type SDKErrorCode,
} from './errors.js';
export { PermissionDeniedAggregator, type PermissionDeniedListener } from './permission-denied.js';
export { createClientOrSSR } from './ssr.js';
// Centralised: any package in the monorepo that needs timeout-with-
// abort lives behind this one helper. Admin-sdk in particular MUST
// import this rather than ship its own (fixes a real "no timeouts on
// privileged calls" gap discovered during the SDK audit).
export { withTimeout } from './util/timeout.js';

// Re-export the wire types so a consumer only needs `i99dash`.
export type { MiniAppContext, HostCapabilities } from '../types/index.js';
