import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CATEGORY_SLUGS } from '../../types/index.js';
import { LocalIOError, UsageError } from '../util/errors.js';
import { logger } from '../util/logger.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/// Two layout fallbacks so the same code path works for `pnpm test`
/// (source under tsx, files at `src/cli/templates/...`) AND the
/// published tarball (`dist/cli.js`, files at `dist/cli/templates/...`
/// per tsup onSuccess).
function templateFile(...segments: string[]): string {
  const fromDist = resolve(HERE, 'cli', 'templates', ...segments);
  if (existsSync(fromDist)) return fromDist;
  // src/cli/commands/init.ts → ../templates/<...>
  return resolve(HERE, '..', 'templates', ...segments);
}

const PLACEHOLDER_ICON = templateFile('_shared', 'icon.svg');

export const TEMPLATES = ['vanilla', 'cluster-widget'] as const;
export type TemplateName = (typeof TEMPLATES)[number];

export interface InitOptions {
  cwd: string;
  dir: string;
  template: TemplateName;
  force: boolean;
  /// Skip prompts; accept defaults. Set by `--yes` or non-TTY environments.
  yes?: boolean;
  /// Pre-answer the category prompt. One of `CATEGORY_SLUGS`.
  category?: string;
}

/// Scaffolds a new mini-app project. Refuses to clobber a non-empty
/// directory unless `--force`. Writes just enough files to make
/// `i99dash dev` work end-to-end:
///   - `package.json` (scripts: dev, validate, build, publish)
///   - `manifest.json` (pre-filled id/version + chosen category)
///   - `sdk.config.json` (empty → schema defaults apply)
///   - `assets/icon.svg` (placeholder; user replaces with real artwork)
///   - `src/index.html` (Hello, mini-app)
///   - `mocks/fuel-stations.GET.json` (example fixture)
export async function runInit(opts: InitOptions): Promise<void> {
  const target = resolve(opts.cwd, opts.dir);
  if (!TEMPLATES.includes(opts.template)) {
    throw new UsageError(`unknown template "${opts.template}". Valid: ${TEMPLATES.join(', ')}`);
  }

  await ensureEmptyOrForced(target, opts.force);

  const category = opts.template === 'cluster-widget' ? 'developer' : await resolveCategory(opts);

  if (opts.template === 'cluster-widget') {
    await scaffoldClusterWidget(target, opts.dir);
  } else {
    await scaffoldVanilla(target, opts.dir, category);
  }

  logger.success(`scaffolded mini-app at ${target}`);
  logger.info('next steps:');
  logger.info(`  cd ${opts.dir}`);
  logger.info('  pnpm install');
  logger.info('  pnpm dev');
  logger.info('');
  if (opts.template === 'cluster-widget') {
    logger.info('cluster-widget renders the secondary surface from');
    logger.info('src/cluster.html on display.id from `client.display.list()`.');
    logger.info('Try in `i99dash dev` first — the dev-server fakes a 3-display rig.');
  } else {
    logger.info('your icon is a placeholder at assets/icon.svg — replace');
    logger.info('it with your real 256×256 PNG or SVG before publishing.');
  }
}

async function scaffoldVanilla(target: string, dirName: string, category: string): Promise<void> {
  await mkdir(resolve(target, 'src', 'assets'), { recursive: true });
  await mkdir(resolve(target, 'mocks'), { recursive: true });

  await writeFile(resolve(target, 'package.json'), packageJsonTemplate(dirName));
  await writeFile(resolve(target, 'manifest.json'), manifestJsonTemplate(dirName, category));
  await writeFile(resolve(target, 'sdk.config.json'), sdkConfigJsonTemplate());
  await writeFile(resolve(target, 'src', 'index.html'), htmlTemplate());
  await writeFile(resolve(target, 'mocks', 'fuel-stations.GET.json'), fuelStationsFixture());
  await writeFile(resolve(target, '.gitignore'), gitignoreTemplate());
  // Asset goes INSIDE the appRoot (src/) so the vanilla build copies it
  // to dist/, where it ends up at the CDN path the manifest declares.
  // The manifest's `icon` path is interpreted relative to dist root —
  // i.e. the same as appRoot for vanilla, framework-output dir otherwise.
  await copyFile(PLACEHOLDER_ICON, resolve(target, 'src', 'assets', 'icon.svg'));
}

