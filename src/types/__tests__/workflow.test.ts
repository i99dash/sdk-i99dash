import { describe, it, expect } from 'vitest';
import {
  WORKFLOW_SCHEMA,
  WorkflowDocumentSchema,
  assessWorkflowSupport,
  parseWorkflowDocument,
  type WorkflowDocument,
  type WorkflowSupport,
} from '../workflow.js';

/// A canonical document: signal-threshold trigger → signal_compare
/// condition → a SAFE car_command action (the Phase-A MVP shape).
const valid = {
  workflowId: 'wf_coldmorning',
  name: 'Cold-morning preheat',
  nodes: [
    {
      id: 'n1',
      kind: 'trigger',
      type: 'signal.threshold',
      config: { name: 'cabin_temp_c', op: '<', value: 10 },
    },
    {
      id: 'n2',
      kind: 'condition',
      type: 'signal_compare',
      config: { signal: 'battery_pct', op: '>', value: 20 },
    },
    {
      id: 'n3',
      kind: 'action',
      type: 'car_command',
      config: { actionId: 'climate.power.on', args: { tempC: 22 } },
      flags: { requiresStationary: true, securityClass: 'none', rateClass: 'climate' },
    },
  ],
  edges: [
    { from: 'n1', to: 'n2' },
    { from: 'n2', to: 'n3', when: 'true' },
  ],
};

// Phase-A engine support: a deliberately narrow subset (cutline §11).
const phaseASupport: WorkflowSupport = {
  engineSchema: WORKFLOW_SCHEMA,
  triggerTypes: ['signal.threshold'],
  conditionTypes: ['signal_compare'],
  actionTypes: ['car_command', 'radio', 'app'],
  clusterOutput: false,
};

describe('WorkflowDocumentSchema', () => {
  it('accepts a canonical document and applies defaults', () => {
    const doc = WorkflowDocumentSchema.parse(valid);
    expect(doc.schema).toBe(WORKFLOW_SCHEMA);
    expect(doc.enabled).toBe(true);
    expect(doc.source).toBe('authored');
    expect(doc.version).toBe(1);
    expect(doc.nodes[0]?.kind).toBe('trigger');
    if (doc.nodes[0]?.kind === 'trigger') {
      expect(doc.nodes[0].edge).toBe('rising'); // safe default
    }
  });

  it('rejects a document with no trigger node', () => {
    const noTrigger = {
      ...valid,
      nodes: [{ id: 'n1', kind: 'action', type: 'car_command', config: { actionId: 'light.on' } }],
      edges: [],
    };
    expect(WorkflowDocumentSchema.safeParse(noTrigger).success).toBe(false);
  });

  it('rejects an edge referencing a non-existent node', () => {
    const dangling = { ...valid, edges: [{ from: 'n1', to: 'nope' }] };
    const r = WorkflowDocumentSchema.safeParse(dangling);
    expect(r.success).toBe(false);
  });

  it('rejects a `when` branch on an edge leaving a non-condition node', () => {
    const badWhen = { ...valid, edges: [{ from: 'n1', to: 'n2', when: 'true' }] };
    const r = WorkflowDocumentSchema.safeParse(badWhen);
    expect(r.success).toBe(false);
  });

  it('rejects duplicate node ids', () => {
    const dup = {
      ...valid,
      nodes: [
        {
          id: 'n1',
          kind: 'trigger',
          type: 'signal.threshold',
          config: { name: 'speed_kmh', op: '>', value: 5 },
        },
        { id: 'n1', kind: 'action', type: 'car_command', config: { actionId: 'light.on' } },
      ],
      edges: [],
    };
    expect(WorkflowDocumentSchema.safeParse(dup).success).toBe(false);
  });

  it('surfaces per-type config errors at nodes[i].config.<field>', () => {
    const badThreshold = {
      ...valid,
      nodes: [
        { id: 'n1', kind: 'trigger', type: 'signal.threshold', config: { name: 'cabin_temp_c' } }, // missing op + value
      ],
      edges: [],
    };
    const r = WorkflowDocumentSchema.safeParse(badThreshold);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.').startsWith('nodes.0.config'))).toBe(true);
    }
  });

  it('requires a value for a comparison op other than "changed"', () => {
    const noValue = {
      ...valid,
      nodes: [
        { id: 'n1', kind: 'trigger', type: 'signal.changed', config: { name: 'belt_main' } },
        {
          id: 'n2',
          kind: 'condition',
          type: 'signal_compare',
          config: { signal: 'battery_pct', op: '<' },
        },
      ],
      edges: [{ from: 'n1', to: 'n2' }],
    };
    expect(WorkflowDocumentSchema.safeParse(noValue).success).toBe(false);
  });

  it('validates a circle geofence requires lat/lng/radiusM', () => {
    const badGeo = {
      ...valid,
      nodes: [
        {
          id: 'n1',
          kind: 'trigger',
          type: 'geo.enter',
          config: { place: 'home', shape: 'circle' },
        },
      ],
      edges: [],
    };
    expect(WorkflowDocumentSchema.safeParse(badGeo).success).toBe(false);
  });
});

