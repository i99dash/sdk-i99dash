# cluster-hello-world

Smallest mini-app that exercises the `display.read` + `surface.write`
families end-to-end against a real i99dash host on a Leopard 8 head
unit.

## What it proves

- The host's bridge family registry routes `display.list` to the Dart
  `DisplayFamily` and back to the WebView.
- `surface.create({displayId})` opens a sandboxed `WebView` on a
  non-default display via `Presentation` (preferred) or
  `TYPE_APPLICATION_OVERLAY` (fallback when XDJA-owned virtual
  displays deny `Presentation.show()`).
- The audit chain captures both calls with the chosen path.

## What it does NOT prove (this slice)

- No host bridge inside the secondary `WebView`. The cluster page
  ships as a self-contained HTML asset with a local clock; it can't
  read car state or call `client.callApi`. Phase B adds that.
- `display.subscribe` events fire (the bridge is wired host-side but
  the IVI mini-app code in `index.html` doesn't subscribe yet — drop
  it into the example once you want to see hot-plug events flowing).

## Files

| Path            | Role                                                               |
| --------------- | ------------------------------------------------------------------ |
| `manifest.json` | Catalog row. minHostVersion `1.1.0`.                               |
| `index.html`    | IVI side. Lists displays, opens / closes a surface on the cluster. |
| `cluster.html`  | Cluster side. Static "Hello from the cluster" + a live clock.      |

## Running it

1. Sideload the host with `feat/finish-phase-a-end-to-end` merged.
2. Pair on the head unit; let `AdbBootstrap` complete (one-time grant
   set; check `adb logcat | grep AdbBootstrap`).
3. Bundle this directory into a `.tar.gz` and publish via
   `i99dash publish --track beta` (or sideload via
   `installedMiniAppStore` for development).
4. Open the mini-app on the IVI. The `bridge: ok` and
   `cluster: id=N (fission_bg_…)` pills should turn green; tap
   **Open on cluster** and the cluster screen lights up with the
   clock.

## Verification queries

```bash
# Confirm the cluster display IDs.
adb shell cmd display get-displays | grep -E "fission_bg|XDJA"

# Audit row for the surface.create call.
adb shell sqlite3 \
  /data/data/com.i99dev.i99dash/databases/admin.db \
  'SELECT op, success, json_extract(payload, "$.path") AS path
     FROM audit_chain
    WHERE op LIKE "surface.%"
    ORDER BY id DESC LIMIT 5'

# Pull a screenshot of the cluster output.
adb shell screencap -p -d 4 /sdcard/cluster.png && adb pull /sdcard/cluster.png
```
