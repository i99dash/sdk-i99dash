// @vitest-environment jsdom
/// Tests for the `client.workflow` controller — the `workflow.*` Tier-1
/// surface. Strategy mirrors car.test.ts: hand a stub that satisfies the
/// `callHandler(name, payload)` contract and returns canned wire payloads.

import { describe, expect, it } from 'vitest';

import { MiniAppClient, type Bridge, WorkflowController } from '../index.js';
import { InvalidResponseError } from '../errors.js';

interface Stub {
  bridge: Bridge;
  calls: { name: string; payload: unknown }[];
}

function newStub(response: unknown): Stub {
  const calls: { name: string; payload: unknown }[] = [];
  const bridge = {
    getContext: async () => ({}),
    callHandler: async (name: string, ...args: unknown[]) => {
      calls.push({ name, payload: args[0] });
      return response;
    },
  } as unknown as Bridge;
  return { bridge, calls };
}

const sampleCatalog = {
  bridgeVersion: '2.0.0',
  catalogSchema: 1,
  brand: 'byd',
  actions: [
    {
      id: 'door.unlock',
      label: 'UNLOCK',
      category: 'door',
      requiresStationary: true,
      reversible: false,
      securityClass: 'security',
      rateClass: 'actuator',
    },
    {
      id: 'climate.power.on',
      label: 'AC ON',
      category: 'climate',
      requiresStationary: false,
      reversible: true,
      securityClass: 'none',
      rateClass: 'climate',
    },
    {
      id: 'window.fl.close',
      label: 'DRV WINDOW CLOSE',
      category: 'window',
      requiresStationary: false,
      reversible: true,
      securityClass: 'safety',
      rateClass: null,
      voiceGroup: 'window_control',
      voiceGroupParams: { window: 'fl | fr | rl | rr | all', action: 'open | close | stop | down' },
    },
  ],
};

