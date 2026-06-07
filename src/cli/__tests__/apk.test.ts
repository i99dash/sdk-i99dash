import { describe, expect, it } from 'vitest';

import { ApkManifestSchema } from '../config/apk-load.js';
import { canonicalArtifactManifest, normSignerSha } from '../util/apk-canonical.js';

describe('canonicalArtifactManifest', () => {
  it('matches the backend canonical bytes exactly (cross-repo contract)', () => {
    // Must equal Python json.dumps(sort_keys=True, separators=(",",":"))
    // of the same fields (see app/domain/app_store/signing.py).
    const bytes = canonicalArtifactManifest({
      packageName: 'com.acme.dashcam',
      versionCode: 1,
      versionName: '1.0.0',
      apkSha256: 'A'.repeat(64),
      sizeBytes: 2048,
      apkSignerSha256: 'AB:CD',
    });
    expect(bytes.toString('utf8')).toBe(
      '{"apkSha256":"' +
        'a'.repeat(64) +
        '","apkSignerSha256":"abcd","packageName":"com.acme.dashcam",' +
        '"sizeBytes":2048,"versionCode":1,"versionName":"1.0.0"}',
    );
  });

  it('normalises the signer SHA (drop colons, lowercase)', () => {
    expect(normSignerSha('AB:CD:ef')).toBe('abcdef');
  });
});

describe('ApkManifestSchema', () => {
  const base = {
    id: 'com.acme.dashcam',
    versionName: '1.0.0',
    versionCode: 1,
    apkPath: './app-release.apk',
    signerSha256: 'ab'.repeat(32),
  };

  it('accepts a valid reverse-DNS manifest', () => {
    expect(ApkManifestSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a reserved first-party id', () => {
    expect(ApkManifestSchema.safeParse({ ...base, id: 'i99dash' }).success).toBe(false);
    expect(ApkManifestSchema.safeParse({ ...base, id: 'fq' }).success).toBe(false);
  });

  it('rejects a non-reverse-DNS id', () => {
    expect(ApkManifestSchema.safeParse({ ...base, id: 'acme' }).success).toBe(false);
    expect(ApkManifestSchema.safeParse({ ...base, id: 'Com.Acme.App' }).success).toBe(false);
  });

  it('rejects a non-positive versionCode', () => {
    expect(ApkManifestSchema.safeParse({ ...base, versionCode: 0 }).success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    expect(ApkManifestSchema.safeParse({ ...base, surprise: true }).success).toBe(false);
  });
});
