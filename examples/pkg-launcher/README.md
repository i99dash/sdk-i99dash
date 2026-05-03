# pkg-launcher

Reference mini-app for the host's `pkg` family. Lists every
installed launchable app and lets you:

- Tap **▶** on any row → modal opens with three SVG cards
  (**Head Unit / Passenger / Driver**); pick the screen and the
  launch fires there.
- **Clear driver screen** (bottom-left) → `pkg.stop` whatever the
  mini-app last put on the cluster, so XDJA's normal projection
  (Huawei dashboard / amap) reclaims the surface.
- **Open touchpad** (bottom-right) → modal trackpad shaped to the
  cluster (1920:720 aspect). Drag = `cursor.move` on the cluster;
  release = `gesture.tap` at the corresponding cluster coordinates.
  The cluster screen behind the wheel isn't touch-enabled — the
  pad on the IVI is the way to interact with it.

## What it demonstrates

| Family               | Op                                            | Cadence                                     |
| -------------------- | --------------------------------------------- | ------------------------------------------- |
| `display.read`       | `display.list`                                | one-shot at boot, used to resolve role → id |
| `pkg.read`           | `pkg.list({includeSystem})`                   | one-shot at boot                            |
| `pkg.launch`         | `pkg.launch({packageName,…})`                 | per ▶ tap → IVI or Passenger card           |
| `pkg.launch.cluster` | `pkg.launch_cluster({packageName,displayId})` | per ▶ tap → Driver card                     |
| `pkg.launch`         | `pkg.stop({packageName})`                     | per **Clear driver screen** tap             |
| `cursor.write`       | `cursor.attach` / `cursor.move`               | once per touchpad session + ~60Hz on drag   |
| `gesture.dispatch`   | `gesture.tap({displayId,x,y})`                | per touchpad release                        |

The mini-app picks `pkg.launch` vs `pkg.launch_cluster` automatically
from the selected card's role; `display.list` returns `role` since
host 1.4.0 (older hosts fall back to the legacy `isCluster` flag).

Permissions declared in `manifest.json`:

```json
"requiredPermissions": [
  "display.read", "pkg.read",
  "pkg.launch", "pkg.launch.cluster",
  "cursor.write", "gesture.dispatch"
]
```

`pkg.launch.cluster` is a separate permission because the cluster
sits in the driver's eyeline; the host treats cluster targets as
vehicle-control adjacent and refuses any launch the manifest didn't
explicitly opt in to. The touchpad needs `cursor.write` for the
drag overlay on the cluster and `gesture.dispatch` to dispatch the
release tap.

## How to run

```bash
cd examples/pkg-launcher
i99dash dev          # browser preview at http://localhost:5178
i99dash validate     # schema + asset check
i99dash publish      # to your --track
```

On the device:

1. Install the bundle (sideload via `i99dash publish` or the host's manage-mini-apps flow).
2. Open **Pkg Launcher** from the IVI's Mini Apps Store.
3. Tap **▶** on an app row → pick **Head Unit / Passenger / Driver** in the modal. The mini-app routes to `pkg.launch` or `pkg.launch_cluster` automatically.
4. **Open touchpad** to remote-control the cluster: drag for cursor, release for tap.
5. **Clear driver screen** to take down whatever the launcher last put on the cluster, restoring the OEM dashboard.

## Caveats

- **System apps are filtered out** by default (`includeSystem: false`). The query is `PackageManager.queryIntentActivities` over `CATEGORY_LAUNCHER`, which already excludes services / providers.
- **Cluster slot launches require the host's a11y bridge** to dispatch `am start --display N` — already wired by `AdbBootstrap` v5; if a11y panel got toggled off the launch falls back to `denied` with `error="not granted"`.
- **Touchpad input only reaches a real Activity on the cluster.** The OEM-projected Huawei dashboard isn't an Android Activity (XDJA composites it from elsewhere) and won't receive tap events — the touchpad is meant for apps you launched onto the cluster yourself, not for controlling the OEM dashboard.
- **Clear driver screen** only stops what _this_ mini-app launched. It never force-stops foreign packages.
