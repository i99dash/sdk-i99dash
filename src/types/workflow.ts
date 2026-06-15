import { z } from 'zod';

/// Canonical wire-shape for a user-authored car automation — the single
/// document that the visual canvas EMITS and the on-car native engine
/// CONSUMES. See `car-i99dash/docs/plans/WORKFLOW_CANVAS_PLAN.md`.
///
/// Two planes meet here: the authoring canvas (a WebView mini-app using
/// Drawflow) serializes its node graph into a `WorkflowDocument`; the
/// native Dart `WorkflowEngine` compiles the same document into reactive
/// watchers. The backend stores it verbatim as a JSONB row and
/// re-validates with the Pydantic mirror. Like `manifest.ts`, this is
/// the one shared grammar across SDK + backend + host — keep the three
/// in lockstep.
///
/// Design rules (from the plan):
///   • DECLARATIVE, non-Turing-complete, statically analyzable — so
///     every safety gate (stationary, rate-class, security-class, loop
///     detection, trust review) can reason about it without executing it.
///   • FAIL-CLOSED forward-compat — an engine reading a document whose
///     `schema` exceeds its own `WORKFLOW_SCHEMA`, or a node `type` it
///     does not implement, REFUSES TO ARM rather than mis-running.

// ─── Schema versioning ──────────────────────────────────────────────

/// Bump `WORKFLOW_SCHEMA` whenever a NEW node `kind`, a new universal
/// field, or any structural change an older engine cannot reason about
/// lands. Contract (mirrors `manifest.ts` `REQUIRES_SCHEMA`): a document
/// declaring `schema` higher than an engine's `WORKFLOW_SCHEMA` carries
/// structure that engine can't reason about, so it FAILS CLOSED. New
/// `type` values within an EXISTING kind are added to the const arrays
/// below in lockstep (SDK + backend + Dart) and gated by the engine's
/// SUPPORTED sets at arm time, NOT by a schema bump.
export const WORKFLOW_SCHEMA = 1;

