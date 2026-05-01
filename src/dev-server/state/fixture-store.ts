import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import fg from 'fast-glob';
import type { FSWatcher } from 'chokidar';
import chokidar from 'chokidar';
import { z } from 'zod';
import type { CallApiRequest } from '../../types/index.js';
import { CallApiResponseSchema } from '../../types/index.js';

/// Output type of the envelope schema. Zod's inferred `data` is
/// optional (it's `z.unknown()`), which matches how fixture authors
/// write their files — the server layer serialises this unchanged and
/// the runtime re-validates on receipt, so the optional-ness is never
/// observable to mini-app code.
type ParsedCallApiResponse = z.infer<typeof CallApiResponseSchema>;

export const FixtureSchema = z.object({
  match: z.object({
    path: z.string().startsWith('/'),
    method: z.enum(['GET']),
    query: z.record(z.string(), z.unknown()).optional(),
  }),
  response: CallApiResponseSchema,
});

export type Fixture = z.infer<typeof FixtureSchema>;

/// Loads every `*.json` under `mocksDir`, validates the shape, and
/// matches incoming requests against them. Hot-reload via chokidar —
/// editing a fixture file updates the in-memory table immediately.
///
/// Matching rules (first file wins by alphabetical filename):
///   1. `method` exact match.
///   2. `path` exact match.
///   3. If fixture declares `query`, every key/value must be present
///      in the incoming request's query. Missing keys or value
///      mismatches skip the fixture.
///
/// Missing fixture → `{success:false, error:{code:'NO_FIXTURE', ...}}`
/// so devs see the gap loudly during test rather than silently
/// getting stale data.
export class FixtureStore {
  private readonly mocksDir: string;
  private readonly fixtures = new Map<string, Fixture>();
  private readonly orderedFiles: string[] = [];
  private watcher: FSWatcher | undefined;

  constructor(mocksDir: string) {
    this.mocksDir = resolve(mocksDir);
  }

  async load(): Promise<void> {
    const files = (await fg('**/*.json', { cwd: this.mocksDir, absolute: true })).sort();
    this.fixtures.clear();
    this.orderedFiles.length = 0;
    for (const file of files) {
      try {
        const raw = JSON.parse(await readFile(file, 'utf8'));
        const parsed = FixtureSchema.parse(raw);
        this.fixtures.set(file, parsed);
        this.orderedFiles.push(file);
      } catch (err) {
        // Don't crash the dev-server on one bad fixture — surface it.
        // A dev iterating on a JSON file expects hot-reload semantics.
        console.warn(`[dev-server] skipping malformed fixture ${file}: ${String(err)}`);
      }
    }
  }

  async watch(): Promise<void> {
    this.watcher = chokidar.watch(this.mocksDir, { ignoreInitial: true });
    const reload = () => {
      this.load().catch((e) => console.error('[dev-server] fixture reload failed', e));
    };
    this.watcher.on('add', reload);
    this.watcher.on('change', reload);
    this.watcher.on('unlink', reload);
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = undefined;
  }

  match(req: CallApiRequest): ParsedCallApiResponse | null {
    return this.matchWithSource(req)?.response ?? null;
  }

  /// Like [match], but also returns the source filename when a match
  /// is found. Used by the dev-server inspector to label decisions.
  matchWithSource(req: CallApiRequest): { response: ParsedCallApiResponse; file: string } | null {
    for (const file of this.orderedFiles) {
      const fx = this.fixtures.get(file);
      if (!fx) continue;
      if (fx.match.method !== req.method) continue;
      if (fx.match.path !== req.path) continue;
      if (fx.match.query) {
        const q = req.query ?? {};
        let ok = true;
        for (const [k, v] of Object.entries(fx.match.query)) {
          if (q[k] !== v) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      return { response: fx.response, file };
    }
    return null;
  }
}
