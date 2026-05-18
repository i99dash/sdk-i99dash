import { describe, it, expect } from 'vitest';

import { WEBVIEW_BASELINE, checkWebviewBaseline } from '../webview-baseline.js';
import { MiniAppRequiresSchema } from '../manifest.js';

const file = (code: string, path = 'app.js') => [{ path, code }];

describe('WEBVIEW_BASELINE', () => {
  it('pins the Di5.0 Chromium-95 / ES2022 floor', () => {
    expect(WEBVIEW_BASELINE.chromium).toBe(95);
    expect(WEBVIEW_BASELINE.ecmaVersion).toBe(2022);
    expect(WEBVIEW_BASELINE.deniedApis.length).toBeGreaterThan(0);
  });
});

describe('checkWebviewBaseline — accepts everything Chromium 95 runs', () => {
  it('passes ES2022 syntax a strict es2019 gate would WRONGLY reject', () => {
    // Optional chaining / nullish (Chrome 80), logical assignment
    // (85), class static block (94), private method (84), `.at()`
    // call site — all run on Chromium 95.
    const code = `
      (function () {
        const o = { a: { b: 1 } };
        let x = o?.a?.b ?? 0;
        x ||= 2;
        class C { #v = x; static { C.SEEN = true; } get() { return this.#v; } }
        var arr = [1, 2, 3];
        return new C().get() + arr.at(-1);
      })();
    `;
    const r = checkWebviewBaseline(file(code));
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('passes a classic IIFE bundle', () => {
    const r = checkWebviewBaseline(file('(function(){ window.x = 1; })();'));
    expect(r.ok).toBe(true);
  });
});

describe('checkWebviewBaseline — rejects what Di5.0 cannot run', () => {
  it('flags an ES module (top-level import/export) as `esm`', () => {
    const r = checkWebviewBaseline(file(`import { z } from 'zod';\nexport const a = z;`));
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === 'esm')).toBe(true);
  });

  it('flags structuredClone as a denied API with a line', () => {
    const r = checkWebviewBaseline(
      file('(function(){\n  var c = structuredClone({a:1});\n  return c;\n})();'),
    );
    expect(r.ok).toBe(false);
    const v = r.violations.find((x) => x.kind === 'denied-api');
    expect(v?.detail).toMatch(/structuredClone/);
    expect(v?.line).toBe(2);
  });

  it('flags Array.prototype.findLast / Promise.withResolvers', () => {
    const a = checkWebviewBaseline(file('var y=[1].findLast(n=>n>0);'));
    const b = checkWebviewBaseline(file('var p=Promise.withResolvers();'));
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(a.violations[0]?.kind).toBe('denied-api');
    expect(b.violations[0]?.kind).toBe('denied-api');
  });

  it('flags genuinely-unparseable / too-new syntax as `syntax`', () => {
    // Decorators are not parseable by acorn core at any ecmaVersion
    // (stage-3, not in the baseline) — a realistic "too new" reject.
    const r = checkWebviewBaseline(file('@dec class X {}'));
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === 'syntax')).toBe(true);
  });

  it('reports the offending file path', () => {
    const r = checkWebviewBaseline([{ path: 'vendor/bundle.js', code: 'structuredClone({});' }]);
    expect(r.violations[0]?.file).toBe('vendor/bundle.js');
  });
});

describe('checkWebviewBaseline — Gate-A escape hatch (exempt)', () => {
  const reqs = (o: unknown) => MiniAppRequiresSchema.parse(o);

  it('is NOT exempt with no requires / di5.0 included', () => {
    expect(checkWebviewBaseline(file('structuredClone({})')).exempt).toBe(false);
    expect(
      checkWebviewBaseline(file('structuredClone({})'), reqs({ dilink: ['di5.0', 'di5.1'] }))
        .exempt,
    ).toBe(false);
  });

  it('is exempt when requires.modernWebview === true', () => {
    const r = checkWebviewBaseline(file('structuredClone({})'), reqs({ modernWebview: true }));
    expect(r.exempt).toBe(true);
    // Still reports the violation — the CALLER downgrades to info.
    expect(r.ok).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  it('is exempt when requires.dilink excludes di5.0', () => {
    const r = checkWebviewBaseline(file('structuredClone({})'), reqs({ dilink: ['di5.1'] }));
    expect(r.exempt).toBe(true);
  });
});
