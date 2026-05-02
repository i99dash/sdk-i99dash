# pkg-launcher

Phase C reference mini-app. Lists every installed launchable app on the head unit and lets you:

- Pick a target display (Head Unit / Passenger / Cluster · overlay).
- Tap **▶** to launch any package on the chosen display.
- Tap **★** to pin a package as a cold-start boot launch.

## What it demonstrates

| Family            | Op                            | Cadence             |
| ----------------- | ----------------------------- | ------------------- |
| `display.read`    | `display.list`                | one-shot at boot    |
| `pkg.read`        | `pkg.list({includeSystem})`   | one-shot at boot    |
| `pkg.launch`      | `pkg.launch({packageName,…})` | per ▶ tap           |
| `boot.write`      | `boot.list`                   | one-shot at boot    |
| `boot.write`      | `boot.set` / `boot.unset`     | per ★ tap           |

Permissions declared in `manifest.json`:

```json
"requiredPermissions": ["display.read", "pkg.read", "pkg.launch", "boot.write"]
```

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
3. Pick a display chip — Head Unit is selected by default; Cluster · overlay routes the launch through `am start --display 5`.
4. Tap **▶** next to any app to launch it on the selected display.
5. Tap **★** to flag an app as boot-launch (persists across reboots in the host's admin DB).

## Caveats

- **Boot-launch is declarative today.** The cold-start trigger (`BootHook.launchBootApps()` reading from `BootStore.listAllFor(...)`) is a follow-up slice. Setting **★** writes the row; the host doesn't yet replay those rows on boot. That hook lands next.
- **System apps are filtered out** by default (`includeSystem: false`). The query is `PackageManager.queryIntentActivities` over `CATEGORY_LAUNCHER`, which already excludes services / providers; the system filter is cosmetic on top.
- **Cluster slot launches require the host's a11y bridge** to dispatch `am start --display N` — already wired by `AdbBootstrap` v5; if a11y panel got toggled off the launch falls back to `denied` with `error="not granted"`.