/// The four structural node kinds. STABLE — a fifth kind is a structural
/// change that bumps `WORKFLOW_SCHEMA`.
export const NODE_KINDS = ['trigger', 'condition', 'action', 'cluster_output'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/// Trigger types — the "WHEN" layer (plan §4). Most reuse existing
/// infra (`client.changes()`, `currentLocationProvider`,
/// `connectionState()`, `voiceToolRouter`); `time.*`, `geo.*`, and
/// `app.event` need new on-car infra.
export const TRIGGER_TYPES = [
  'signal.changed',
  'signal.threshold',
  'signal.transition',
  'derived.signal',
  'time.at',
  'time.interval',
  'time.cron',
  'geo.enter',
  'geo.exit',
  'geo.dwell',
  'conn.daemon_ready',
  'conn.state',
  'manual.tap',
  'app.event',
  'voice.phrase',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/// Condition types — the "IF" layer. `signal_compare` is the v1
/// primitive; `logic_group` (grouped AND/OR/NOT) is Phase B.
export const CONDITION_TYPES = ['signal_compare', 'logic_group'] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

/// Action node types — the "DO" layer. `car_command`/`radio`/`app`
/// dispatch through the existing chokepoints; `ai` is metered (Phase C);
/// `notify`/`delay`/`set_var` are engine-local.
export const ACTION_TYPES = [
  'car_command',
  'radio',
  'app',
  'ai',
  'notify',
  'delay',
  'set_var',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/// Comparison operators for `signal_compare` conditions. `changed` needs
/// no value; `between` uses `value` + `value2`.
export const COMPARE_OPS = ['<', '<=', '==', '!=', '>=', '>', 'changed', 'between'] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

/// Edge-detection mode for transition / threshold / connection triggers.
/// `rising` is the SAFE default — fire only on a false→true transition,
/// never re-fire while the predicate stays true (anti-storm, plan §6.6).
export const EDGE_MODES = ['rising', 'falling', 'both', 'level'] as const;
export type EdgeMode = (typeof EDGE_MODES)[number];

/// Where a trigger is evaluated. `server`/`both` are only meaningful for
/// `time.*`/`geo.*` wake-on-asleep, which stays gated on a PROVEN remote
/// wake path (plan §10 Phase 0); default `car`.
export const EVAL_SITES = ['car', 'server', 'both'] as const;
export type EvalSite = (typeof EVAL_SITES)[number];

/// FIRST-CLASS safety classification mirrored from the new
/// `CarCommand.securityClass` field in car-i99dash. Do NOT derive this
/// from `reversible` — `reversible` means "safe to predict/undo for
/// voice" (true for `door.unlock` and windows) which is the OPPOSITE of
/// "safe to fire unattended while moving" (plan §6.2).
export const SECURITY_CLASSES = ['none', 'safety', 'security'] as const;
export type SecurityClass = (typeof SECURITY_CLASSES)[number];

/// Rate-limit buckets — mirrors `proto/car_table.proto` `RateClass`.
export const RATE_CLASSES = ['actuator', 'climate', 'light', 'status_read', 'media'] as const;
export type RateClass = (typeof RATE_CLASSES)[number];

/// Document provenance — gates `consentedActions` enforcement: an
/// `imported` workflow's engine REFUSES any action not in
/// `consentedActions` until the owner consents in-car (plan §8, §12).
export const WORKFLOW_SOURCES = ['authored', 'imported'] as const;
export type WorkflowSource = (typeof WORKFLOW_SOURCES)[number];

// ─── Reusable field validators ──────────────────────────────────────

/// Node id — stable within the document, referenced by edges. Generated
/// by the canvas; opaque to the engine.
const NodeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, 'node id: alphanumeric, _ or - only');

/// Catalog signal name (e.g. `battery_pct`, `speed_kmh`). Name-typed
/// validation lives per-brand in the public catalog, not here — this is
/// shape-only, mirroring `car.ts`.
const SignalNameSchema = z.string().min(1).max(128);

/// A transition predicate string for `signal.transition` (e.g. `">5"`,
/// `"==0"`). Parsed by the engine; kept a constrained string here.
const PredicateSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^(==|!=|<=|>=|<|>)\s*-?\d+(\.\d+)?$/, 'predicate: an operator followed by a number');

// ─── Per-type config schemas ────────────────────────────────────────
// Each `.passthrough()` so a newer host/engine config key parses on an
// older SDK; the schema-version + supported-set gates handle forward
// compat. Validated against the node's `config` by the document-level
// superRefine below (kept out of the node objects so the node union can
// stay a zod discriminatedUnion).

const TriggerConfigByType: Record<TriggerType, z.ZodTypeAny> = {
  'signal.changed': z.object({ name: SignalNameSchema }).passthrough(),
  'signal.threshold': z
    .object({
      name: SignalNameSchema,
      op: z.enum(['<', '<=', '==', '!=', '>=', '>']),
      value: z.number(),
    })
    .passthrough(),
  'signal.transition': z
    .object({ name: SignalNameSchema, from: PredicateSchema, to: PredicateSchema })
    .passthrough(),
  'derived.signal': z
    .object({
      name: SignalNameSchema,
      sources: z.array(SignalNameSchema).nonempty(),
      expr: z.string().min(1).max(256),
    })
    .passthrough(),
  'time.at': z
    .object({
      hhmm: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'hhmm: 24-hour HH:MM'),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([0, 1, 2, 3, 4, 5, 6]),
      tz: z.string().min(1).max(64).default('car-local'),
      wakeOnAsleep: z.boolean().default(false),
    })
    .passthrough(),
  'time.interval': z
    .object({
      everyMin: z.number().int().min(1).max(1440),
      wakeOnAsleep: z.boolean().default(false),
    })
    .passthrough(),
  'time.cron': z
    .object({
      cron: z.string().min(1).max(128),
      tz: z.string().min(1).max(64).default('UTC'),
      wakeOnAsleep: z.boolean().default(false),
    })
    .passthrough(),
  'geo.enter': GeoConfig(),
  'geo.exit': GeoConfig(),
  'geo.dwell': GeoConfig({ dwell: true }),
  'conn.daemon_ready': z.object({}).passthrough(),
  'conn.state': z
    .object({ state: z.enum(['connected', 'reconnecting', 'disconnected']) })
    .passthrough(),
  'manual.tap': z
    .object({
      tileLabel: z.string().min(1).max(40),
      tileIcon: z.string().min(1).max(64).optional(),
    })
    .passthrough(),
  'app.event': z.object({ topic: z.string().min(1).max(64) }).passthrough(),
  'voice.phrase': z
    .object({
      phrase: z.string().min(1).max(120),
      examples: z.array(z.string().min(1).max(120)).max(8).optional(),
    })
    .passthrough(),
};

