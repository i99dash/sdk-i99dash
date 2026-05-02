'use client';

import { useEffect, useState } from 'react';

import type { AdminClient } from 'i99dash';

interface MqttStatus {
  connected: boolean;
  lastMessageAt: string | null;
}

interface LogTail {
  lines: string[];
}

type ActionState =
  | { kind: 'idle' }
  | { kind: 'pending'; op: string }
  | { kind: 'error'; op: string; message: string; code?: string }
  | { kind: 'success'; op: string; message: string };

const TAIL_REFRESH_MS = 5000;

/// SystemPanel — buttons for the maintenance ops + a live log tail.
///
/// Tier classification matters here:
///   * ``diag.mqtt_status``    tier 1, polled every 5 s
///   * ``diag.tail_logs``      tier 1, polled every 5 s
///   * ``diag.restart_mqtt``   tier 2 (no step-up)
///   * ``diag.clear_cache``    tier 2 (no step-up)
///   * ``sys.reboot``          tier 2 + STEP-UP — host returns
///     ``step_up_required`` until the user re-auths via the
///     per-action ``/runtime/cap`` flow
///
/// The reboot button shows a confirmation dialog *before* dispatch
/// to make the step-up implication visible.
export default function SystemPanel({ admin }: { admin: AdminClient }) {
  const [status, setStatus] = useState<MqttStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [action, setAction] = useState<ActionState>({ kind: 'idle' });
  const [confirmReboot, setConfirmReboot] = useState(false);

  // Periodic refresh of the read-only diagnostics.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const [mqtt, tail] = await Promise.all([admin.mqttStatus(), admin.tailLogs({ lines: 50 })]);
      if (cancelled) return;
      if (mqtt.success) {
        setStatus(mqtt.data as unknown as MqttStatus);
      }
      if (tail.success) {
        const data = tail.data as unknown as LogTail;
        setLogs(data.lines ?? []);
      }
    }
    void tick();
    const t = setInterval(() => {
      void tick();
    }, TAIL_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [admin]);

  async function run(
    op: string,
    fn: () => Promise<{ success: boolean; error?: { code: string; message: string } }>,
    successMessage: string,
  ): Promise<void> {
    setAction({ kind: 'pending', op });
    try {
      const res = await fn();
      if (res.success) {
        setAction({ kind: 'success', op, message: successMessage });
      } else {
        setAction({
          kind: 'error',
          op,
          message: res.error?.message ?? 'unknown',
          code: res.error?.code,
        });
      }
    } catch (e: unknown) {
      setAction({ kind: 'error', op, message: String(e) });
    }
  }

  return (
    <>
      <section className="card">
        <h2>MQTT</h2>
        {status === null ? (
          <p>checking…</p>
        ) : (
          <div className="row">
            <div>
              <span className="row-label">Connection</span>
              <div className="row-meta">
                {status.connected ? (
                  <span className="badge badge-ok">connected</span>
                ) : (
                  <span className="badge badge-err">disconnected</span>
                )}
                {status.lastMessageAt ? <> · last message {status.lastMessageAt}</> : null}
              </div>
            </div>
            <button
              type="button"
              className="btn"
              disabled={action.kind === 'pending' && action.op === 'restart_mqtt'}
              onClick={() => {
                void run('restart_mqtt', () => admin.restartMqtt(), 'MQTT reconnect issued.');
              }}
            >
              {action.kind === 'pending' && action.op === 'restart_mqtt' ? '…' : 'Restart MQTT'}
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Maintenance</h2>
        <div className="row">
          <div>
            <span className="row-label">Clear cache</span>
            <div className="row-meta">Drops transient app cache; non-destructive.</div>
          </div>
          <button
            type="button"
            className="btn"
            disabled={action.kind === 'pending' && action.op === 'clear_cache'}
            onClick={() => {
              void run('clear_cache', () => admin.clearCache(), 'Cache cleared.');
            }}
          >
            {action.kind === 'pending' && action.op === 'clear_cache' ? '…' : 'Clear'}
          </button>
        </div>
        <div className="row">
          <div>
            <span className="row-label">Reboot</span>
            <div className="row-meta">
              Cold-reboot the head-unit.{' '}
              <span className="badge badge-warn">step-up auth required</span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-stepup"
            disabled={action.kind === 'pending' && action.op === 'reboot'}
            onClick={() => {
              setConfirmReboot(true);
            }}
          >
            Reboot…
          </button>
        </div>

        {confirmReboot && (
          <div className="card" style={{ marginTop: 12 }}>
            <h2>Confirm reboot</h2>
            <p className="subtitle">
              The host will prompt for fresh authentication before executing.
            </p>
            <div className="row" style={{ borderBottom: 'none' }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setConfirmReboot(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  setConfirmReboot(false);
                  void run('reboot', () => admin.reboot(), 'Reboot scheduled.');
                }}
              >
                Reboot now
              </button>
            </div>
          </div>
        )}

        {action.kind === 'error' && (
          <div className="error-msg" style={{ marginTop: 12 }}>
            {action.code ? `[${action.code}] ` : ''}
            {action.op}: {action.message}
          </div>
        )}
        {action.kind === 'success' && (
          <p className="subtitle" style={{ marginTop: 12 }}>
            ✓ {action.message}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Live log tail</h2>
        <p className="subtitle">
          Last 50 lines, refreshed every {TAIL_REFRESH_MS / 1000}s. Local read — no backend
          round-trip.
        </p>
        <pre className="log">{logs.length === 0 ? '(no entries yet)' : logs.join('\n')}</pre>
      </section>
    </>
  );
}
