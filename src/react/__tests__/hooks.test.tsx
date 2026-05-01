// @vitest-environment jsdom
/// React hook tests. Mounts each hook under `<MiniAppProvider>` over
/// a `MiniAppClient.withBridge(stub)` so the real hook code path runs
/// — no React-side mocks. The bridge stub's notify-callback shape is
/// the same one the production HostBridge uses.

import { act, render, renderHook, waitFor } from '@testing-library/react';
import {
  CallApiFailedError,
  CarStatusUnavailableError as _Unavail,
  MiniAppClient,
  type Bridge,
  type CarStatus,
  type CarStatusBridge,
  type MediaBridge,
  type MediaSnapshot,
} from '../../runtime/index.js';
import { describe, expect, it, vi } from 'vitest';

import {
  MiniAppProvider,
  useCallApi,
  useCarStatus,
  useClient,
  useMedia,
  useMiniAppContext,
} from '../index.js';

void _Unavail;

const validContext = {
  userId: 'u-1',
  activeCarId: 'VIN',
  locale: 'en',
  isDark: false,
  appVersion: '1.0.0',
  appId: 'fuel_prices',
} as const;

function validStatus(overrides: Partial<CarStatus> = {}): CarStatus {
  return {
    vin: 'WDB1234567',
    at: '2026-04-27T12:00:00.000Z',
    staleness: 'fresh',
    isMoving: false,
    speedKmh: 0,
    doorsLocked: true,
    batteryPct: 88,
    ...overrides,
  };
}

function carStatusBridge(): {
  bridge: CarStatusBridge;
  notify: (raw: unknown) => void;
} {
  let notifyFn: ((raw: unknown) => void) | undefined;
  const bridge: CarStatusBridge = {
    getContext: async () => validContext,
    callApi: async () => ({ success: true, data: null }),
    getCarStatus: async () => validStatus(),
    subscribeCarStatus: async (n) => {
      notifyFn = n;
      return { id: '1' };
    },
    unsubscribeCarStatus: async () => {},
    subscribeCarConnectionState: async () => ({ id: 'c' }),
    unsubscribeCarConnectionState: async () => {},
  };
  return {
    bridge,
    notify: (raw) => notifyFn?.(raw),
  };
}

const wrapper = (client: MiniAppClient | null) => {
  return ({ children }: { children: React.ReactNode }): React.ReactElement => (
    <MiniAppProvider client={client}>{children}</MiniAppProvider>
  );
};

describe('useClient', () => {
  it('returns the provided client', () => {
    const client = MiniAppClient.withBridge(carStatusBridge().bridge);
    const { result } = renderHook(() => useClient(), { wrapper: wrapper(client) });
    expect(result.current).toBe(client);
  });

  it('returns null without a provider', () => {
    const { result } = renderHook(() => useClient());
    expect(result.current).toBeNull();
  });
});

