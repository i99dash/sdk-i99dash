# i99dash

Developer SDK + CLI for [i99dash](https://i99dash.app) mini-apps. One install, one import path, one binary.

```bash
pnpm add i99dash      # runtime client + admin client
pnpm dlx i99dash init my-app   # scaffold a new mini-app
```

```ts
import { MiniAppClient, AdminClient } from 'i99dash';

const client = MiniAppClient.fromWindow();
const ctx = await client.getContext();
console.log(ctx.locale);
```

## What's in the box

| Surface                                                                                | Where                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Runtime client (car status, media, climate, navigation, …)                             | `import { MiniAppClient } from 'i99dash'`                |
| Privileged admin client (`pm.disable_user`, `diag.tail_logs`, …)                       | `import { AdminClient } from 'i99dash'`                  |
| Wire-shape zod schemas + types                                                         | `import { MiniAppManifestSchema } from 'i99dash'`        |
| React bindings (`<MiniAppProvider>`, `useCarStatus`, …)                                | `import { MiniAppProvider } from 'i99dash/react'`        |
| Local dev-server (mock host + bridge shim + fixture watcher)                           | `import { startDevServer } from 'i99dash/dev-server'`    |
| CLI (`init`, `login`, `keys`, `dev`, `validate`, `build`, `publish`, `doctor`, `beta`) | `i99dash <command>` after install, or `pnpm dlx i99dash` |

The runtime client makes **zero network calls on its own** — it only proxies what your code requests through `callApi`. The CLI phones home for SSH-key login (challenge/verify) and publish uploads. No telemetry.

## Quickstart

```bash
pnpm dlx i99dash init my-app
cd my-app
pnpm install
pnpm dev
```

`i99dash dev` boots a local mock host at `http://127.0.0.1:5173` with a control panel for driving / VIN / locale / theme toggles.

Full developer docs: [docs.i99dash.app](https://docs.i99dash.app/docs/getting-started).

## Migrating from the old packages

The old packages — `@i99dash/sdk-types`, `@i99dash/sdk`, `@i99dash/admin-sdk`, `@i99dash/sdk-cli`, `@i99dash/sdk-react`, `@i99dash/sdk-dev-server` — are deprecated. Everything they exported now lives in `i99dash` (the React bindings under `i99dash/react`, the dev-server under `i99dash/dev-server`). See [MIGRATING.md](./MIGRATING.md) for the sed snippets.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

## License

MIT — see [LICENSE](./LICENSE).
