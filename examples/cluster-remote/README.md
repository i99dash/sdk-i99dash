# cluster-remote

Phase B reference mini-app — drives the instrument cluster (or any
non-default display) from the IVI as a touchpad. Captures touch on
the IVI, mirrors the position via `cursor.move`, and on release
fires `gesture.tap` on the chosen target display.

The realistic capability for non-system-signed apps on Leopard 8:
the XDJA composer signature-gates pixel delivery to the cluster
MCU, but `AccessibilityService.dispatchGesture(displayId)` is a
separate permission system that DOES work without signature
gating. Same mode i99dev ships in.

## What it demonstrates

| Family             | Op                  | Cadence                |
| ------------------ | ------------------- | ---------------------- |
| `display.read`     | `display.list`      | one-shot at load       |
| `cursor.write`     | `cursor.attach`     | once per drag          |
| `cursor.write`     | `cursor.move`       | 60 Hz, hot-path bypass |
| `cursor.write`     | `cursor.detach`     | once per drag          |
| `gesture.dispatch` | `gesture.tap`       | per release            |
| `gesture.dispatch` | `gesture.swipe`     | preset button          |
| `gesture.dispatch` | `gesture.longPress` | preset button          |

## How to run

1. Sideload the host with the Phase B accessibility services
   enabled (`RemoteControlAccessibilityService` +
   `WatchdogAccessibilityService`). `AdbBootstrap` v3 stamps
   `enabled_accessibility_services` over loopback ADB so the user
   doesn't have to click through BYD's a11y panel.
2. Pair the head unit; verify in `adb logcat`:
   - `AdbBootstrap: bootstrap v3 applied`
   - `RemoteCtrlA11y: onServiceConnected — instance now live`
3. `i99dash publish --track beta` (or sideload via
   `installedMiniAppStore` for development).
4. Open the mini-app on the IVI. Pick a target display from the
   dropdown (`id=2 fse` is the passenger screen on Leopard 8;
   `id=3/4/5` are the cluster slots). Drag in the touchpad area or
   tap a preset button.

## Verification

Watch logcat while interacting:

```bash
adb logcat -s InputPlatformPlugin RemoteCtrlA11y
```

You should see lines like:

```
I/RemoteCtrlA11y: onServiceConnected — instance now live
I/InputPlatformPlugin: tap displayId=2 (1024,512) → dispatched=true
```

If `dispatched=false` with `reason: accessibility_disabled`, the BYD
a11y panel may have toggled off our service since last boot. Reset
and re-pair, or open Settings → Accessibility manually and re-enable
"Remote control of cluster apps".

## Caveats

- Cluster pixels (e.g. drawing a custom HUD on the gauge face)
  are vendor-signature-gated on this firmware and not addressable
  without a system cert. This example does NOT try to render
  pixels on the cluster — only inject input into apps that are
  already running there (BYD's cluster theme, the nav layer, etc.).
- `gesture.dispatch` is tier-2 with truthful
  `requiresStepUp: true`; the host's `MiniAppGate.gateTier2`
  routes the step-up to install-time manifest consent on the
  family path, so per-action prompts are skipped during a drag.
- The screenshot in `screenshots[]` is a vector mock-up exercising
  the host's SVG branch — production bundles can use raster too.