/// cluster-widget template — opens a secondary surface on the
/// instrument cluster via `client.display.list()` + `client.surface.create()`.
/// Bundled HTML files come from `src/cli/templates/cluster-widget/`
/// (and `dist/cli/templates/cluster-widget/` after build).
async function scaffoldClusterWidget(target: string, dirName: string): Promise<void> {
  const id = dirName.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() || 'my-cluster-widget';
  await mkdir(resolve(target, 'src', 'assets'), { recursive: true });
  await mkdir(resolve(target, 'mocks'), { recursive: true });

  await writeFile(resolve(target, 'package.json'), packageJsonTemplate(dirName));
  await writeFile(resolve(target, 'manifest.json'), clusterWidgetManifestTemplate(id));
  await writeFile(resolve(target, 'sdk.config.json'), sdkConfigJsonTemplate());
  await writeFile(resolve(target, '.gitignore'), gitignoreTemplate());
  await copyFile(PLACEHOLDER_ICON, resolve(target, 'src', 'assets', 'icon.svg'));
  // Pull the real example HTML so the developer starts from
  // verified-on-Leopard-8 surface.create code, not a sketch.
  await copyTemplateDir(templateFile('cluster-widget', 'src'), resolve(target, 'src'));
}

async function copyTemplateDir(srcDir: string, dstDir: string): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      await mkdir(dstPath, { recursive: true });
      await copyTemplateDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      // Use readFile + writeFile (rather than copyFile) so the
      // bundle-time source files don't carry a Windows-specific
      // line-ending the user's editor would normalise back later.
      const body = await readFile(srcPath);
      await writeFile(dstPath, body);
    }
  }
}

/// Resolves the category for the new app. In TTY mode (and unless `--yes`
/// is passed), prompts the developer with the canonical enum so they
/// don't have to look up valid values. Falls back to `'other'` for
/// non-interactive runs — the dev can edit `manifest.json` afterwards.
async function resolveCategory(opts: InitOptions): Promise<string> {
  if (opts.category) {
    if (!CATEGORY_SLUGS.includes(opts.category)) {
      throw new UsageError(
        `unknown category "${opts.category}". Valid: ${CATEGORY_SLUGS.join(', ')}`,
      );
    }
    return opts.category;
  }
  const interactive = !opts.yes && stdin.isTTY === true && stdout.isTTY === true;
  if (!interactive) {
    return 'other';
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const list = CATEGORY_SLUGS.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
    stdout.write(`Pick a catalog category for your app:\n${list}\n`);
    const raw = (await rl.question(`category [other]: `)).trim();
    if (raw === '') return 'other';
    const asNum = Number.parseInt(raw, 10);
    if (Number.isFinite(asNum) && asNum >= 1 && asNum <= CATEGORY_SLUGS.length) {
      return CATEGORY_SLUGS[asNum - 1]!;
    }
    if (CATEGORY_SLUGS.includes(raw)) return raw;
    logger.warn(`"${raw}" is not a valid category — defaulting to "other"`);
    return 'other';
  } finally {
    rl.close();
  }
}