/// Geofence config builder (circle or polygon) with optional dwell.
/// Hysteresis (`enterRadiusM`/`exitRadiusM`) is optional; the engine
/// defaults exit to a wider radius to kill GPS-jitter chatter (plan §4).
function GeoConfig(opts: { dwell?: boolean } = {}): z.ZodTypeAny {
  const base = {
    place: z.string().min(1).max(64),
    shape: z.enum(['circle', 'polygon']),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    radiusM: z.number().positive().max(100_000).optional(),
    enterRadiusM: z.number().positive().max(100_000).optional(),
    exitRadiusM: z.number().positive().max(100_000).optional(),
    points: z
      .array(z.tuple([z.number(), z.number()]))
      .min(3)
      .optional(),
    ...(opts.dwell ? { dwellSec: z.number().int().min(1).max(86_400) } : {}),
  };
  return z
    .object(base)
    .passthrough()
    .superRefine((cfg, ctx) => {
      if (cfg.shape === 'circle' && (cfg.lat == null || cfg.lng == null || cfg.radiusM == null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'circle geofence needs lat, lng, radiusM',
        });
      }
      if (cfg.shape === 'polygon' && !cfg.points) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'polygon geofence needs points[]' });
      }
    });
}

const ConditionConfigByType: Record<ConditionType, z.ZodTypeAny> = {
  signal_compare: z
    .object({
      signal: SignalNameSchema,
      op: z.enum(COMPARE_OPS),
      value: z.number().optional(),
      value2: z.number().optional(),
    })
    .passthrough()
    .superRefine((cfg, ctx) => {
      if (cfg.op !== 'changed' && cfg.value == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `op "${cfg.op}" requires a value` });
      }
      if (cfg.op === 'between' && cfg.value2 == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'op "between" requires value2' });
      }
    }),
  // Phase B: grouped boolean tree. Kept shallow (one level of rules) in
  // v1; nested groups arrive with the Phase-B engine + a schema bump.
  logic_group: z
    .object({
      op: z.enum(['and', 'or', 'not']),
      rules: z
        .array(
          z
            .object({
              signal: SignalNameSchema,
              op: z.enum(COMPARE_OPS),
              value: z.number().optional(),
            })
            .passthrough(),
        )
        .min(1)
        .max(16),
    })
    .passthrough(),
};

/// Optional `key: value` argument map for car/radio/app commands.
const ArgMapSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

const ActionConfigByType: Record<ActionType, z.ZodTypeAny> = {
  car_command: z
    .object({ actionId: z.string().min(1).max(128), args: ArgMapSchema.optional() })
    .passthrough(),
  radio: z
    .object({ actionId: z.string().min(1).max(128), args: ArgMapSchema.optional() })
    .passthrough(),
  app: z
    .object({ actionId: z.string().min(1).max(128), args: ArgMapSchema.optional() })
    .passthrough(),
  ai: z
    .object({
      prompt: z.string().min(1).max(2000),
      maxHops: z.number().int().min(1).max(8).optional(),
    })
    .passthrough(),
  notify: z
    .object({
      title: z.string().min(1).max(80),
      body: z.string().max(280).optional(),
      target: z.string().max(32).optional(),
    })
    .passthrough(),
  delay: z.object({ ms: z.number().int().min(0).max(86_400_000) }).passthrough(),
  set_var: z
    .object({ name: z.string().min(1).max(64), expr: z.string().min(1).max(256) })
    .passthrough(),
};

