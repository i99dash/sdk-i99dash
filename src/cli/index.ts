/// CLI library — per-command runners + utilities, no auto-run.
///
/// The bin entry (`src/cli.ts` → `dist/cli.js`) wires these up to
/// Commander and parses argv. Importing from `i99dash/cli` is safe:
/// you get the runner functions without triggering the parser.
///
/// Programmatic use (e.g. tests, custom orchestration):
///
///     import { runDev, runValidate } from 'i99dash/cli';
///     await runValidate({ cwd: process.cwd() });

export { runBuild } from './commands/build.js';
export { makeBetaCommand } from './commands/beta.js';
export { makeKeysCommand } from './commands/keys.js';
export { runDev } from './commands/dev.js';
export { runDoctor } from './commands/doctor.js';
export { runInit, TEMPLATES, type TemplateName } from './commands/init.js';
export { runLogin } from './commands/login.js';
export { runLogout } from './commands/logout.js';
export { runPublish } from './commands/publish.js';
export { runStatus } from './commands/status.js';
export { runUpgrade } from './commands/upgrade.js';
export { runValidate } from './commands/validate.js';
export { runWhoami } from './commands/whoami.js';

// Theme-marketplace commands (mirror the mini-app init/build/validate/
// publish quartet). Surfaced under the `theme` command group in cli.ts.
export { runThemeInit } from './commands/theme-init.js';
export { runThemeBuild, themeBundleName } from './commands/theme-build.js';
export { runThemeValidate, ThemeValidationFailedError } from './commands/theme-validate.js';
export { runThemePublish } from './commands/theme-publish.js';

// Native-APK app-store commands (mirror the theme quartet + promote/status).
// Surfaced under the `apk` command group in cli.ts.
export { runApkInit } from './commands/apk-init.js';
export { runApkBuild } from './commands/apk-build.js';
export { runApkValidate, ApkValidationFailedError } from './commands/apk-validate.js';
export { runApkPublish } from './commands/apk-publish.js';
export { runApkPromote } from './commands/apk-promote.js';
export { runApkStatus } from './commands/apk-status.js';

export * from './util/errors.js';
