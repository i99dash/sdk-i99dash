# Next.js example — `i99dash`

A Next.js 15 app-router project that demonstrates the full SDK
end-to-end, runnable locally without any i99dash backend.

## What it shows

- `getContext` — pulls user / VIN / locale / theme from the host; flips
  the document direction to RTL for Arabic.
- `callApi` — reads a fuel-station list through the host bridge; the
  dev-server serves the fixture in `mocks/`.
- Driving-state banner — polls the dev-server's `/_sdk/state` so the
  driving toggle in `/_sdk/ui` flips the UI live, exercising the
  safety-gate copy path.

## Run it

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs `next build` (emits `./out/`) then `i99dash dev`
(serves `./out/` with the host-bridge shim attached). Open the URL
the dev-server prints; toggles live at `<url>/_sdk/ui`.

## Publish it

```bash
pnpm validate    # zod-check manifest.json
pnpm publish     # validate + build + upload + register (once backend is live)
```

## Layout

```
src/
├── app/
│   ├── layout.tsx            root; lang/dir updated client-side after ctx loads
│   ├── globals.css           light/dark theme tokens
│   └── page.tsx              server shell — mounts three client components
├── components/
│   ├── ContextCard.client.tsx
│   ├── DrivingBanner.client.tsx
│   └── StationList.client.tsx
└── lib/
    └── sdk.ts                memoised MiniAppClient.fromWindow()
mocks/
└── fuel-stations.GET.json    sample response for /api/v1/fuel-stations
manifest.json                 catalog row
sdk.config.json               dev-server config (initial context, port, fixture dir)
next.config.mjs               output: 'export'; trailing slash; unoptimized images
```

## Why static export

The i99dash host loads your bundle from a CDN, not a Next server.
`output: 'export'` emits `./out/` which the SDK tarballs and uploads.
Dynamic routes, middleware, and image optimisation all require a
server and are **unsupported** in mini-apps.

## Why client components

`MiniAppClient.fromWindow()` reads `window.__i99dashHost`. That global
doesn't exist during SSR, so any code that calls it must live in a
`'use client'` module inside a `useEffect` / `onMounted` hook.
