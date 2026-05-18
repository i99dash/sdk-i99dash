import { spawn } from 'node:child_process';
import { cp, mkdir, copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import fg from 'fast-glob';
import { loadManifest, loadSdkConfig } from '../config/load.js';
import { formatIssue, validateAssets } from '../util/assets.js';
import { LocalIOError } from '../util/errors.js';
import { logger } from '../util/logger.js';
import { WEBVIEW_BASELINE, checkWebviewBaseline } from '../../types/index.js';

export class BuildAssetsMissingError extends LocalIOError {
  override name = 'BuildAssetsMissingError' as const;
}

/// Thrown when a shipped JS artifact would not run on the oldest
/// supported WebView (Di5.0 / Chromium 95) — see [checkWebviewBaseline]
/// ("Gate B"). Fail-closed: a mini-app that can't run on Di5.0 must
/// either stay within the baseline or explicitly declare itself
/// Di5.1-only via `requires.modernWebview` / `requires.dilink`.
export class WebviewBaselineError extends LocalIOError {
  override name = 'WebviewBaselineError' as const;
}

export interface BuildOptions {
  cwd: string;
  out?: string;
}

/// Build a mini-app bundle.
///
/// Two paths:
///   1. `sdk.config.json.buildCommand` set → run it (framework build).
///   2. Otherwise → copy `appRoot/` → `distDir/` unchanged (vanilla HTML).
///
/// Always copies `manifest.json` into `distDir` so the tarball is
/// self-describing on the server side.
export async function runBuild(opts: BuildOptions): Promise<string> {
  const cfg = await loadSdkConfig(opts.cwd);
  const distDir = resolve(opts.cwd, opts.out ?? cfg.distDir);

  if (cfg.buildCommand) {
    logger.info(`running build command: ${cfg.buildCommand}`);
    await runShell(cfg.buildCommand, opts.cwd);
  } else {
    const src = resolve(opts.cwd, cfg.appRoot);
    if (!existsSync(src)) {
      throw new LocalIOError(`appRoot does not exist: ${src}`);
    }
    await mkdir(distDir, { recursive: true });
    await cp(src, distDir, { recursive: true });
    logger.info(`copied ${src} → ${distDir}`);
  }

  // Always stamp manifest.json into dist so publish has a
  // canonical file to pick up.
  const manifestSrc = resolve(opts.cwd, 'manifest.json');
  const manifestDst = resolve(distDir, 'manifest.json');
  await copyFile(manifestSrc, manifestDst);

  // Authoritative asset check against the BUILD output. The manifest's
  // relative paths must resolve inside distDir — that's the tree the
  // publish tarball ships, and the only place the backend will look
  // when it re-extracts. A framework that didn't copy public/ correctly
  // surfaces here, with a clear error.
  const manifest = await loadManifest(opts.cwd);
  const issues = await validateAssets(manifest, { rootDir: distDir });
  if (issues.length > 0) {
    for (const i of issues) logger.error(formatIssue(i));
    throw new BuildAssetsMissingError(
      `manifest declares ${issues.length} asset(s) that aren't in dist — ` +
        `for framework projects, the file probably needs to live in your public/ folder ` +
        `(e.g. public/assets/icon.svg for a Next.js icon path of ./assets/icon.svg).`,
    );
  }

  // ── Gate B: Di5.0 / Chromium-95 WebView baseline ────────────────
  // Gate A (`requires.modernWebview` + evaluateCompatibility) only
  // HIDES a declared Di5.1-only app from Di5.0 cars. This statically
  // proves the shipped JS actually runs on the oldest WebView so an
  // author can't silently ship ES2023+/Chrome-96+ code that passes
  // Gate A and then crashes on a Di5.0 car. Fail-closed at build (and
  // therefore publish) unless the manifest explicitly opts out.
  await enforceWebviewBaseline(distDir, manifest.requires);

  logger.success(`build complete → ${distDir}`);
  return distDir;
}

/// Glob the build output for every shipped JS artifact, run the
/// single-source [checkWebviewBaseline], and hard-fail unless the
/// manifest explicitly declared itself Di5.1-only (the `exempt`
/// escape hatch — Gate A already hides it on Di5.0, so we downgrade
/// to an info note instead of contradicting that).
async function enforceWebviewBaseline(
  distDir: string,
  requires: Parameters<typeof checkWebviewBaseline>[1],
): Promise<void> {
  const jsPaths = await fg(['**/*.{js,mjs,cjs}', '!**/*.map'], {
    cwd: distDir,
    absolute: true,
    dot: false,
  });
  if (jsPaths.length === 0) return;

  const files = await Promise.all(
    jsPaths.map(async (abs) => ({
      path: relative(distDir, abs).split('\\').join('/'),
      code: await readFile(abs, 'utf8'),
    })),
  );

  const result = checkWebviewBaseline(files, requires);
  if (result.ok) {
    logger.success(
      `WebView baseline ok — ${files.length} JS file(s) run on ` +
        `Chromium ${WEBVIEW_BASELINE.chromium} (Di5.0 + Di5.1)`,
    );
    return;
  }

  const lines = result.violations.map(
    (v) => `  ${v.file}${v.line ? `:${v.line}` : ''} — [${v.kind}] ${v.detail}`,
  );

  if (result.exempt) {
    logger.info(
      `WebView baseline: ${result.violations.length} issue(s), but the ` +
        `manifest declares this app Di5.1-only (requires.modernWebview / ` +
        `requires.dilink) so Gate A hides it on Di5.0 — not blocking:\n` +
        lines.join('\n'),
    );
    return;
  }

  for (const l of lines) logger.error(l);
  throw new WebviewBaselineError(
    `${result.violations.length} WebView-baseline violation(s): the ` +
      `shipped JS will not run on Di5.0 (Chromium ` +
      `${WEBVIEW_BASELINE.chromium}). Fix the above, or — if this app ` +
      `is intentionally Di5.1-only — declare it in manifest.json ` +
      `\`requires\` (modernWebview: true, or dilink: ["di5.1"]).`,
  );
}

function runShell(command: string, cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // `shell: true` runs the command through the system shell — matches
    // how npm-run scripts invoke it. Stdout/stderr stream through so
    // the dev sees real build output.
    const child = spawn(command, { shell: true, cwd, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new LocalIOError(`build command exited with ${code ?? 'null'}`));
    });
    child.on('error', (err) => reject(new LocalIOError('build command failed to spawn', err)));
  });
}
