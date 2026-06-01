/// Bin entry — `dist/cli.js`. Wires the per-command runners up to
/// Commander and parses argv. Picked up by tsup as the second entry
/// point so the dist layout has a flat `dist/cli.js` next to
/// `dist/index.js`. The `bin` field in package.json points at this
/// file; the `i99dash/cli` subpath export points here too so library
/// consumers can run the CLI programmatically (`node -e
/// 'import("i99dash/cli")'`) without spawning a child process.
///
/// The auto-`main()` call at the end runs unconditionally — any
/// import of this module triggers it. That matches the historical
/// `bin: i99dash` behaviour: the file IS the binary; importing it
/// equals invoking it. Library consumers who only want the runner
/// functions import from `i99dash/cli` (which resolves to
/// `dist/cli.js` per the package.json `exports` map) — same file,
/// but in their case argv is whatever Node was invoked with, so
/// Commander handles it gracefully.
///
/// If a future use-case wants "import the runners without parsing
/// argv", we can split this into `cli.ts` (parser) + `cli/index.ts`
/// (already a library-only re-export). For now the auto-run shape
/// matches what the old `@i99dash/sdk-cli` shipped.

import { createRequire } from 'node:module';
import { Command } from 'commander';

import {
  CLIError,
  makeBetaCommand,
  runBuild,
  runDev,
  runDoctor,
  runInit,
  TEMPLATES,
  type TemplateName,
  UsageError,
  runLogin,
  runLogout,
  runPublish,
  runStatus,
  runUpgrade,
  runValidate,
  runWhoami,
  runThemeInit,
  runThemeBuild,
  runThemeValidate,
  runThemePublish,
} from './cli/index.js';
import { logger, setQuiet, setVerbose } from './cli/util/logger.js';
import { THEME_CATEGORY_SLUGS } from './types/index.js';

// Read version from the bundled package.json so `--version` stays in
// sync with the published tarball without manual bumps each release.
// `createRequire` works in both the CJS and ESM tsup outputs.
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

const program = new Command();

program
  .name('i99dash')
  .description('CLI for i99dash mini-app developers.')
  .version(pkg.version)
  .option('-v, --verbose', 'enable debug logging', false)
  .option('-q, --quiet', 'silence info logs (warnings + errors still print)', false)
  // `--backend-url` is a discoverable alias for the I99DASH_BACKEND_URL
  // env var. Setting it sets the env var for the rest of the process so
  // every command that reads `resolvedBackendUrl()` picks it up. Useful
  // for hitting staging or a self-hosted instance without exporting the
  // env globally.
  .option(
    '--backend-url <url>',
    'override the API base URL (default: https://api.i99dash.app, or $I99DASH_BACKEND_URL)',
  )
  .hook('preAction', (cmd) => {
    const opts = cmd.opts();
    if (opts['verbose']) setVerbose(true);
    if (opts['quiet']) setQuiet(true);
    if (opts['backendUrl']) {
      process.env['I99DASH_BACKEND_URL'] = opts['backendUrl'] as string;
    }
  });

program
  .command('init [dir]')
  .description('scaffold a new mini-app project')
  .option('-t, --template <name>', `project template (one of ${TEMPLATES.join(', ')})`, 'vanilla')
  .option('-f, --force', 'overwrite a non-empty target dir', false)
  .option('-y, --yes', 'accept defaults; skip the category prompt', false)
  .option('--category <slug>', 'pre-answer the category prompt (one of CATEGORY_SLUGS)')
  .action(
    async (
      dir: string | undefined,
      opts: { template: string; force: boolean; yes: boolean; category?: string },
    ) => {
      if (!TEMPLATES.includes(opts.template as TemplateName)) {
        throw new UsageError(`unknown template "${opts.template}". Valid: ${TEMPLATES.join(', ')}`);
      }
      await runInit({
        cwd: process.cwd(),
        dir: dir ?? 'my-mini-app',
        template: opts.template as TemplateName,
        force: opts.force,
        yes: opts.yes,
        ...(opts.category !== undefined ? { category: opts.category } : {}),
      });
    },
  );

program
  .command('login')
  .description('authenticate with your SSH key (signs a challenge; no password)')
  .option('--key <path>', 'SSH private key path (default ~/.ssh/id_ed25519)')
  .option('--passphrase <pass>', 'passphrase for an encrypted key')
  .option('--token <token>', 'paste a credential directly, skipping the SSH flow')
  .option('--ci', 'CI-only guard; prompts you to set I99DASH_API_KEY instead', false)
  .action(async (opts: { key?: string; passphrase?: string; token?: string; ci: boolean }) => {
    await runLogin({
      ci: opts.ci,
      key: opts.key,
      passphrase: opts.passphrase,
      token: opts.token,
    });
  });

program
  .command('logout')
  .description('remove the stored API key from your keychain')
  .option('--revoke', 'also revoke the API key on the server (default: just clear locally)', false)
  .action(async (opts: { revoke: boolean }) => {
    await runLogout({ revoke: opts.revoke });
  });

program
  .command('whoami')
  .description('show the currently logged-in developer')
  .action(async () => {
    await runWhoami();
  });