/// Safety metadata attached to an action node, sourced from the
/// `workflow.catalog` bridge handler at authoring time. The engine
/// derives its independent stationary gate + confirmation policy from
/// `securityClass`/`requiresStationary` here — NEVER from `reversible`
/// (plan §6.1, §6.2). All optional so a forward catalog can omit unknowns.
const ActionFlagsSchema = z
  .object({
    requiresStationary: z.boolean().optional(),
    securityClass: z.enum(SECURITY_CLASSES).optional(),
    rateClass: z.enum(RATE_CLASSES).optional(),
    reversible: z.boolean().optional(),
  })
  .passthrough();
export type ActionFlags = z.infer<typeof ActionFlagsSchema>;

/// Cluster output node config (plan §7). The engine renders via
/// `surface.create`/`navigate`/`destroy` ONLY; `displayTarget` is a
/// preference resolved through gauge-builder's `resolveDriverTarget`
/// fallback ladder at run time. `persistent` dashboards are
/// stationary-gated and auto-torn-down off-Park.
const ClusterConfigSchema = z
  .object({
    displayTarget: z.string().min(1).max(32).default('driver'),
    route: z.string().min(1).max(256),
    mode: z.enum(['transient', 'persistent']).default('transient'),
    ttlMs: z.number().int().min(0).max(3_600_000).optional(),
    layoutB64: z.string().max(64_000).optional(),
  })
  .passthrough();

// ─── Node + edge schemas ────────────────────────────────────────────

