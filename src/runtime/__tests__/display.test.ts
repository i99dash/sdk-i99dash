/// Coverage for the display family's wire-shape contract — adds
/// the optional fields landed in this branch (hidden / overrideLabel
/// / clusterAvailable / cursorDisplayId / inputSourceDisplayId /
/// zoomDisplayId) and the `RESERVED_OVERRIDE_LABELS` enum.
///
/// Two flavours of test:
///   1. **Old-host parity** — a `display.list` payload with only the
///      Phase-A fields parses cleanly; new optional fields read as
///      `undefined`. Guards against an SDK bump silently making
///      older car-i99dash builds unusable.
///   2. **New-host parity** — a payload carrying every documented
///      field surfaces verbatim through `client.display.list()`.

import { describe, expect, it } from 'vitest';

import type { FamilyBridge } from '../bridge.js';
import {
  DisplayController,
  type DisplaySnapshot,
  type VehicleContext,
  RESERVED_OVERRIDE_LABELS,
} from '../display.js';

class FakeFamilyBridge implements FamilyBridge {
  constructor(private readonly data: unknown) {}
  async getContext(): Promise<unknown> {
    return {};
  }
  async callFamily(): Promise<unknown> {
    return { success: true, data: this.data };
  }
}

describe('DisplaySnapshot wire shape', () => {
  it('parses a Phase-A host payload (no optional fields)', async () => {
    const bridge = new FakeFamilyBridge({
      displays: [
        {
          id: 0,
          name: 'ivi',
          width: 1920,
          height: 1080,
          densityDpi: 240,
          isDefault: true,
          isPresentation: false,
          isCluster: false,
          role: 'ivi',
        },
      ],
    });
    const ctrl = new DisplayController(bridge);
    const { displays } = await ctrl.list();
    expect(displays).toHaveLength(1);
    const d = displays[0]!;
    expect(d.id).toBe(0);
    expect(d.role).toBe('ivi');
    // The new optional fields are absent on Phase-A hosts; consumers
    // must read them with `?.` and tolerate `undefined`.
    expect(d.hidden).toBeUndefined();
    expect(d.overrideLabel).toBeUndefined();
    expect(d.clusterAvailable).toBeUndefined();
    expect(d.cursorDisplayId).toBeUndefined();
    expect(d.inputSourceDisplayId).toBeUndefined();
    expect(d.zoomDisplayId).toBeUndefined();
  });

  it('passes a host 1.6+ payload through with every documented field', async () => {
    const bridge = new FakeFamilyBridge({
      displays: [
        {
          id: 5,
          name: 'shared_fission_bg_XDJAScreenProjection_1',
          width: 1920,
          height: 720,
          densityDpi: 160,
          isDefault: false,
          isPresentation: true,
          isCluster: true,
          role: 'cluster',
          hidden: false,
          overrideLabel: 'Driver',
          clusterAvailable: true,
          cursorDisplayId: 5,
          inputSourceDisplayId: 3,
          zoomDisplayId: 5,
        },
      ],
    });
    const ctrl = new DisplayController(bridge);
    const { displays } = await ctrl.list();
    const [d] = displays;
    expect(d).toBeDefined();
    const snap = d as DisplaySnapshot;
    expect(snap.overrideLabel).toBe('Driver');
    expect(snap.hidden).toBe(false);
    expect(snap.clusterAvailable).toBe(true);
    expect(snap.cursorDisplayId).toBe(5);
    // XDJA's launch-vs-input asymmetry — input lands on display 3
    // even though the surface is logical display 5. Documented in
    // /docs/guides/multi-display.
    expect(snap.inputSourceDisplayId).toBe(3);
    expect(snap.zoomDisplayId).toBe(5);
  });

  it('surfaces a Driver-labeled passenger panel (Song Plus / L7 / HAN L)', async () => {
    // The reserved 'Driver' label is the SDK contract for "the
    // display in the driver's eyeline on this trim, regardless of
    // role". On trims without an addressable cluster but with a
    // driver-facing passenger panel, the host emits role=passenger
    // + overrideLabel='Driver'. Mini-apps target this combination
    // via pkg.launch (passenger scope), not pkg.launchCluster.
    const bridge = new FakeFamilyBridge({
      displays: [
        {
          id: 0,
          name: 'ivi',
          width: 1920,
          height: 1080,
          densityDpi: 240,
          isDefault: true,
          isPresentation: false,
          isCluster: false,
          role: 'ivi',
        },
        {
          id: 4,
          name: 'fse',
          width: 1920,
          height: 720,
          densityDpi: 160,
          isDefault: false,
          isPresentation: true,
          isCluster: false,
          role: 'passenger',
          hidden: false,
          overrideLabel: 'Driver',
          clusterAvailable: false,
        },
      ],
    });
    const ctrl = new DisplayController(bridge);
    const { displays } = await ctrl.list();
    const driver = displays.find((d) => d.role === 'passenger' && d.overrideLabel === 'Driver');
    expect(driver).toBeDefined();
    expect(driver!.id).toBe(4);
    expect(driver!.clusterAvailable).toBe(false);
  });
});

