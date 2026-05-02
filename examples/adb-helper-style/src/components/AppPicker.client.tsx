'use client';

import { useEffect, useState } from 'react';

import type { AdminClient } from 'i99dash';

interface PackageRow {
  name: string;
  enabled: boolean;
  user: 0 | 999;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'ready'; packages: PackageRow[] };

type ActionState =
  | { kind: 'idle' }
  | { kind: 'pending'; pkg: string }
  | { kind: 'error'; pkg: string; message: string; code?: string };

/// AppPicker — list installed packages, with disable/enable per row.
///
/// Mirror of the APK's AppPickerActivity, but every operation runs
/// on the head-unit itself via ``cmdExec.*`` templates:
///
///   * ``pm.list_packages``   tier-1; loads the table
///   * ``pm.disable_user``    tier-2; covered by the install-time
///     session cap (no backend call after install for 30 days)
///   * ``pm.enable_user``     tier-2; same
///
/// The fixture in ``mocks/admin-pm-list-packages.GET.json`` shapes
/// the local dev experience — replace with what the real device
/// returns when a per-op executor wires ``Process.run("pm list
/// packages")``.
export default function AppPicker({ admin }: { admin: AdminClient }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [action, setAction] = useState<ActionState>({ kind: 'idle' });

  // Initial load + refresh trigger. We bump ``epoch`` after a
  // successful disable/enable to re-fetch the list.
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: 'loading' });
    admin
      .listPackages()
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          // Convert wire shape to the row shape the UI renders.
          // Real ``pm list packages`` output is bare strings; the
          // dev fixture pre-shapes for clarity.
          const raw = res.data as unknown as { packages: PackageRow[] };
          setPhase({ kind: 'ready', packages: raw.packages ?? [] });
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
  }, [admin, epoch]);

  async function toggle(pkg: PackageRow): Promise<void> {
    setAction({ kind: 'pending', pkg: pkg.name });
    try {
      const res = pkg.enabled
        ? await admin.disableUser({ user: pkg.user, package: pkg.name })
        : await admin.enableUser({ user: pkg.user, package: pkg.name });

      if (res.success) {
        setAction({ kind: 'idle' });
        setEpoch((n) => n + 1);
      } else {
        setAction({
          kind: 'error',
          pkg: pkg.name,
          message: res.error.message,
          code: res.error.code,
        });
      }
    } catch (e: unknown) {
      setAction({
        kind: 'error',
        pkg: pkg.name,
        message: String(e),
      });
    }
  }

  return (
    <section className="card">
      <h2>Installed packages</h2>
      <p className="subtitle">
        Disable BYD-side packages from the allow-list. Re-enable any time. Uses{' '}
        <code>pm.disable_user</code> / <code>pm.enable_user</code> templates.
      </p>

      {action.kind === 'error' && (
        <div className="error-msg">
          {action.code ? `[${action.code}] ` : ''}
          {action.pkg}: {action.message}
        </div>
      )}

      {phase.kind === 'loading' && <p>loading…</p>}
      {phase.kind === 'error' && (
        <div className="error-msg">
          {phase.code ? `[${phase.code}] ` : ''}
          {phase.message}
        </div>
      )}
      {phase.kind === 'ready' && phase.packages.length === 0 && (
        <p className="subtitle">No packages found.</p>
      )}
      {phase.kind === 'ready' &&
        phase.packages.map((pkg) => {
          const pending = action.kind === 'pending' && action.pkg === pkg.name;
          return (
            <div className="row" key={`${pkg.user}::${pkg.name}`}>
              <div>
                <div className="row-label">{pkg.name}</div>
                <div className="row-meta">
                  user={pkg.user} ·{' '}
                  {pkg.enabled ? (
                    <span className="badge badge-ok">enabled</span>
                  ) : (
                    <span className="badge badge-warn">disabled</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className={pkg.enabled ? 'btn btn-danger' : 'btn'}
                disabled={pending}
                onClick={() => {
                  void toggle(pkg);
                }}
              >
                {pending ? '…' : pkg.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          );
        })}
    </section>
  );
}