describe('parseWorkflowDocument forward-compat gate', () => {
  it('fails closed (schema_too_new) when the document schema exceeds the engine', () => {
    const future = { ...valid, schema: WORKFLOW_SCHEMA + 1 };
    const r = parseWorkflowDocument(future, { engineSchema: WORKFLOW_SCHEMA });
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe('schema_too_new');
  });

  it('parses a same-schema document', () => {
    const r = parseWorkflowDocument(valid, { engineSchema: WORKFLOW_SCHEMA });
    expect(r.ok).toBe(true);
    expect(r.document?.workflowId).toBe('wf_coldmorning');
  });

  it('reports invalid for a structurally broken document', () => {
    const r = parseWorkflowDocument({ workflowId: 'wf_x', name: 'x', nodes: [] }, {});
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe('invalid');
  });
});

describe('assessWorkflowSupport (shared canvas + engine fail-closed gate)', () => {
  it('passes a document whose nodes are all supported by the build', () => {
    const doc = WorkflowDocumentSchema.parse(valid);
    const a = assessWorkflowSupport(doc, phaseASupport);
    expect(a.supported).toBe(true);
    expect(a.unsupportedNodes).toHaveLength(0);
  });

  it('flags an unsupported trigger type (e.g. geofence in Phase A)', () => {
    const doc: WorkflowDocument = WorkflowDocumentSchema.parse({
      ...valid,
      nodes: [
        {
          id: 'n1',
          kind: 'trigger',
          type: 'geo.enter',
          config: { place: 'home', shape: 'circle', lat: 25.2, lng: 55.3, radiusM: 150 },
        },
        { id: 'n3', kind: 'action', type: 'car_command', config: { actionId: 'climate.power.on' } },
      ],
      edges: [{ from: 'n1', to: 'n3' }],
    });
    const a = assessWorkflowSupport(doc, phaseASupport);
    expect(a.supported).toBe(false);
    expect(a.unsupportedNodes[0]?.type).toBe('geo.enter');
  });

  it('flags cluster output when the build does not support it', () => {
    const doc = WorkflowDocumentSchema.parse({
      ...valid,
      nodes: [
        ...valid.nodes,
        { id: 'n4', kind: 'cluster_output', config: { route: '/wf.html', mode: 'transient' } },
      ],
      edges: [...valid.edges, { from: 'n3', to: 'n4' }],
    });
    const a = assessWorkflowSupport(doc, phaseASupport);
    expect(a.supported).toBe(false);
    expect(a.unsupportedNodes.some((n) => n.kind === 'cluster_output')).toBe(true);
  });

  it('fails closed when the document schema is newer than the engine', () => {
    const doc = WorkflowDocumentSchema.parse(valid);
    const a = assessWorkflowSupport({ ...doc, schema: WORKFLOW_SCHEMA + 5 }, phaseASupport);
    expect(a.supported).toBe(false);
    expect(a.schemaTooNew).toBe(true);
  });
});