program
  .command('status [app_id]')
  .description('show your developer-lifecycle snapshot (apps + review status + active keys)')
  .action(async (appId: string | undefined) => {
    await runStatus({ appId });
  });

program
  .command('upgrade')
  .description('update the i99dash CLI to the latest published version')
  .option('--check', 'only check whether a newer version exists', false)
  .action(async (opts: { check?: boolean }) => {
    await runUpgrade({ currentVersion: pkg.version, checkOnly: opts.check ?? false });
  });

program
  .command('dev')
  .description('start the local dev-server with bridge shim + fixtures')
  .option('-p, --port <n>', 'port', (v) => parseInt(v, 10))
  .option('--host <h>', 'bind host (default 127.0.0.1; use 0.0.0.0 to expose on LAN)')
  .option('--no-open', "don't open the browser automatically")
  .action(async (opts: { port?: number; host?: string; open: boolean }) => {
    await runDev({
      cwd: process.cwd(),
      port: opts.port,
      host: opts.host,
      noOpen: !opts.open,
    });
  });

program
  .command('validate')
  .description('zod-validate manifest.json against the canonical schema')
  .action(async () => {
    await runValidate({ cwd: process.cwd() });
  });

program
  .command('doctor')
  .description('run preflight checks on the project (manifest, config, fixtures, dev-server)')
  .option(
    '--skip-dev-server',
    "don't probe the dev-server (CI-friendly when no `pnpm dev` is running)",
    false,
  )
  .action(async (opts: { skipDevServer: boolean }) => {
    await runDoctor({
      cwd: process.cwd(),
      skipDevServer: opts.skipDevServer,
    });
  });

program
  .command('build')
  .description('build a mini-app bundle into ./dist')
  .option('-o, --out <dir>', 'output directory (default: dist)')
  .action(async (opts: { out?: string }) => {
    await runBuild({ cwd: process.cwd(), out: opts.out });
  });

program
  .command('publish')
  .description('validate, build, upload, and register the mini-app with the catalog')
  .option('--bundle <dir>', 'pre-built bundle directory (skips build step)')
  .option('--dry-run', 'run validation + build + tarball; do not upload', false)
  .option(
    '--track <production|beta>',
    'release track (default: production). Use beta to publish to a limited tester group.',
    'production',
  )
  .option(
    '--release-notes <text>',
    'developer notes shown to beta testers (only valid with --track beta)',
  )
  .action(
    async (opts: { bundle?: string; dryRun: boolean; track: string; releaseNotes?: string }) => {
      const track = opts.track === 'beta' ? 'beta' : 'production';
      await runPublish({
        cwd: process.cwd(),
        bundle: opts.bundle,
        dryRun: opts.dryRun,
        track,
        releaseNotes: opts.releaseNotes,
      });
    },
  );

program.addCommand(makeBetaCommand());

// ── theme command group ───────────────────────────────────────────
// Mirrors the mini-app init/build/validate/publish quartet, grouped
// under `i99dash theme <sub>` so the top-level surface stays uncluttered
// and a theme author has a clear, separate entry point. The subcommand
// runners live in `src/cli/commands/theme-*.ts`.
const theme = program.command('theme').description('build and publish i99dash themes');

theme
  .command('init [dir]')
  .description('scaffold a new theme project (theme.json + icon + wallpaper note)')
  .option('-f, --force', 'overwrite a non-empty target dir', false)
  .option('-y, --yes', 'accept defaults; skip the category prompt', false)
  .option(
    '--category <slug>',
    `pre-answer the category (one of ${THEME_CATEGORY_SLUGS.join(', ')})`,
  )
  .action(
    async (dir: string | undefined, opts: { force: boolean; yes: boolean; category?: string }) => {
      await runThemeInit({
        cwd: process.cwd(),
        dir: dir ?? 'my-theme',
        force: opts.force,
        yes: opts.yes,
        ...(opts.category !== undefined ? { category: opts.category } : {}),
      });
    },
  );

theme
  .command('validate')
  .description('zod-validate theme.json + check declared assets')
  .action(async () => {
    await runThemeValidate({ cwd: process.cwd() });
  });

theme
  .command('build')
  .description('build a deterministic .i99theme bundle (tar.gz)')
  .option('-o, --out <dir>', 'output directory (default: dist)')
  .action(async (opts: { out?: string }) => {
    await runThemeBuild({ cwd: process.cwd(), out: opts.out });
  });

theme
  .command('publish')
  .description('validate, build, upload, and register the theme with the catalog')
  .option('--dry-run', 'run validation + build; do not upload', false)
  .action(async (opts: { dryRun: boolean }) => {
    await runThemePublish({ cwd: process.cwd(), dryRun: opts.dryRun });
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CLIError) {
      logger.error(err.message);
      process.exit(err.exitCode);
    }
    logger.error('unexpected error', err);
    process.exit(1);
  }
}

// Always run when invoked as CLI. ESM entrypoint check is brittle
// across Node/TSX/tsup, but for a bin script top-level invocation is
// the only use case.
void main();
