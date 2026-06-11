import { resolve } from 'node:path';

/// Every path the CLI reads / writes is derived from a single `root`
/// so the entire surface can be pointed at a tmp dir in tests.
export interface ProjectPaths {
  root: string;
  manifestJson: string;
  sdkConfigTs: string;
  distDir: string;
  sourceDir: string;
}

export function projectPaths(root = process.cwd()): ProjectPaths {
  const abs = resolve(root);
  return {
    root: abs,
    manifestJson: resolve(abs, 'manifest.json'),
    sdkConfigTs: resolve(abs, 'sdk.config.ts'),
    distDir: resolve(abs, 'dist'),
    sourceDir: resolve(abs, 'src'),
  };
}

/// Environment overrides — documented in `docs/onboard/auth.md`.
export function resolvedBackendUrl(): string {
  return process.env['I99DASH_BACKEND_URL'] ?? 'https://api.i99dash.app';
}
