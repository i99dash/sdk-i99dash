import type { MiniAppContext } from '../types/index.js';

import { buildServer } from './server.js';
import { NativeCapStore } from './state/native-cap-store.js';
import { StateStore, type DevServerState } from './state/state-store.js';

export { StateStore, type DevServerState, type DevServerStatePatch } from './state/state-store.js';
export {
  NativeCapStore,
  type NativeCapSnapshot,
  type FakeDisplay,
  type FakeSurface,
  type FakePackage,
  type FakeBootEntry,
} from './state/native-cap-store.js';
export { buildServer } from './server.js';

export interface StartDevServerOptions {
  port?: number;
  host?: string;
  appRoot?: string;
  initialState: DevServerState;
}

export interface DevServerHandle {
  url: string;
  stop(): Promise<void>;
  state: StateStore;
  nativeCap: NativeCapStore;
}

/// Convenience entry point — spins up the Fastify server. For
/// programmatic use (tests, framework integrations) import
/// `buildServer`/`StateStore` directly.
export async function startDevServer(opts: StartDevServerOptions): Promise<DevServerHandle> {
  const port = opts.port ?? 5173;
  // Bind to 127.0.0.1 by default so a laptop on a public Wi-Fi
  // doesn't expose the dev session. `host: '0.0.0.0'` is an opt-in.
  const host = opts.host ?? '127.0.0.1';

  const state = new StateStore(opts.initialState);
  const nativeCap = new NativeCapStore(opts.initialState.context.appId);

  const app = await buildServer({
    state,
    nativeCap,
    appRoot: opts.appRoot,
  });
  await app.listen({ port, host });

  const url = `http://${host}:${port}`;
  return {
    url,
    stop: async () => {
      await app.close();
    },
    state,
    nativeCap,
  };
}

/// Builds a sensible default state — used by the CLI so a dev who
/// ran `init` gets a working context out of the box. Still override-
/// able via `sdk.config.ts`.
export function defaultDevServerState(overrides?: {
  context?: Partial<MiniAppContext>;
}): DevServerState {
  return {
    context: {
      userId: 'dev-user',
      activeCarId: 'BYD-DEV-DEVICE-0001',
      locale: 'en',
      isDark: false,
      appVersion: '0.0.0-dev',
      appId: 'dev-app',
      ...overrides?.context,
    },
    speedKmh: 0,
  };
}
