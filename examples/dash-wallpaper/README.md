# dash-wallpaper

Customize the look of every screen in the car. Pick from a curated
gallery, upload your own image or video, or design a live gradient —
apply to the head unit, passenger screen, and instrument cluster
all at once or one at a time.

## What it demonstrates

| Family          | Op                | Cadence              |
| --------------- | ----------------- | -------------------- |
| `display.read`  | `display.list`    | one-shot at boot     |
| `surface.write` | `surface.create`  | per Apply tap        |
| `surface.write` | `surface.destroy` | per Clear or replace |

The full set of techniques covered in
[`docs/guides/multi-display`](https://github.com/i99dash/doc-sdk-i99dash/blob/main/content/docs/guides/multi-display.mdx)
in one app:

- Display enumeration + per-display labels (Head Unit / Passenger /
  Cluster)
- BYD secondary cluster slot detection
  (`XDJAScreenProjection_1$` regex)
- File API → data URL → `surface.create` route param round-trip
- Replace-existing-surface-on-same-display semantics

## How to run

```bash
cd examples/dash-wallpaper
i99dash dev          # browser preview at http://localhost:5177
i99dash validate     # schema + asset check
i99dash publish      # to your --track
```

On the device:

1. Install the bundle (sideload via `i99dash publish` or the host's
   manage-mini-apps flow).
2. Open **Dash Wallpaper** from the IVI's Mini Apps Store.
3. Toggle which screens to override (chips at top — disabled IVI
   chip is the screen you're already on).
4. Pick a **Gallery** preset, **Upload** an image / video, or
   compose a **Gradient**.
5. Tap **Apply** — chosen content renders on every selected screen.
6. **Clear** removes all surfaces; closing the mini-app does the
   same automatically (host ref-counts).

## Cluster targeting

The chip labelled **Cluster · overlay** is BYD's secondary overlay
slot (`shared_fission_bg_XDJAScreenProjection_1`). It's the
recommended cluster target on FangChengBao 8 / Leopard 8 — content
holds without contention. The primary slot (`..._0`) is contested
by `com.example.amapservice`'s ADAS map; rendering there works but
the OEM map z-orders above unless the host runs its `am force-stop`
watchdog.

The dropdown sorts the friendly slot first.

## File-size limit

Uploads cap at 8 MB so the data-URL path stays under WebView URL
length limits. Larger media should be hosted off-device and the
mini-app updated to pass an `https://` `src` instead of a data URL.

## Caveats

- Wallpapers are **session-scoped** — they live as long as the
  mini-app is open. Closing the mini-app tears down all surfaces
  (host ref-counts). Persistent wallpapers across reboots need a
  host-side background service (Phase C).
- Video uploads work but data-URL encoding is heavy — the surface
  WebView re-decodes on every load. Keep clips short or use static
  images for best performance.
- The cluster face is signature-gated for full pixel control — see
  [the multi-display guide](https://github.com/i99dash/doc-sdk-i99dash/blob/main/content/docs/guides/multi-display.mdx#cluster-pixel-limits)
  for what's possible without a vendor cert.
