import Fastify, { type FastifyInstance } from 'fastify';
import { MiniAppContextSchema } from '../types/index.js';
import { z } from 'zod';

import { BRIDGE_SHIM_JS } from './inject/bridge-shim.js';
import { UI_HTML } from './ui/ui.js';
import type { NativeCapStore } from './state/native-cap-store.js';
import type { StateStore } from './state/state-store.js';

const StatePatchSchema = z.object({
  context: MiniAppContextSchema.partial().optional(),
  speedKmh: z.number().nonnegative().optional(),
});

const NativeCapRequestSchema = z.object({
  op: z.string().min(1).max(64),
  params: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().nullable().optional(),
});

interface BuildOptions {
  state: StateStore;
  nativeCap: NativeCapStore;
  /// Directory whose contents are served as the mini-app. Default
  /// behaviour: static-serve. For framework integrations (Vite / Next
  /// dev-server), pass an alternate request-handler via `proxy`.
  appRoot?: string;
}

/// Builds the Fastify app. Kept as a pure function so tests can call
/// `buildServer({...})` without listening on a port.
export async function buildServer(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, disableRequestLogging: true });

  app.get('/_sdk/bridge.js', async (_req, reply) => {
    reply.header('content-type', 'application/javascript; charset=utf-8');
    reply.header('cache-control', 'no-store');
    return BRIDGE_SHIM_JS;
  });

  app.get('/_sdk/context', async () => opts.state.get().context);

  app.get('/_sdk/state', async () => opts.state.get());

  app.post('/_sdk/state', async (req, reply) => {
    const parsed = StatePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.message };
    }
    return { ok: true, state: opts.state.patch(parsed.data) };
  });

  // Native-capability families (Phase A/B/C). One catch-all POST
  // routes every `<family>.<verb>` op into the in-memory simulation
  // ([NativeCapStore]). Returns the same `{success, data?, error?}`
  // envelope the host's family executor returns, so the SDK's typed
  // controllers branch on the same `code` strings in dev that they
  // do in production.
  app.post('/_sdk/native-cap', async (req, reply) => {
    const parsed = NativeCapRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        success: false as const,
        error: { code: 'bad_request', message: parsed.error.message },
      };
    }
    return opts.nativeCap.dispatch(parsed.data.op, parsed.data.params);
  });

  app.get('/_sdk/native-cap/snapshot', async () => opts.nativeCap.snapshot());

  app.post('/_sdk/native-cap/reset', async () => {
    opts.nativeCap.reset();
    return { ok: true };
  });

  app.get('/_sdk/ui', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('cache-control', 'no-store');
    return UI_HTML;
  });

  // Root catches — serve the user's app with the bridge shim injected.
  // Default static behaviour (no framework proxy): we rewrite the
  // `.html` responses to include a <script src="/_sdk/bridge.js"> tag
  // at the top of <head>. Non-HTML files pass through unchanged.
  if (opts.appRoot) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: opts.appRoot, prefix: '/' });
    app.addHook('onSend', async (req, reply, payload) => {
      const ct = reply.getHeader('content-type');
      const isHtml = typeof ct === 'string' && ct.includes('text/html');
      if (!isHtml) return payload;
      const html = await streamToString(payload);
      return html.replace(
        /<head(\s[^>]*)?>/i,
        (match) => `${match}\n<script src="/_sdk/bridge.js"></script>`,
      );
    });
  }

  return app;
}

async function streamToString(payload: unknown): Promise<string> {
  if (typeof payload === 'string') return payload;
  if (Buffer.isBuffer(payload)) return payload.toString('utf8');
  // Readable stream path (fastify-static returns a stream for files).
  if (payload && typeof (payload as { on?: unknown }).on === 'function') {
    const chunks: Buffer[] = [];
    const stream = payload as NodeJS.ReadableStream;
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  return '';
}