const TriggerNodeSchema = z.object({
  id: NodeIdSchema,
  kind: z.literal('trigger'),
  type: z.enum(TRIGGER_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
  /// Universal anti-storm controls honored by every trigger type.
  debounceMs: z.number().int().min(0).max(3_600_000).default(0),
  cooldownMs: z.number().int().min(0).max(86_400_000).default(0),
  edge: z.enum(EDGE_MODES).default('rising'),
  /// Refuse to fire if `client.freshness(name)` is older than this
  /// (0 = no guard). Fail-closed to "unknown ⇒ don't fire".
  staleGuardMs: z.number().int().min(0).max(3_600_000).default(0),
  evalSite: z.enum(EVAL_SITES).default('car'),
});

const ConditionNodeSchema = z.object({
  id: NodeIdSchema,
  kind: z.literal('condition'),
  type: z.enum(CONDITION_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
  staleGuardMs: z.number().int().min(0).max(3_600_000).default(0),
});

const ActionNodeSchema = z.object({
  id: NodeIdSchema,
  kind: z.literal('action'),
  type: z.enum(ACTION_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
  flags: ActionFlagsSchema.default({}),
});

const ClusterOutputNodeSchema = z.object({
  id: NodeIdSchema,
  kind: z.literal('cluster_output'),
  config: ClusterConfigSchema,
});

/// Discriminated on `kind` (members are plain objects so this stays a
/// zod `discriminatedUnion`). Per-`type` config validation happens in
/// the document-level superRefine.
export const WorkflowNodeSchema = z.discriminatedUnion('kind', [
  TriggerNodeSchema,
  ConditionNodeSchema,
  ActionNodeSchema,
  ClusterOutputNodeSchema,
]);
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

/// Directed edge between nodes. `when` is set ONLY on edges leaving a
/// condition node ('true'/'false' branch); absent elsewhere.
export const WorkflowEdgeSchema = z
  .object({
    from: NodeIdSchema,
    to: NodeIdSchema,
    when: z.enum(['true', 'false']).optional(),
  })
  .passthrough();
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

// ─── Document ───────────────────────────────────────────────────────

/// Pipes a sub-schema's issues onto the document path so config errors
/// surface as `nodes[i].config.<field>`.
function pipeConfig(
  map: Record<string, z.ZodTypeAny>,
  type: string,
  config: unknown,
  index: number,
  ctx: z.RefinementCtx,
): void {
  const sub = map[type];
  if (!sub) return; // unknown type within an enum can't happen; guarded by zod above
  const res = sub.safeParse(config ?? {});
  if (!res.success) {
    for (const issue of res.error.issues) {
      ctx.addIssue({ ...issue, path: ['nodes', index, 'config', ...issue.path] });
    }
  }
}

export const WorkflowDocumentSchema = z
  .object({
    /// Schema version of THIS document (see [WORKFLOW_SCHEMA]). Defaults
    /// to the current schema when omitted.
    schema: z.number().int().min(1).default(WORKFLOW_SCHEMA),
    /// Stable id, minted by the backend on first save. Lives in any
    /// home-screen tile a `manual.tap` trigger mints.
    workflowId: z.string().regex(/^wf_[a-zA-Z0-9_-]{4,64}$/, 'workflowId: wf_<id>'),
    /// User-facing name (plain string — user content isn't localized).
    name: z.string().trim().min(1).max(120),
    /// Whether the engine should arm this workflow.
    enabled: z.boolean().default(true),
    /// Provenance. `imported` documents land disabled with an empty
    /// `consentedActions` and the engine refuses un-consented actions.
    source: z.enum(WORKFLOW_SOURCES).default('authored'),
    /// Action ids the owner explicitly consented to for an `imported`
    /// workflow. Ignored when `source === 'authored'`.
    consentedActions: z.array(z.string().min(1).max(128)).max(64).default([]),
    /// Monotonic revision, bumped on each save; drives sync diffing.
    version: z.number().int().min(1).default(1),
    /// The graph. At least one trigger node is required.
    nodes: z.array(WorkflowNodeSchema).min(1).max(128),
    edges: z.array(WorkflowEdgeSchema).max(256).default([]),
  })
  .passthrough()
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    let triggerCount = 0;
    const kindById = new Map<string, NodeKind>();

    doc.nodes.forEach((node, i) => {
      if (ids.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate node id "${node.id}"`,
          path: ['nodes', i, 'id'],
        });
      }
      ids.add(node.id);
      kindById.set(node.id, node.kind);
      if (node.kind === 'trigger') {
        triggerCount += 1;
        pipeConfig(TriggerConfigByType, node.type, node.config, i, ctx);
      } else if (node.kind === 'condition') {
        pipeConfig(ConditionConfigByType, node.type, node.config, i, ctx);
      } else if (node.kind === 'action') {
        pipeConfig(ActionConfigByType, node.type, node.config, i, ctx);
      }
      // cluster_output config is fully validated by ClusterConfigSchema in the node.
    });

    if (triggerCount < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a workflow needs at least one trigger node',
        path: ['nodes'],
      });
    }

    doc.edges.forEach((edge, i) => {
      if (!ids.has(edge.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `edge.from "${edge.from}" is not a node`,
          path: ['edges', i, 'from'],
        });
      }
      if (!ids.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `edge.to "${edge.to}" is not a node`,
          path: ['edges', i, 'to'],
        });
      }
      // `when` is only meaningful leaving a condition node.
      if (edge.when != null && kindById.get(edge.from) !== 'condition') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'edge.when may only be set on an edge leaving a condition node',
          path: ['edges', i, 'when'],
        });
      }
    });
  });

export type WorkflowDocument = z.infer<typeof WorkflowDocumentSchema>;

// ─── Forward-compat envelope + engine support gate ──────────────────

/// Lenient envelope read FIRST by the engine's schema gate, before the
/// full strict parse. Parses any future document without throwing so the
/// fail-closed `schema` comparison can run (mirrors `manifest.ts`'s
/// passthrough + `evaluateCompatibility` split).
export const WorkflowEnvelopeSchema = z
  .object({
    schema: z.number().int().min(1).default(WORKFLOW_SCHEMA),
    workflowId: z.string(),
  })
  .passthrough();
export type WorkflowEnvelope = z.infer<typeof WorkflowEnvelopeSchema>;

/// What an engine BUILD (or the host, for the canvas) actually supports.
/// Distinct from schema validity: a `type` can be valid-in-schema yet
/// not-yet-implemented by this engine build (Phase A ships a subset).
/// The canvas fetches this from the host to fail-closed at save time
/// (the owner chose free-wire authoring); the engine uses it to refuse
/// to arm. Keeping it data-driven keeps the SDK decoupled from any one
/// engine version.
export const WorkflowSupportSchema = z.object({
  engineSchema: z.number().int().min(1),
  triggerTypes: z.array(z.string()),
  conditionTypes: z.array(z.string()),
  actionTypes: z.array(z.string()),
  clusterOutput: z.boolean().default(false),
});
export type WorkflowSupport = z.infer<typeof WorkflowSupportSchema>;

export interface UnsupportedNode {
  id: string;
  kind: NodeKind;
  type?: string;
  reason: string;
}

export interface WorkflowSupportAssessment {
  /// True only if the document is schema-compatible AND every node is
  /// implemented by this engine/host build.
  supported: boolean;
  /// The document's `schema` is newer than the engine — fail closed.
  schemaTooNew: boolean;
  unsupportedNodes: UnsupportedNode[];
}

/// Cheap schema-only gate. Use before deep work; a `true` here does NOT
/// imply every node `type` is implemented — call [assessWorkflowSupport]
/// for that.
export function isSchemaCompatible(envelope: WorkflowEnvelope, engineSchema: number): boolean {
  return (envelope.schema ?? WORKFLOW_SCHEMA) <= engineSchema;
}

/// The shared fail-closed gate used by BOTH the canvas validator (reject
/// unsupported graphs at save) and the engine (refuse to arm). Returns
/// every node this build can't run + whether the schema itself is too new.
export function assessWorkflowSupport(
  doc: WorkflowDocument,
  support: WorkflowSupport,
): WorkflowSupportAssessment {
  const schemaTooNew = (doc.schema ?? WORKFLOW_SCHEMA) > support.engineSchema;
  const unsupportedNodes: UnsupportedNode[] = [];

  if (!schemaTooNew) {
    const trig = new Set(support.triggerTypes);
    const cond = new Set(support.conditionTypes);
    const act = new Set(support.actionTypes);
    for (const node of doc.nodes) {
      if (node.kind === 'trigger' && !trig.has(node.type)) {
        unsupportedNodes.push({
          id: node.id,
          kind: node.kind,
          type: node.type,
          reason: `trigger type "${node.type}" not supported by this build`,
        });
      } else if (node.kind === 'condition' && !cond.has(node.type)) {
        unsupportedNodes.push({
          id: node.id,
          kind: node.kind,
          type: node.type,
          reason: `condition type "${node.type}" not supported by this build`,
        });
      } else if (node.kind === 'action' && !act.has(node.type)) {
        unsupportedNodes.push({
          id: node.id,
          kind: node.kind,
          type: node.type,
          reason: `action type "${node.type}" not supported by this build`,
        });
      } else if (node.kind === 'cluster_output' && !support.clusterOutput) {
        unsupportedNodes.push({
          id: node.id,
          kind: node.kind,
          reason: 'cluster output not supported by this build',
        });
      }
    }
  }

  return {
    supported: !schemaTooNew && unsupportedNodes.length === 0,
    schemaTooNew,
    unsupportedNodes,
  };
}

export interface ParseWorkflowResult {
  ok: boolean;
  /// Present when `ok` — the validated, defaults-applied document.
  document?: WorkflowDocument;
  /// `schema_too_new` (fail closed without deep parse) | `invalid`
  /// (zod validation failed) — present when `!ok`.
  errorKind?: 'schema_too_new' | 'invalid';
  issues?: z.ZodIssue[];
}

/// One-call parse for engine/backend: envelope schema-gate FIRST (fail
/// closed if the document is newer than this engine), then the full
/// strict parse. `engineSchema` defaults to this SDK's [WORKFLOW_SCHEMA].
export function parseWorkflowDocument(
  input: unknown,
  opts: { engineSchema?: number } = {},
): ParseWorkflowResult {
  const engineSchema = opts.engineSchema ?? WORKFLOW_SCHEMA;
  const env = WorkflowEnvelopeSchema.safeParse(input);
  if (env.success && !isSchemaCompatible(env.data, engineSchema)) {
    return { ok: false, errorKind: 'schema_too_new' };
  }
  const full = WorkflowDocumentSchema.safeParse(input);
  if (!full.success) {
    return { ok: false, errorKind: 'invalid', issues: full.error.issues };
  }
  return { ok: true, document: full.data };
}
