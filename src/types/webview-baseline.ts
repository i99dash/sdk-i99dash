import { Parser } from 'acorn';

import type { DilinkFamily } from './vehicle-capabilities.js';
import type { MiniAppRequires } from './manifest.js';

/// The single source of truth for "will this mini-app's shipped JS
/// actually run on the oldest WebView we support?" — i.e. **Gate B**.
///
/// Gate A (`evaluateCompatibility` / `requires.modernWebview`) is a
/// *declaration*: the catalog/host HIDE a Di5.1-only app from Di5.0
/// cars. Gate B is the *static proof*: an author who simply forgets
/// to declare `modernWebview` and ships ES2023+/Chrome-96+ code would
/// pass Gate A and then crash on a Di5.0 car. This closes that hole.
///
/// Every consumer (the `i99dash` CLI build/publish gate, docs, and
/// any host/backend port) reads THESE constants so the floor can
/// never drift between layers — same posture as `evaluateCompatibility`.
///
/// ## Why ES2022 and not ES2019
///
/// Di5.0 (Leopard 5 / Song PLUS) ships `com.android.webview`
/// `95.0.4638.74` = **Chromium 95** (V8 9.5). Chromium 95 already
/// runs all ES2022 *syntax* — optional chaining / `??` (Chrome 80),
/// logical assignment (85), private methods (84), `.at()` (92),
/// `Object.hasOwn` / error `cause` (93), class static blocks (94),
/// top-level await (89). Parsing at ES2019 would therefore *wrongly
/// reject valid Di5.0 code* (`a?.b`, `x ?? y`). The real Di5.0 gaps
/// are: (1) **ES-module loading** in the mini-app WebView host
/// (classic/IIFE only), and (2) **runtime APIs added in Chrome 96+**
/// (`structuredClone` 98, `Array.findLast` 97, …) — valid syntax the
/// parser can't catch. So the accurate gate = ES2022 syntax ceiling +
/// classic-format + an API denylist. [ecmaVersion] is the one knob:
/// lower it if a future floor demands stricter syntax.
export const WEBVIEW_BASELINE = {
  /// ECMAScript syntax ceiling Chromium 95 fully parses. Anything
  /// that ONLY parses at a higher `ecmaVersion` is rejected.
  ecmaVersion: 2022 as const,
  /// The Chromium milestone that ceiling maps to (Di5.0 WebView).
  chromium: 95 as const,
  /// Globals / prototype methods that PARSE fine on Chromium 95 but
  /// are ABSENT at runtime (added Chrome 96+). A parser cannot catch
  /// these — they are valid syntax — so they are statically denied.
  /// Conservative by design (fail-closed): a match fails the gate.
  deniedApis: [
    { pattern: /\bstructuredClone\s*\(/, api: 'structuredClone()', since: 98 },
    { pattern: /\.\s*findLast\s*\(/, api: 'Array.prototype.findLast()', since: 97 },
    {
      pattern: /\.\s*findLastIndex\s*\(/,
      api: 'Array.prototype.findLastIndex()',
      since: 97,
    },
    { pattern: /\bObject\s*\.\s*groupBy\s*\(/, api: 'Object.groupBy()', since: 117 },
    { pattern: /\bMap\s*\.\s*groupBy\s*\(/, api: 'Map.groupBy()', since: 117 },
    {
      pattern: /\bPromise\s*\.\s*withResolvers\s*\(/,
      api: 'Promise.withResolvers()',
      since: 119,
    },
    { pattern: /\bArray\s*\.\s*fromAsync\s*\(/, api: 'Array.fromAsync()', since: 121 },
  ],
} as const;

export type WebviewBaselineViolationKind = 'syntax' | 'esm' | 'denied-api';

export interface WebviewBaselineViolation {
  /// Path of the offending shipped JS file (caller-relative).
  file: string;
  kind: WebviewBaselineViolationKind;
  /// Human-readable reason, already formatted for CLI output.
  detail: string;
  /// 1-based line when known (syntax / denied-api).
  line?: number;
}

export interface WebviewBaselineResult {
  /// True when there are zero violations.
  ok: boolean;
  /// True when the manifest EXPLICITLY opts out of Di5.0
  /// (`requires.modernWebview === true`, or a `requires.dilink`
  /// allow-list that excludes `di5.0`). Gate A already hides such an
  /// app on Di5.0, so callers should DOWNGRADE violations to an info
  /// note instead of failing — keeping Gate A and Gate B one
  /// coherent policy rather than two contradictory ones.
  exempt: boolean;
  violations: WebviewBaselineViolation[];
}

/// Pure. No I/O — the caller reads the shipped files and passes
/// `{ path, code }` for every JS artifact the WebView loads, plus the
/// manifest's `requires` block (the escape hatch).
///
/// A file is a violation if it (1) only parses above
/// [WEBVIEW_BASELINE.ecmaVersion], (2) is an ES module (top-level
/// `import`/`export` — Di5.0 needs a classic/IIFE script), or
/// (3) references a [WEBVIEW_BASELINE.deniedApis] entry.
export function checkWebviewBaseline(
  files: ReadonlyArray<{ path: string; code: string }>,
  requires?: MiniAppRequires,
): WebviewBaselineResult {
  const exempt = isDi50Exempt(requires);
  const violations: WebviewBaselineViolation[] = [];

  for (const f of files) {
    // (1)/(2) — syntax floor + module-format. Parse at the baseline
    // ecmaVersion as a classic script first. If that throws, retry as
    // a module purely to disambiguate "it's ESM" from "syntax too
    // new" so the author gets an actionable message.
    try {
      Parser.parse(f.code, {
        ecmaVersion: WEBVIEW_BASELINE.ecmaVersion,
        sourceType: 'script',
      });
    } catch (scriptErr) {
      const isModule = ((): boolean => {
        try {
          Parser.parse(f.code, {
            ecmaVersion: WEBVIEW_BASELINE.ecmaVersion,
            sourceType: 'module',
          });
          return true;
        } catch {
          return false;
        }
      })();
      if (isModule) {
        violations.push({
          file: f.path,
          kind: 'esm',
          detail:
            'ES module (top-level import/export). The Di5.0 mini-app ' +
            'WebView host needs a classic/IIFE script — bundle to a ' +
            'non-module format (e.g. iife/umd).',
        });
      } else {
        const e = scriptErr as { message?: string; loc?: { line?: number } };
        violations.push({
          file: f.path,
          kind: 'syntax',
          detail:
            `syntax newer than ES${WEBVIEW_BASELINE.ecmaVersion} ` +
            `(Chromium ${WEBVIEW_BASELINE.chromium} / Di5.0): ` +
            `${e.message ?? 'parse error'}`,
          line: e.loc?.line,
        });
      }
    }

    // (3) — runtime-API denylist. Always scanned (a parse failure
    // above does not exempt a file from also leaking a denied API,
    // and a syntactically-fine file can still use one).
    for (const { pattern, api, since } of WEBVIEW_BASELINE.deniedApis) {
      const m = pattern.exec(f.code);
      if (m) {
        violations.push({
          file: f.path,
          kind: 'denied-api',
          detail:
            `uses \`${api}\` — added in Chrome ${since}, absent on ` +
            `Chromium ${WEBVIEW_BASELINE.chromium} (Di5.0)`,
          line: lineOf(f.code, m.index),
        });
      }
    }
  }

  return { ok: violations.length === 0, exempt, violations };
}

/// `requires.modernWebview === true`, or a non-empty `requires.dilink`
/// allow-list that does not include `di5.0`, means the author has
/// explicitly declared the app Di5.1-only — Gate A already excludes
/// it from Di5.0 cars, so Gate B must not also hard-fail it.
function isDi50Exempt(requires?: MiniAppRequires): boolean {
  if (!requires) return false;
  if (requires.modernWebview === true) return true;
  const dilink = requires.dilink as readonly DilinkFamily[] | undefined;
  if (dilink && dilink.length > 0 && !dilink.includes('di5.0')) {
    return true;
  }
  return false;
}

function lineOf(code: string, index: number): number {
  let line = 1;
  const end = Math.min(index, code.length);
  for (let i = 0; i < end; i++) {
    if (code.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}
