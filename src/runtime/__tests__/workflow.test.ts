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
