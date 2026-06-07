/// Canonical artifact-manifest serialisation for native-APK publishing (K1).
///
/// THIS IS A CROSS-REPO CONTRACT. The bytes produced here must match the
/// backend's `app/domain/app_store/signing.py::canonical_artifact_manifest`
/// exactly (the developer signs these bytes; the backend verifies the
/// signature over its own recomputation). Rules: JSON, keys sorted
/// alphabetically, no whitespace, UTF-8. Do not reorder/rename without
/// bumping the backend + car ports.

export interface ArtifactManifestInput {
  packageName: string;
  versionCode: number;
  versionName: string;
  apkSha256: string;
  sizeBytes: number;
  apkSignerSha256: string;
}

/// Normalise an Android signer SHA: drop colons, lowercase (matches the
/// backend's `_norm_sha`).
export function normSignerSha(s: string): string {
  return s.replace(/:/g, '').toLowerCase();
}

/// Produce the exact UTF-8 bytes the developer signs. Keys are written in
/// alphabetical order so `JSON.stringify` (insertion-order, no spaces)
/// reproduces Python's `json.dumps(sort_keys=True, separators=(",", ":"))`.
export function canonicalArtifactManifest(m: ArtifactManifestInput): Buffer {
  const ordered = {
    apkSha256: m.apkSha256.toLowerCase(),
    apkSignerSha256: normSignerSha(m.apkSignerSha256),
    packageName: m.packageName,
    sizeBytes: m.sizeBytes,
    versionCode: m.versionCode,
    versionName: m.versionName,
  };
  return Buffer.from(JSON.stringify(ordered), 'utf8');
}
