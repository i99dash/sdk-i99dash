import { describe, expect, it } from 'vitest';
import { CarStatusSchema, type CarStatus } from '../car-status.js';

/// v4.0 hard-cutover contract:
///   - `deviceId` is the brand-prefixed canonical (`byd:BYDMCKLE...`).
///   - `brand` is the lowercase brand string sibling field.
///   - No legacy aliases — `vin` and `bydDeviceId` fail strict parse.
///   - Missing either id field is still a parse error.
///
/// This file is the regression fence pinning the post-rename shape so
/// nobody accidentally re-introduces a `vin` / `bydDeviceId` alias.

const baseValid = {
  at: '2026-05-13T08:00:00.000Z',
  staleness: 'fresh' as const,
};

describe('CarStatusSchema — v4.0 deviceId + brand', () => {
  it('accepts payloads with the canonical `deviceId` + `brand` pair', () => {
    const parsed: CarStatus = CarStatusSchema.parse({
      ...baseValid,
      deviceId: 'byd:BYDMCKLE0PARD8801',
      brand: 'byd',
    });
    expect(parsed.deviceId).toBe('byd:BYDMCKLE0PARD8801');
    expect(parsed.brand).toBe('byd');
  });

  it('rejects payloads with the legacy `bydDeviceId` field (no alias)', () => {
    expect(() =>
      CarStatusSchema.parse({
        ...baseValid,
        bydDeviceId: 'BYDMCKLE0PARD8801',
        brand: 'byd',
      }),
    ).toThrow();
  });

  it('rejects payloads with the legacy `vin` field (no alias)', () => {
    expect(() =>
      CarStatusSchema.parse({
        ...baseValid,
        vin: 'BYDMCKLE0PARD8801',
        brand: 'byd',
      }),
    ).toThrow();
  });

  it('rejects payloads with neither id field', () => {
    expect(() => CarStatusSchema.parse({ ...baseValid, brand: 'byd' })).toThrow();
  });

  it('rejects payloads missing `brand`', () => {
    expect(() =>
      CarStatusSchema.parse({ ...baseValid, deviceId: 'byd:BYDMCKLE0PARD8801' }),
    ).toThrow();
  });

  it('rejects unknown brand values', () => {
    expect(() =>
      CarStatusSchema.parse({
        ...baseValid,
        deviceId: 'ford:1FTFW1ET5DFC10312',
        brand: 'ford',
      }),
    ).toThrow();
  });

  it('rejects empty-string device id', () => {
    expect(() => CarStatusSchema.parse({ ...baseValid, deviceId: '', brand: 'byd' })).toThrow();
  });
});