describe('useMiniAppContext', () => {
  it('resolves to the host context', async () => {
    const { bridge } = carStatusBridge();
    const client = MiniAppClient.withBridge(bridge);
    const { result } = renderHook(() => useMiniAppContext(), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.locale).toBe('en');
    expect(result.current.error).toBeNull();
  });

  it('returns the fallback when client is null', async () => {
    const fallback = { ...validContext, locale: 'fr' as const };
    const { result } = renderHook(() => useMiniAppContext({ fallback }), {
      wrapper: wrapper(null),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.locale).toBe('fr');
  });
});

describe('useCarStatus', () => {
  it('renders the fallback initially, then live data on event', async () => {
    const { bridge, notify } = carStatusBridge();
    const client = MiniAppClient.withBridge(bridge);
    const fallback = validStatus({ batteryPct: 1 });
    const { result } = renderHook(() => useCarStatus({ fallback }), {
      wrapper: wrapper(client),
    });
    expect(result.current.data?.batteryPct).toBe(1);

    // Microtask drain + event
    await act(async () => {
      await Promise.resolve();
      notify(validStatus({ batteryPct: 77 }));
    });
    expect(result.current.data?.batteryPct).toBe(77);
  });

  it('keeps fallback if bridge lacks the surface', async () => {
    const plain: Bridge = {
      getContext: async () => validContext,
      callApi: async () => ({ success: true, data: null }),
    };
    const client = MiniAppClient.withBridge(plain);
    const fallback = validStatus({ batteryPct: 50 });
    const { result } = renderHook(() => useCarStatus({ fallback }), {
      wrapper: wrapper(client),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data?.batteryPct).toBe(50);
    expect(result.current.error).toBeNull();
  });
});

describe('useCallApi', () => {
  it('resolves data on success', async () => {
    const bridge: Bridge = {
      getContext: async () => validContext,
      callApi: async () => ({ success: true, data: { value: 42 } }),
    };
    const client = MiniAppClient.withBridge(bridge);
    const { result } = renderHook(
      () => useCallApi<{ value: number }>({ path: '/api/v1/x', method: 'GET' }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ value: 42 });
    expect(result.current.error).toBeNull();
  });

  it('surfaces a CallApiFailedError on success:false', async () => {
    const bridge: Bridge = {
      getContext: async () => validContext,
      callApi: async () => ({
        success: false,
        error: { code: 'disallowed_path', message: 'no' },
      }),
    };
    const client = MiniAppClient.withBridge(bridge);
    const { result } = renderHook(() => useCallApi({ path: '/api/v1/x', method: 'GET' }), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(CallApiFailedError);
    if (result.current.error instanceof CallApiFailedError) {
      expect(result.current.error.errorCode).toBe('disallowed_path');
    }
  });

  it('respects enabled=false', async () => {
    const callApi = vi.fn(async () => ({ success: true, data: null }));
    const bridge: Bridge = {
      getContext: async () => validContext,
      callApi,
    };
    const client = MiniAppClient.withBridge(bridge);
    renderHook(() => useCallApi({ path: '/api/v1/x', method: 'GET' }, { enabled: false }), {
      wrapper: wrapper(client),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(callApi).not.toHaveBeenCalled();
  });
});

function validMediaSnapshot(overrides: Partial<MediaSnapshot> = {}): MediaSnapshot {
  return {
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    artUrl: 'https://art.i99dash.app/x.png',
    state: 'playing',
    source: 'bluetooth',
    volume: 0.5,
    at: '2026-04-28T08:00:00.000Z',
    ...overrides,
  };
}

function mediaBridge(): { bridge: MediaBridge; notify: (raw: unknown) => void } {
  let notifyFn: ((raw: unknown) => void) | undefined;
  const bridge: MediaBridge = {
    getContext: async () => validContext,
    callApi: async () => ({ success: true, data: null }),
    getMedia: async () => validMediaSnapshot(),
    subscribeMedia: async (n) => {
      notifyFn = n;
      return { id: 'm-1' };
    },
    unsubscribeMedia: async () => {},
  };
  return { bridge, notify: (raw) => notifyFn?.(raw) };
}

describe('useMedia', () => {
  it('renders the fallback initially, then live data on event', async () => {
    const { bridge, notify } = mediaBridge();
    const client = MiniAppClient.withBridge(bridge);
    const fallback = validMediaSnapshot({ title: 'fallback' });
    const { result } = renderHook(() => useMedia({ fallback }), {
      wrapper: wrapper(client),
    });
    expect(result.current.data?.title).toBe('fallback');

    await act(async () => {
      await Promise.resolve();
      notify(validMediaSnapshot({ title: 'live' }));
    });
    expect(result.current.data?.title).toBe('live');
  });

  it('keeps fallback if bridge lacks the surface', async () => {
    const plain: Bridge = {
      getContext: async () => validContext,
      callApi: async () => ({ success: true, data: null }),
    };
    const client = MiniAppClient.withBridge(plain);
    const fallback = validMediaSnapshot({ title: 'fb' });
    const { result } = renderHook(() => useMedia({ fallback }), {
      wrapper: wrapper(client),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data?.title).toBe('fb');
    expect(result.current.error).toBeNull();
  });
});

describe('MiniAppProvider', () => {
  it('renders children with a null client', () => {
    const { container } = render(
      <MiniAppProvider client={null}>
        <span data-testid="ok">hello</span>
      </MiniAppProvider>,
    );
    expect(container.querySelector('[data-testid="ok"]')?.textContent).toBe('hello');
  });
});
