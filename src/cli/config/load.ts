import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { MiniAppManifestSchema, MiniAppContextSchema } from '../../types/index.js';
import type { MiniAppManifest } from '../../types/index.js';

import { ManifestInvalidError, LocalIOError } from '../util/errors.js';
import { projectPaths } from './paths.js';

/// Config-file schema for `sdk.config.ts` / `sdk.config.json`.
///
/// We accept JSON first in v1 (zero-parse, no transpilation). Adding
/// `.ts` support is a future iteration via esbuild — deferred because
/// every field we need here is JSON-representable.
export const SdkConfigSchema = z.object({
  /// Glob (relative to project root) whose contents the dev-server
  /// will static-serve. Default: `./src`.
  appRoot: z.string().default('./src'),

  /// Build output directory. Default: `./dist`.
  distDir: z.string().default('./dist'),

  /// Initial dev-server state — the UI can override these at runtime;
  /// this block is just the starting point after `sdk dev`.
  dev: z
    .object({
      port: z.number().int().positive().default(5173),
      host: z.string().default('127.0.0.1'),
      context: MiniAppContextSchema.partial().optional(),
    })
    .default({}),

  /// Build command to run before bundling. Default: no-op (vanilla HTML).
  buildCommand: z.string().optional(),
});

export type SdkConfig = z.infer<typeof SdkConfigSchema>;

export async function loadManifest(projectRoot: string): Promise<MiniAppManifest> {
  const paths = projectPaths(projectRoot);
  let raw: string;
  try {
    raw = await readFile(paths.manifestJson, 'utf8');
  } catch (cause) {
    throw new LocalIOError(`could not read ${paths.manifestJson}`, cause);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ManifestInvalidError('manifest.json is not valid JSON', cause);
  }
  const result = MiniAppManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ManifestInvalidError(
      `manifest.json failed schema validation:\n${formatZodIssues(result.error.issues)}`,
      result.error,
    );
  }
  return result.data;
}

export async function loadSdkConfig(projectRoot: string): Promise<SdkConfig> {
  const paths = projectPaths(projectRoot);
  // v1: read `sdk.config.json` alongside. `.ts` support lands when we
  // wire esbuild in (not in v1).
  const jsonPath = paths.sdkConfigTs.replace(/\.ts$/, '.json');
  try {
    const raw = await readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    return SdkConfigSchema.parse(parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return SdkConfigSchema.parse({});
    }
    throw err;
  }
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues.map((i) => `  · ${i.path.join('.') || '<root>'}: ${i.message}`).join('\n');
}
