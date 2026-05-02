'use client';

import { useEffect, useState } from 'react';

import type { AdminClient } from 'i99dash';

interface FsEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

interface FsListing {
  path: string;
  entries: FsEntry[];
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'ready'; listing: FsListing };

/// Allow-listed paths the ``fs.ls`` template accepts. Any input
/// outside this set rejects server-side with
/// ``param_validation_failed``; the dropdown limits the UI to the
/// same set so a user can't even *try* an off-allow-list path.
const ALLOWED_PATHS = ['/sdcard/Download', '/data/local/tmp', '/storage/emulated/0'] as const;

type AllowedPath = (typeof ALLOWED_PATHS)[number];

/// FileBrowser — read-only view of the head-unit's allow-listed
/// directories. No push/pull (those would need USB-OTG which is
/// out of the mini-app sandbox); just inspection.
export default function FileBrowser({ admin }: { admin: AdminClient }) {
  const [path, setPath] = useState<AllowedPath>(ALLOWED_PATHS[0]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: 'loading' });
    admin
      .invoke<FsListing>('fs.ls', { path })
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setPhase({ kind: 'ready', listing: res.data });
        } else {
          setPhase({
            kind: 'error',
            message: res.error.message,
            code: res.error.code,
          });
        }
      })
      .catch((e: unknown) =>
        cancelled ? undefined : setPhase({ kind: 'error', message: String(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [admin, path]);

  return (
    <section className="card">
      <h2>Filesystem</h2>
      <p className="subtitle">
        Read-only browse of the head-unit's allow-listed paths. Push / pull / delete are not exposed
        — those need capabilities outside the mini-app sandbox.
      </p>

      <div className="row">
        <span className="row-label">Path</span>
        <select
          className="picker"
          value={path}
          onChange={(e) => {
            setPath(e.target.value as AllowedPath);
          }}
        >
          {ALLOWED_PATHS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {phase.kind === 'loading' && <p style={{ marginTop: 12 }}>loading…</p>}
      {phase.kind === 'error' && (
        <div className="error-msg" style={{ marginTop: 12 }}>
          {phase.code ? `[${phase.code}] ` : ''}
          {phase.message}
        </div>
      )}
      {phase.kind === 'ready' && phase.listing.entries.length === 0 && (
        <p className="subtitle" style={{ marginTop: 12 }}>
          (empty directory)
        </p>
      )}
      {phase.kind === 'ready' &&
        phase.listing.entries.map((e) => (
          <div className="row" key={e.name}>
            <div>
              <span className="row-label">{e.name}</span>
              <div className="row-meta">{e.isDirectory ? 'directory' : `${e.size} bytes`}</div>
            </div>
            {e.isDirectory && <span className="badge badge-warn">dir</span>}
          </div>
        ))}
    </section>
  );
}
