'use client';

import { useState } from 'react';

import { getAdmin } from '@/lib/admin';

import AppPicker from './AppPicker.client';
import FileBrowser from './FileBrowser.client';
import SystemPanel from './SystemPanel.client';

type Tab = 'apps' | 'system' | 'files';

const TABS: { id: Tab; label: string }[] = [
  { id: 'apps', label: 'Apps' },
  { id: 'system', label: 'System' },
  { id: 'files', label: 'Files' },
];

/// Client-side tab shell. Renders a "no host" fallback when the
/// admin client can't initialise (SSR / no bridge / non-privileged
/// host) so a regular browser opening this URL gets a friendly
/// message instead of a stack trace.
export default function HelperShell() {
  const [tab, setTab] = useState<Tab>('apps');

  const admin = getAdmin();
  if (admin === null) {
    return (
      <div className="no-host">
        <p>This mini-app must run inside the i99dash host.</p>
        <p className="subtitle">
          Run <code>pnpm dev</code> to start the local dev-server.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'apps' && <AppPicker admin={admin} />}
      {tab === 'system' && <SystemPanel admin={admin} />}
      {tab === 'files' && <FileBrowser admin={admin} />}
    </>
  );
}
