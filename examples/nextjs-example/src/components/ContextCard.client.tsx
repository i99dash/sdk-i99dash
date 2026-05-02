'use client';

import { useEffect, useState } from 'react';
import type { MiniAppContext } from 'i99dash';
import { getClient } from '@/lib/sdk';

/// Reads `getContext` once on mount and renders a masked view of the
/// host state. Also flips the document's `dir` + `lang` so RTL kicks
/// in for Arabic. The locale swap is purely visual — the host
/// remains authoritative.
export default function ContextCard() {
  const [ctx, setCtx] = useState<MiniAppContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = getClient();
    if (!client) {
      setError('No host bridge on this window. Run `i99dash dev` to attach one.');
      return;
    }
    client
      .getContext()
      .then((c) => {
        setCtx(c);
        document.documentElement.lang = c.locale;
        document.documentElement.dir = c.locale === 'ar' ? 'rtl' : 'ltr';
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <section className="card">
        <h2>context</h2>
        <p>{error}</p>
      </section>
    );
  }
  if (!ctx) {
    return (
      <section className="card">
        <h2>context</h2>
        <p>loading…</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>context</h2>
      <pre>
        {JSON.stringify(
          {
            // Mask sensitive fields before rendering — VIN is the only
            // one that identifies a physical car across sessions.
            userId: ctx.userId ? '••••' + ctx.userId.slice(-4) : '',
            activeCarId: ctx.activeCarId ? '••••' + ctx.activeCarId.slice(-4) : '',
            locale: ctx.locale,
            isDark: ctx.isDark,
            appId: ctx.appId,
            appVersion: ctx.appVersion,
          },
          null,
          2,
        )}
      </pre>
    </section>
  );
}
