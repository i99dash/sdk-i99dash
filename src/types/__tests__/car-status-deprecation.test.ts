import { describe, expect, it } from 'vitest';
import { CarStatusSchema, type CarStatus } from '../car-status.js';

/// v3.1 deprecation-overlap contract:
///   - Inputs may use the legacy `vin` key, the new `bydDeviceId` key,
///     or both. Either route parses; both fields are populated on the
///     parsed output so consumers reading either keep working.
///   - When both are present, `bydDeviceId` wins (legacy alias is
///     overwritten with the canonical value).
///   - Missing both is still a parse error — the schema demands an id.
///
/// This file is the regression fence so we don't accidentally drop the
/// `vin` alias before v4.0.

const baseValid = {
  at: '2026-05-07T08:00:00.000Z',
  staleness: 'fresh' as const,
};

describe('CarStatusSchema — vin/bydDeviceId deprecation overlap', () => {
  it('accepts payloads with the legacy `vin` field and populates `bydDeviceId`', () => {
    const parsed: CarStatus = CarStatusSchema.parse({
      ...baseValid,
      vin: 'BYD-OLD-NAME-001',
    });
    expect(parsed.vin).toBe('BYD-OLD-NAME-001');
    expect(parsed.bydDeviceId).toBe('BYD-OLD-NAME-001');
  });

  it('accepts payloads with the new `bydDeviceId` field and populates `vin`', () => {
    const parsed: CarStatus = CarStatusSchema.parse({
      ...baseValid,
      bydDeviceId: 'BYD-NEW-NAME-002',
    });
    expect(parsed.bydDeviceId).toBe('BYD-NEW-NAME-002');
    expect(parsed.vin).toBe('BYD-NEW-NAME-002');
  });

  it('prefers `bydDeviceId` when both are present', () => {
    const parsed: CarStatus = CarStatusSchema.parse({
      ...baseValid,
      vin: 'old',
      bydDeviceId: 'new',
    });
    expect(parsed.bydDeviceId).toBe('new');
    expect(parsed.vin).toBe('new');
  });

  it('rejects payloads with neither id field', () => {
    expect(() => CarStatusSchema.parse({ ...baseValid })).toThrow();
  });

  it('rejects empty-string ids on either name', () => {
    expect(() => CarStatusSchema.parse({ ...baseValid, vin: '' })).toThrow();
    expect(() => CarStatusSchema.parse({ ...baseValid, bydDeviceId: '' })).toThrow();
  });
});
