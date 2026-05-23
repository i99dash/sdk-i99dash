import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { THEME_CATEGORY_SLUGS } from '../../types/index.js';
import { LocalIOError, UsageError } from '../util/errors.js';
import { logger } from '../util/logger.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/// Two layout fallbacks so the same code path works for `pnpm test`
/// (source under tsx, files at `src/cli/templates/...`) AND the
/// published tarball (`dist/cli.js`, files at `dist/cli/templates/...`
/// per tsup onSuccess). Identical to the mini-app `init` resolver.
function templateFile(...segments: string[]): string {
  const fromDist = resolve(HERE, 'cli', 'templates', ...segments);
  if (existsSync(fromDist)) return fromDist;
  return resolve(HERE, '..', 'templates', ...segments);
}

const PLACEHOLDER_ICON = templateFile('_shared', 'icon.svg');
const WALLPAPER_NOTE = templateFile('theme', 'WALLPAPER.md');

export interface ThemeInitOptions {
  cwd: string;
  dir: string;
  force: boolean;
  /// Skip prompts; accept defaults. Set by `--yes` or non-TTY environments.
  yes?: boolean;
  /// Pre-answer the category prompt. One of [THEME_CATEGORY_SLUGS].
  category?: string;
}

/// Scaffolds a new theme project. Refuses to clobber a non-empty
/// directory unless `--force`. Writes just enough to make
/// `i99dash theme validate` / `theme build` work end-to-end:
///   - `package.json` (scripts: validate, build, publish)
///   - `theme.json` (the canonical dark starter spec + chosen category)
///   - `assets/icon.svg` (placeholder; replace with real 256×256 artwork)
///   - `wallpaper/WALLPAPER.md` (how to add optional wallpapers)
///   - `.gitignore`
export async function runThemeInit(opts: ThemeInitOptions): Promise<void> {
  const target = resolve(opts.cwd, opts.dir);
  await ensureEmptyOrForced(target, opts.force);

  const category = await resolveCategory(opts);

  await mkdir(resolve(target, 'assets'), { recursive: true });
  await mkdir(resolve(target, 'wallpaper'), { recursive: true });

  await writeFile(resolve(target, 'package.json'), packageJsonTemplate(opts.dir));
  await writeFile(resolve(target, 'theme.json'), themeJsonTemplate(opts.dir, category));
  await writeFile(resolve(target, '.gitignore'), gitignoreTemplate());
  await copyFile(PLACEHOLDER_ICON, resolve(target, 'assets', 'icon.svg'));
  // Pull the wallpaper note from the bundled template (readFile +
  // writeFile so the line endings match the user's editor, like the
  // mini-app cluster-widget copy).
  await writeFile(resolve(target, 'wallpaper', 'WALLPAPER.md'), await readFile(WALLPAPER_NOTE));

  logger.success(`scaffolded theme at ${target}`);
  logger.info('next steps:');
  logger.info(`  cd ${opts.dir}`);
  logger.info('  pnpm install');
  logger.info('  i99dash theme validate');
  logger.info('');
  logger.info('your icon is a placeholder at assets/icon.svg — replace it with');
  logger.info('your real 256×256 PNG or SVG, then edit theme.json colors before');
  logger.info('publishing. See wallpaper/WALLPAPER.md to add optional wallpapers.');
}

/// Resolves the catalog category for the new theme. TTY + not `--yes` →
/// prompt with the canonical enum; otherwise default to `'other'`.
async function resolveCategory(opts: ThemeInitOptions): Promise<string> {
  if (opts.category) {
    if (!THEME_CATEGORY_SLUGS.includes(opts.category)) {
      throw new UsageError(
        `unknown theme category "${opts.category}". Valid: ${THEME_CATEGORY_SLUGS.join(', ')}`,
      );
    }
    return opts.category;
  }
  const interactive = !opts.yes && stdin.isTTY === true && stdout.isTTY === true;
  if (!interactive) return 'other';

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const list = THEME_CATEGORY_SLUGS.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
    stdout.write(`Pick a catalog category for your theme:\n${list}\n`);
    const raw = (await rl.question(`category [other]: `)).trim();
    if (raw === '') return 'other';
    const asNum = Number.parseInt(raw, 10);
    if (Number.isFinite(asNum) && asNum >= 1 && asNum <= THEME_CATEGORY_SLUGS.length) {
      return THEME_CATEGORY_SLUGS[asNum - 1]!;
    }
    if (THEME_CATEGORY_SLUGS.includes(raw)) return raw;
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
      name: dirName.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'my-theme',
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        validate: 'i99dash theme validate',
        build: 'i99dash theme build',
        publish: 'i99dash theme publish',
      },
      devDependencies: {
        i99dash: '^5.0.0',
      },
    },
    null,
    2,
  )}\n`;
}

/// The canonical dark starter theme — the §2 contract example. The 8
/// surface keys + accent/secondary/error are present; warning/neutral
/// included so the dev sees every knob. `id` derives from the dir name.
function themeJsonTemplate(dirName: string, category: string): string {
  const id = dirName.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() || 'my-theme';
  return `${JSON.stringify(
    {
      id,
      name: { en: 'My Theme', ar: 'سِمتي' },
      description: {
        en: 'Starter theme generated by i99dash theme init.',
        ar: 'سِمة نموذجية أنشأها i99dash theme init.',
      },
      icon: './assets/icon.svg',
      version: '0.1.0',
      minHostVersion: '3.1.0',
      category,
      tags: ['minimal'],
      spec: {
        schema: 1,
        brightness: 'dark',
        colors: {
          background: '#07070D',
          surfaceLow: '#0F1018',
          surfaceContainer: '#13141C',
          surfaceHigh: '#1A1C26',
          outline: '#4B5064',
          outlineVariant: '#24262F',
          onSurface: '#F3F4F8',
          onSurfaceVariant: '#8A90A4',
          accent: '#22D3A8',
          secondary: '#5B8CFF',
          error: '#E76F51',
          warning: '#F4A261',
          neutral: '#6A7088',
        },
        shape: {
          cardRadius: 24,
          buttonRadius: 14,
          inputRadius: 14,
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