describe('DisplayListResult.vehicle', () => {
  it('returns undefined on a host that does not emit a vehicle block', async () => {
    const bridge = new FakeFamilyBridge({
      displays: [
        {
          id: 0,
          name: 'ivi',
          width: 1920,
          height: 1080,
          densityDpi: 240,
          isDefault: true,
          isPresentation: false,
          isCluster: false,
          role: 'ivi',
        },
      ],
    });
    const ctrl = new DisplayController(bridge);
    const r = await ctrl.list();
    expect(r.vehicle).toBeUndefined();
  });

  it('passes a precise (Tier 1) vehicle context through verbatim', async () => {
    const vehicle: VehicleContext = {
      dilinkFamily: 'di5.1',
      variantId: 'l8',
      subTrim: 'base',
      friendlyName: 'Leopard 8',
      capabilities: ['display.read', 'pkg.read', 'pkg.launch.cluster.pixel'],
      capabilityBits: 0b101011,
      isFallback: false,
      fallbackReason: null,
    };
    const bridge = new FakeFamilyBridge({ displays: [], vehicle });
    const ctrl = new DisplayController(bridge);
    const r = await ctrl.list();
    expect(r.vehicle).toEqual(vehicle);
    expect(r.vehicle?.capabilities?.includes('pkg.launch.cluster.pixel')).toBe(true);
  });

  it('surfaces a fallback (best-effort) vehicle context', async () => {
    // Tier 3 hit — trim aggregate served because the host's exact
    // sub-trim wasn't recognised. Mini-apps render UI as enabled but
    // tag it as best-effort.
    const bridge = new FakeFamilyBridge({
      displays: [],
      vehicle: {
        dilinkFamily: 'di5.0',
        variantId: 'l5',
        subTrim: '',
        friendlyName: 'Leopard 5',
        capabilities: ['display.read', 'pkg.launch.dishare'],
        capabilityBits: 0b1001,
        isFallback: true,
        fallbackReason: 'unknown_sub_trim',
      },
    });
    const ctrl = new DisplayController(bridge);
    const r = await ctrl.list();
    expect(r.vehicle?.isFallback).toBe(true);
    expect(r.vehicle?.fallbackReason).toBe('unknown_sub_trim');
  });
});

describe('RESERVED_OVERRIDE_LABELS', () => {
  it('lists Driver as the only reserved label today', () => {
    // Adding a new value here must coordinate with:
    //   * car-i99dash VehicleProfile.kt overrideLabels entries
    //   * docs/api/i99dash/runtime/display-snapshot
    //   * scripts/check-driver-label-contract.mjs
    expect([...RESERVED_OVERRIDE_LABELS]).toEqual(['Driver']);
  });

  it('is readonly at the type level', () => {
    // Smoke test that the `as const` assertion stuck — the array's
    // length type narrows to a literal, which is what makes the
    // ReservedOverrideLabel union derivation work.
    const len: 1 = RESERVED_OVERRIDE_LABELS.length;
    expect(len).toBe(1);
  });
});