describe('WorkflowController.catalog', () => {
  it('parses a canonical catalog response and calls the workflow.catalog handler', async () => {
    const stub = newStub(sampleCatalog);
    const ctl = new WorkflowController(stub.bridge);
    const res = await ctl.catalog();
    expect(stub.calls[0]?.name).toBe('workflow.catalog');
    expect(res.actions).toHaveLength(3);
    const unlock = res.actions.find((a) => a.id === 'door.unlock');
    expect(unlock?.securityClass).toBe('security'); // first-class, not derived from reversible
    expect(unlock?.reversible).toBe(false);
  });

  it('is reachable via client.workflow and surfaces dangerous actions by securityClass', async () => {
    const client = MiniAppClient.withBridge(newStub(sampleCatalog).bridge);
    const { actions } = await client.workflow.catalog();
    const dangerous = actions.filter((a) => a.securityClass !== 'none').map((a) => a.id);
    expect(dangerous).toContain('door.unlock'); // security
    expect(dangerous).toContain('window.fl.close'); // safety — NOT gated by requiresStationary today
    expect(dangerous).not.toContain('climate.power.on');
  });

  it('throws InvalidResponseError when the payload is malformed', async () => {
    const ctl = new WorkflowController(newStub({ bridgeVersion: '2.0.0', actions: 'nope' }).bridge);
    await expect(ctl.catalog()).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('rejects an action entry missing securityClass', async () => {
    const bad = {
      ...sampleCatalog,
      actions: [
        {
          id: 'x',
          label: 'X',
          category: 'door',
          requiresStationary: false,
          reversible: true,
          rateClass: null,
        },
      ],
    };
    const ctl = new WorkflowController(newStub(bad).bridge);
    await expect(ctl.catalog()).rejects.toBeInstanceOf(InvalidResponseError);
  });
});

const sampleRecord = {
  id: '7c2b',
  name: 'Preheat',
  document: { workflowId: 'wf_x', name: 'Preheat', nodes: [], edges: [] },
  doc_sha256: 'abc123',
  rev: 1,
  enabled: true,
  source: 'authored',
  install_id: null,
};

describe('WorkflowController CRUD (host-proxied)', () => {
  it('list() returns the workflow records', async () => {
    const stub = newStub({ workflows: [sampleRecord] });
    const out = await new WorkflowController(stub.bridge).list();
    expect(stub.calls[0]?.name).toBe('workflow.list');
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('7c2b');
  });

  it('save() forwards fields as snake_case', async () => {
    const stub = newStub(sampleRecord);
    const rec = await new WorkflowController(stub.bridge).save({
      name: 'Preheat',
      document: { workflowId: 'wf_x' },
      enabled: true,
      source: 'authored',
      installId: null,
    });
    expect(stub.calls[0]?.name).toBe('workflow.save');
    const payload = stub.calls[0]?.payload as Record<string, unknown>;
    expect(payload.install_id).toBeNull();
    expect(payload.document).toEqual({ workflowId: 'wf_x' });
    expect(rec.rev).toBe(1);
  });

  it('setEnabled() calls workflow.setEnabled with the toggle', async () => {
    const stub = newStub({ ...sampleRecord, enabled: false });
    await new WorkflowController(stub.bridge).setEnabled('7c2b', false);
    expect(stub.calls[0]?.name).toBe('workflow.setEnabled');
    expect((stub.calls[0]?.payload as Record<string, unknown>).enabled).toBe(false);
  });

  it('remove() calls workflow.delete', async () => {
    const stub = newStub({ deleted: true });
    await new WorkflowController(stub.bridge).remove('7c2b');
    expect(stub.calls[0]?.name).toBe('workflow.delete');
  });

  it('surfaces a host error envelope as a transport error', async () => {
    const stub = newStub({ error: 'WORKFLOW_LIMIT_REACHED' });
    await expect(
      new WorkflowController(stub.bridge).save({ name: 'x', document: {} }),
    ).rejects.toThrow(/WORKFLOW_LIMIT_REACHED/);
  });
});

const sampleTemplateSummary = {
  id: 'tpl-1',
  name: 'Preheat on cold mornings',
  summary: 'Warms the cabin when it gets cold',
  category: 'comfort',
  installs: 42,
  created_at: '2026-06-15T00:00:00Z',
};

const sampleTemplateView = {
  ...sampleTemplateSummary,
  status: 'approved',
  document: { workflowId: 'wf_tpl', name: 'Preheat', nodes: [], edges: [] },
};

describe('WorkflowController templates (sharing lane)', () => {
  it('templates() lists public summaries and forwards the category filter', async () => {
    const stub = newStub({ templates: [sampleTemplateSummary] });
    const out = await new WorkflowController(stub.bridge).templates('comfort');
    expect(stub.calls[0]?.name).toBe('workflow.templates');
    expect((stub.calls[0]?.payload as Record<string, unknown>).category).toBe('comfort');
    expect(out).toHaveLength(1);
    expect(out[0]?.installs).toBe(42);
  });

  it('getTemplate() returns the detail view with its document', async () => {
    const stub = newStub(sampleTemplateView);
    const out = await new WorkflowController(stub.bridge).getTemplate('tpl-1');
    expect(stub.calls[0]?.name).toBe('workflow.getTemplate');
    expect(out.status).toBe('approved');
    expect(out.document.workflowId).toBe('wf_tpl');
  });

  it('publishTemplate() defaults summary/category and returns the view', async () => {
    const stub = newStub(sampleTemplateView);
    const out = await new WorkflowController(stub.bridge).publishTemplate({
      name: 'Preheat',
      document: { workflowId: 'wf_tpl' },
    });
    expect(stub.calls[0]?.name).toBe('workflow.publishTemplate');
    const payload = stub.calls[0]?.payload as Record<string, unknown>;
    expect(payload.summary).toBe('');
    expect(payload.category).toBe('general');
    expect(out.id).toBe('tpl-1');
  });

  it('importTemplate() returns the created (imported, disabled) workflow record', async () => {
    const stub = newStub({ ...sampleRecord, source: 'imported', enabled: false });
    const rec = await new WorkflowController(stub.bridge).importTemplate('tpl-1');
    expect(stub.calls[0]?.name).toBe('workflow.importTemplate');
    expect((stub.calls[0]?.payload as Record<string, unknown>).id).toBe('tpl-1');
    expect(rec.source).toBe('imported');
    expect(rec.enabled).toBe(false);
  });

  it('surfaces a host error envelope (e.g. lane disabled) as a transport error', async () => {
    const stub = newStub({ error: 'AUTOMATION_TEMPLATES_DISABLED' });
    await expect(new WorkflowController(stub.bridge).templates()).rejects.toThrow(
      /AUTOMATION_TEMPLATES_DISABLED/,
    );
  });
});
