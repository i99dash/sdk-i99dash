'use client';

import { useEffect, useState } from 'react';
import { getClient } from '@/lib/sdk';

interface Station {
  name: string;
  price_sar: number;
  distance_km: number;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'ready'; stations: Station[] };

export default function StationList() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    const client = getClient();
    if (!client) {
      setPhase({ kind: 'error', message: 'No host bridge.' });
      return;
    }
    client
      .callApi<{ stations: Station[] }>({
        path: '/api/v1/fuel-stations',
        method: 'GET',
        query: { radius_m: 5000 },
      })
      .then((res) => {
        if (res.success) {
          setPhase({ kind: 'ready', stations: res.data.stations });
        } else {
          setPhase({
            kind: 'error',
            message: res.error.message,
            code: res.error.code,
          });
        }
      })
      .catch((e: unknown) => setPhase({ kind: 'error', message: String(e) }));
  }, []);

  return (
    <section className="card">
      <h2>fuel stations</h2>
      {phase.kind === 'loading' && <p>loading…</p>}
      {phase.kind === 'error' && (
        <p>
          {phase.code ? `[${phase.code}] ` : ''}
          {phase.message}
        </p>
      )}
      {phase.kind === 'ready' &&
        phase.stations.map((s) => (
          <div className="station" key={s.name}>
            <span className="station-name">{s.name}</span>
            <span className="station-price">
              {s.price_sar.toFixed(2)} SAR/L · {s.distance_km.toFixed(1)} km
            </span>
          </div>
        ))}
    </section>
  );
}
