'use client';

import { useEffect, useState } from 'react';

/// Polls the SDK dev-server's state endpoint to pick up the driving
/// toggle from `/_sdk/ui`. In production the endpoint doesn't exist;
/// the banner stays hidden and the host's own safety gate takes over.
///
/// Kept as a simple 1s poll rather than a stream — the endpoint is
/// local, zero-network on the wire, and the pattern stays trivial to
/// copy-paste.
export default function DrivingBanner() {
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/_sdk/state');
        if (!res.ok) return;
        const body = (await res.json()) as { speedKmh?: number };
        if (!cancelled && typeof body.speedKmh === 'number') {
          setSpeedKmh(body.speedKmh);
        }
      } catch {
        // Silent — in production /_sdk/state isn't there, and that's
        // fine; the banner just stays hidden.
      }
    };
    tick();
    const interval = setInterval(tick, 1_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (speedKmh === null) return null;
  if (speedKmh <= 5) {
    return (
      <div className="banner success">Parked ({speedKmh.toFixed(0)} km/h) — safe to interact.</div>
    );
  }
  return (
    <div className="banner warn">
      Car is moving ({speedKmh.toFixed(0)} km/h). Complex interactions are blocked by the host while
      driving.
    </div>
  );
}
