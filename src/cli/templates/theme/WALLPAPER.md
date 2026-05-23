# Wallpapers (optional)

A theme can paint a full-bleed background behind the home and cluster
surfaces. Drop image files in this `wallpaper/` directory and reference
them from `theme.json` under `spec.wallpaper`:

```jsonc
"spec": {
  "wallpaper": {
    "home":     "./wallpaper/home.png",      // behind the home surface
    "homeDark": "./wallpaper/home-dark.png", // optional dark variant
    "cluster":  "./wallpaper/cluster.png"    // behind the cluster surface
  }
}
```

Rules (enforced by `i99dash theme validate`):

- Relative path starting with `./`, no `..` traversal.
- PNG / JPEG / WebP / SVG.
- ≤ 2 MB each, ≤ 2560×1440.

Omit the whole `wallpaper` block to paint the solid surface colors only
(the default — no wallpaper). Delete this file once you've added your
own; it is documentation, not part of the published bundle.
