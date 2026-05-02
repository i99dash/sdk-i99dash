import HelperShell from '@/components/HelperShell.client';

/// Server-side root. Mounts the client-side shell which holds the
/// tab state + privileged-op dispatch.
export default function Home() {
  return (
    <main>
      <h1>AdbHelper</h1>
      <p className="subtitle">
        Diagnostic + maintenance tools for this head-unit. Operations run locally — this mini-app
        does not manage remote devices.
      </p>
      <HelperShell />
    </main>
  );
}
