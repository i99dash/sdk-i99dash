# Migrating from the old `@i99dash/*` packages

All six packages — `@i99dash/sdk-types`, `@i99dash/sdk`, `@i99dash/admin-sdk`, `@i99dash/sdk-cli`, `@i99dash/sdk-react`, `@i99dash/sdk-dev-server` — have been consolidated into a single `i99dash` package on public npm. The old packages are deprecated; new releases publish only the consolidated one.

The runtime client + admin client + types live at the root entry. The Node-only dev-server and the React bindings live behind subpaths (`i99dash/dev-server`, `i99dash/react`) so a browser bundle that only imports `MiniAppClient` doesn't pull in `fastify`, and a Node CLI doesn't pull in `react-dom`.

This guide shows the mechanical migration. Pre-release; no compat shim. After the swap your code looks identical except for the import paths.

## Step 1 — swap the dependencies

```diff
{
   "dependencies": {
-    "@i99dash/sdk-types": "^0.1.8",
-    "@i99dash/sdk": "^0.1.8",
-    "@i99dash/admin-sdk": "^0.1.0",
-    "@i99dash/sdk-react": "^0.1.0"
+    "i99dash": "^1.0.0"
   },
   "devDependencies": {
-    "@i99dash/sdk-cli": "^0.1.14",
-    "@i99dash/sdk-dev-server": "^0.1.10"
+    "i99dash": "^1.0.0"
   }
}
```

`i99dash` provides both the library exports AND the CLI binary, so it can sit in either dependency block. We recommend `dependencies` — the runtime client is what your app code actually imports.

## Step 2 — rewrite imports

```bash
# Run from your repo root.
grep -rl '@i99dash/\(sdk\|sdk-types\|admin-sdk\|sdk-react\|sdk-dev-server\)' src/ \
  | xargs sed -i '' \
      -e "s|@i99dash/sdk-types|i99dash|g" \
      -e "s|@i99dash/admin-sdk|i99dash|g" \
      -e "s|@i99dash/sdk-dev-server|i99dash/dev-server|g" \
      -e "s|@i99dash/sdk-react|i99dash/react|g" \
      -e "s|@i99dash/sdk|i99dash|g"
```

(Drop the `''` from `sed -i` on Linux.)

Order matters: longer names (`@i99dash/sdk-types`, `@i99dash/sdk-react`, `@i99dash/sdk-dev-server`, `@i99dash/admin-sdk`) all share a `@i99dash/sdk` prefix — substitute the longer names first so the prefix-only rule doesn't eat them.

## Step 3 — rename CLI invocations

```bash
# package.json scripts and any CI files.
grep -rl 'sdk-i99dash' . \
  | xargs sed -i '' "s|sdk-i99dash|i99dash|g"
```

The binary used to be `sdk-i99dash` (from the old `@i99dash/sdk-cli` package). It's now `i99dash`.

## Step 4 — drop the GitHub Packages auth

The old `@i99dash/admin-sdk` lived on a private GitHub Packages registry. If your `.npmrc` carried the auth solely for that:

```diff
-@i99dash:registry=https://npm.pkg.github.com
-//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

The new `i99dash` package is on public npm. The Flutter host's runtime block remains the only authority for privileged ops — reading the type definitions doesn't grant access to call them.

If you still install other private `@i99dash/*` packages that aren't on the deprecation list (rare), keep the lines and just don't expect them to gate `i99dash`.

## Step 5 — install + verify

```bash
pnpm install
pnpm exec i99dash --help    # should print the new banner
pnpm typecheck              # no broken imports
pnpm test                   # everything still green
```

## Symbol equivalence

Every public symbol the old four packages exported is reachable from `i99dash`. Concretely:

| Old import                                                   | New import                                            |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| `import { MiniAppClient } from '@i99dash/sdk'`               | `import { MiniAppClient } from 'i99dash'`             |
| `import { AdminClient } from '@i99dash/admin-sdk'`           | `import { AdminClient } from 'i99dash'`               |
| `import { MiniAppManifestSchema } from '@i99dash/sdk-types'` | `import { MiniAppManifestSchema } from 'i99dash'`     |
| `import { MiniAppProvider } from '@i99dash/sdk-react'`       | `import { MiniAppProvider } from 'i99dash/react'`     |
| `import { startDevServer } from '@i99dash/sdk-dev-server'`   | `import { startDevServer } from 'i99dash/dev-server'` |
| `sdk-i99dash login`                                          | `i99dash login`                                       |

The Node-only dev-server and the React bindings sit behind subpath exports (`i99dash/dev-server`, `i99dash/react`) so a browser bundle that only imports `MiniAppClient` from `i99dash` tree-shakes both away. Your `package.json` still lists `i99dash` once.

## Why?

Privileged developers were installing six packages to get the full toolchain: `@i99dash/sdk` + `@i99dash/admin-sdk` + `@i99dash/sdk-types` (transitive) + `@i99dash/sdk-cli` + `@i99dash/sdk-react` + `@i99dash/sdk-dev-server`. Each had its own version, its own `.npmrc` setup (admin-sdk on private), its own deprecation lifecycle. One package is simpler.

Tradeoff: install-time access gating that the private GitHub Packages registry provided for `@i99dash/admin-sdk` is gone. The host's runtime gate remains authoritative — reading admin type signatures doesn't grant the ability to call them.

## Help

If you hit something the sed snippets miss, file an issue on the new repo: <https://github.com/i99dash/i99dash-sdk>.
