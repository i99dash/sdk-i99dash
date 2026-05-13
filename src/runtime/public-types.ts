/// Type-only entry point for `i99dash`.
///
/// Importing from `i99dash/types` instead of `i99dash` is a pure-type
/// affordance for consumers that only need to reference shapes (e.g.
/// `MiniAppContext` in a server-rendered page) and want it obvious at
/// the import site that no runtime is being pulled in.
///
/// All re-exports here are `type` re-exports; the emitted JS bundle
/// is empty.
export type {
  CallApiRequest,
  CallApiResponse,
  ApiMethod,
  MiniAppContext,
  CarAssetResponse,
  CarCatalogEntry,
  CarCatalogList,
  CarCommandResponse,
  CarConnectionState,
  CarIdentity,
  CarReadResponse,
  CarSignalEvent,
  CarSubscribeResponse,
} from '../types/index.js';

export type { CallOptions } from './client.js';
export type { SDKErrorCode } from './errors.js';
export type { Bridge, CarBridge, HostBridgeApi, WindowWithHost } from './bridge.js';
export type { CarAssetBytes, CarConnectionListener, CarSignalListener } from './car.js';
