/// Mini-app-facing controller for the host's `cursor` family.
///
/// `attach` opens a session; subsequent `move` calls reuse it so a
/// 60 Hz drag doesn't burn the cap store.
///
/// The cursor view is on the IVI as a touchpad-style indicator. The
/// `targetDisplayId` is metadata the host stamps so the mini-app can
/// compute the cluster-coordinate translation; the cursor itself
/// never renders on the cluster (XDJA signature-gates that — Phase A
/// hardware verification, see PHASE_B_PLAN.md).
///
/// Typical usage — capture touch on the IVI and translate to cluster
/// coords:
///
///     const handle = await client.cursor.attach({
///       targetDisplayId: 4,
///       style: 'glow',
///     });
///     iviCanvas.addEventListener('pointermove', (e) => {
///       handle.move(e.clientX, e.clientY);
///     });
///     iviCanvas.addEventListener('pointerup', async (e) => {
///       const clusterX = e.clientX * (1920 / iviCanvas.clientWidth);
///       const clusterY = e.clientY * (720  / iviCanvas.clientHeight);
///       await client.gesture.tap({
///         displayId: 4, x: clusterX, y: clusterY,
///       });
///     });
///     // ...
///     await handle.detach();

import type { Bridge } from './bridge.js';
import { BaseFamilyController, type InvokeFamilyOptions } from './family-controller.js';

export type CursorStyle = 'dot' | 'glow' | 'ring';

export interface CursorAttachOptions {
  /** Display the eventual gesture.dispatch should land on. Metadata
   *  only — the cursor view itself is on the IVI. */
  targetDisplayId: number;
  style?: CursorStyle;
}

/// Handle returned by [CursorController.attach]. Calling [move]
/// after [detach] is a no-op (the host returns `ok: true` to the
/// underlying call but nothing is drawn).
export interface CursorHandle {
  /** Hot-path 60 Hz drag — coords are CSS pixels relative to the
   *  IVI display's top-left. */
  move(x: number, y: number): Promise<void>;
  setStyle(style: CursorStyle): Promise<void>;
  detach(): Promise<void>;
}

export class CursorController extends BaseFamilyController {
  constructor(bridge: Bridge) {
    super(bridge, 'cursor');
  }

  /**
   * Mount the cursor view on the IVI. Returns a [CursorHandle] for
   * subsequent move / style / detach calls.
   *
   * Throws `FamilyOpError` (code `attach_denied`) if the host
   * couldn't add the overlay window — typically because the
   * SYSTEM_ALERT_WINDOW grant hasn't propagated yet (cold pair
   * window). Retry after the user enables wireless debugging.
   */
  async attach(
    opts: CursorAttachOptions,
    invokeOpts: InvokeFamilyOptions = {},
  ): Promise<CursorHandle> {
    const result = await this.invoke<{ ok: boolean }>(
      'attach',
      {
        targetDisplayId: opts.targetDisplayId,
        style: opts.style ?? 'dot',
      },
      invokeOpts,
    );
    if (!result.ok) {
      throw new Error('cursor.attach refused by host — SYSTEM_ALERT_WINDOW likely not granted yet');
    }
    let detached = false;
    return {
      move: async (x: number, y: number) => {
        if (detached) return;
        await this.invoke<{ ok: boolean }>('move', {
          x: Math.round(x),
          y: Math.round(y),
        });
      },
      setStyle: async (style: CursorStyle) => {
        if (detached) return;
        await this.invoke<{ ok: boolean }>('style', { style });
      },
      detach: async () => {
        if (detached) return;
        detached = true;
        await this.invoke<{ ok: boolean }>('detach', {});
      },
    };
  }
}
