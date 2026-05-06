# pkg-launcher

Reference mini-app for the host's `pkg` family. Lists every
installed launchable app and lets you:

- **Tap a card** → launches on the screen this card was last sent
  to. Cards show a small badge (`H` / `P` / `D`) telling you where
  tap will land. First-time tap on a card opens the picker because
  there's no saved target yet.
- **Long-press a card (≈ 0.5 s)** → opens the screen-picker modal
  with three SVG cards (**Head Unit / Passenger / Driver**) so you
  can override / change target.
- **Recently used strip** (top of the grid, hidden until first
  launch) → MRU list of the last eight apps you launched. One tap
  to relaunch, long-press for the picker. Persists across reloads.
- **Search** — `/` focuses, `Esc` clears, `×` button clears.
- **Clear driver screen** (bottom-left) → `pkg.stop` whatever the
  mini-app last put on the cluster, so XDJA's normal projection
  (Huawei dashboard / amap) reclaims the surface. The button shows
  the live count and disables when nothing's there. Cards currently
  on the cluster pulse a green dot so you can see what Clear will
  take down before pressing it.
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

Cluster + passenger surfaces are gated client-side from
`display.list().vehicle.capabilities` so the catalog tile stays
launchable on every car. See [Adapts per trim](#adapts-per-trim)
below for the per-trim matrix.

## Adapts per trim

The mini-app reads the active car's capability bits from the
`vehicle` block of `display.list` (host 1.7+ ships `capabilities`,
`capabilityBits`, `friendlyName`, `isFallback`) and dims cards that
won't work on this car _before_ the user taps:

| Trim                  | Head Unit |          Passenger          |     Driver (cluster)      |
| --------------------- | :-------: | :-------------------------: | :-----------------------: |
| **L8 / L5L**          |     ✓     | ✓ (`pkg.launch.passenger`)  |   ✓ (`…cluster.pixel`)    |
| **L5 / L5U** (Di5.0)  |     ✓     |  ✓ (`pkg.launch.dishare`)   | dimmed — no pixel control |
| **L7 / HAN L**        |     ✓     | ✓ (`pkg.launch.passenger`)  |  dimmed — vendor-locked   |
| **Generic / unknown** |     ✓     | dimmed — no passenger panel |          dimmed           |

Tooltip on a dimmed card names the exact missing cap (e.g.
_Cluster pixel rendering not supported on Leopard 5 (need
pkg.launch.cluster.pixel)_) so triage doesn't have to guess.

When the host's vehicle-profile resolver fell back to a sub-trim /
trim / DiLink-default aggregate (`isFallback === true`), the trim
chip shows a `· best-effort` badge and enabled cards get a soft
"capability list is an aggregate" tooltip. Cards still launch — the
warning is informational. See the [trim × capability matrix](https://i99dash.app/docs/reference/trim-capability-matrix)
for the full seed and the [required-capabilities recipe](https://i99dash.app/docs/recipes/required-capabilities)
for the gating pattern.

Pre-1.7 hosts that don't ship `vehicle.capabilities` fall back to
the legacy `clusterAvailable` per-display flag — the launcher
remains functional while the device updates.

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
