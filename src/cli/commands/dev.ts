import { resolve } from 'node:path';
import open from 'open';
import { startDevServer, defaultDevServerState } from '../../dev-server/index.js';

import { loadSdkConfig } from '../config/load.js';
import { logger } from '../util/logger.js';

export interface DevOptions {
  cwd: string;
  port?: number;
  host?: string;
  /// Skip auto-opening the browser. On by default so `sdk dev` in a
  /// remote SSH session doesn't try (and fail) to spawn xdg-open.
  noOpen: boolean;
}

export async function runDev(opts: DevOptions): Promise<void> {
  const cfg = await loadSdkConfig(opts.cwd);
  const port = opts.port ?? cfg.dev.port;
  const host = opts.host ?? cfg.dev.host;

  const initial = defaultDevServerState({ context: cfg.dev.context ?? {} });
  const handle = await startDevServer({
    port,
    host,
    appRoot: resolve(opts.cwd, cfg.appRoot),
    initialState: initial,
  });

  logger.success(`dev-server ready`);
  logger.info(`app:      ${handle.url}`);
  logger.info(`controls: ${handle.url}/_sdk/ui`);
  if (host === '0.0.0.0') {
    logger.warn('bound to 0.0.0.0 — other devices on your network can reach this dev-server.');
  }

  if (!opts.noOpen) {
    await open(handle.url).catch(() => {
      // Browser-open is a convenience; never fail the command if it can't spawn.
    });
  }

  // Keep the process alive until SIGINT.
  await new Promise<void>((resolvePromise) => {
    const stop = async () => {
      logger.info('shutting down…');
      await handle.stop();
      resolvePromise();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}