async function ensureEmptyOrForced(target: string, force: boolean): Promise<void> {
  try {
    const entries = await readdir(target);
    if (entries.length > 0 && !force) {
      throw new UsageError(
        `target ${target} is not empty — pass --force to overwrite, or pick a new dir`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(target, { recursive: true });
      return;
    }
    if (err instanceof UsageError) throw err;
    throw new LocalIOError(`failed to inspect ${target}`, err);
  }
}

function packageJsonTemplate(dirName: string): string {
  return `${JSON.stringify(
    {
      name: dirName.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'my-mini-app',
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'i99dash dev',
        validate: 'i99dash validate',
        build: 'i99dash build',
        publish: 'i99dash publish',
      },
      devDependencies: {
        i99dash: '^1.0.0',
      },
    },
    null,
    2,
  )}\n`;
}

function manifestJsonTemplate(dirName: string, category: string): string {
  const id = dirName.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() || 'my-mini-app';
  return `${JSON.stringify(
    {
      id,
      name: { en: 'My Mini App', ar: 'تطبيقي المصغّر' },
      description: {
        en: 'Starter mini-app generated by i99dash init.',
        ar: 'تطبيق مصغّر نموذجي أنشأه i99dash init.',
      },
      icon: './assets/icon.svg',
      url: 'https://miniapps.i99dash.app/' + id + '/',
      version: '0.1.0',
      minHostVersion: '0.0.2',
      category,
      safeWhileDriving: false,
    },
    null,
    2,
  )}\n`;
}

/// cluster-widget manifest. minHostVersion is set to 1.3.0 because
/// that's where the host's Phase A surface family ships.
function clusterWidgetManifestTemplate(id: string): string {
  return `${JSON.stringify(
    {
      id,
      name: { en: 'My Cluster Widget', ar: 'الحاجة الخاصة بي' },
      description: {
        en: 'Renders a custom widget on the instrument cluster via surface.create.',
        ar: 'يعرض عنصر واجهة مستخدم مخصصًا على عداد القيادة باستخدام surface.create.',
      },
      icon: './assets/icon.svg',
      url: 'https://miniapps.i99dash.app/' + id + '/',
      version: '0.1.0',
      minHostVersion: '1.3.0',
      category: 'developer',
      safeWhileDriving: false,
    },
    null,
    2,
  )}\n`;
}

function sdkConfigJsonTemplate(): string {
  return `${JSON.stringify(
    {
      appRoot: './src',
      distDir: './dist',
      mocksDir: './mocks',
      dev: {
        port: 5173,
        host: '127.0.0.1',
      },
    },
    null,
    2,
  )}\n`;
}

function htmlTemplate(): string {
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>My Mini App</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; }
    pre { background: #8881; padding: 12px; border-radius: 6px; }
  </style>
</head>
<body>
  <h1 id="hello">…</h1>
  <pre id="ctx">loading context…</pre>
  <h2>Fuel stations</h2>
  <pre id="fuel">loading…</pre>
  <script type="module">
    import { MiniAppClient } from 'https://esm.sh/i99dash';

    async function main() {
      const client = MiniAppClient.fromWindow();
      const ctx = await client.getContext();
      document.documentElement.lang = ctx.locale;
      document.documentElement.dir = ctx.locale === 'ar' ? 'rtl' : 'ltr';
      document.getElementById('hello').textContent =
        ctx.locale === 'ar' ? 'مرحباً' : 'Hello';
      document.getElementById('ctx').textContent = JSON.stringify(ctx, null, 2);

      const res = await client.callApi({
        path: '/api/v1/fuel-stations',
        method: 'GET',
        query: { car_id: ctx.activeCarId, radius_m: 5000 },
      });
      document.getElementById('fuel').textContent = JSON.stringify(res, null, 2);
    }
    main().catch((e) => {
      document.getElementById('ctx').textContent = String(e);
    });
  </script>
</body>
</html>
`;
}

function fuelStationsFixture(): string {
  return `${JSON.stringify(
    {
      match: { path: '/api/v1/fuel-stations', method: 'GET' },
      response: {
        success: true,
        data: {
          stations: [
            { name: 'Shell — Main Rd', price_sar: 2.33 },
            { name: 'ADNOC — Al Khalifa', price_sar: 2.29 },
          ],
        },
      },
    },
    null,
    2,
  )}\n`;
}

function gitignoreTemplate(): string {
  return 'node_modules/\ndist/\n.DS_Store\n';
}
