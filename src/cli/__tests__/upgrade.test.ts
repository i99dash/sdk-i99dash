import { describe, expect, it } from 'vitest';

import { isNewer, platformKey, versionTuple } from '../commands/upgrade.js';

describe('upgrade version logic', () => {
  it('parses version cores, dropping pre-release/build metadata', () => {
    expect(versionTuple('5.4.1')).toEqual([5, 4, 1]);
    expect(versionTuple('v5.4.1')).toEqual([5, 4, 1]);
    expect(versionTuple('5.4.1-rc.2')).toEqual([5, 4, 1]);
    expect(versionTuple('5.4.1+build.7')).toEqual([5, 4, 1]);
  });

  it('orders versions correctly', () => {
    expect(isNewer('5.4.1', '5.4.0')).toBe(true);
    expect(isNewer('5.5.0', '5.4.9')).toBe(true);
    expect(isNewer('6.0.0', '5.9.9')).toBe(true);
    expect(isNewer('5.4.0', '5.4.0')).toBe(false);
    expect(isNewer('5.3.9', '5.4.0')).toBe(false);
    // a pre-release never sorts above its matching release
    expect(isNewer('5.4.1-rc1', '5.4.1')).toBe(false);
  });

  it('maps the current host to a published target or null', () => {
    expect(['linux-x64', 'macos-arm64', 'macos-x64', 'windows-x64', null]).toContain(platformKey());
  });
});
