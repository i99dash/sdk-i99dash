import { describe, it, expect } from 'vitest';
import { StateStore } from '../state/state-store.js';

const initial = {
  context: {
    userId: 'u',
    activeCarId: 'V',
    locale: 'en' as const,
    isDark: false,
    appVersion: '1.0.0',
    appId: 'x',
  },
  speedKmh: 0,
};

describe('StateStore', () => {
  it('returns initial state', () => {
    const s = new StateStore(initial);
    expect(s.get().context.locale).toBe('en');
    expect(s.get().speedKmh).toBe(0);
  });

  it('patches context partially', () => {
    const s = new StateStore(initial);
    s.patch({ context: { locale: 'ar' } });
    expect(s.get().context.locale).toBe('ar');
    expect(s.get().context.activeCarId).toBe('V'); // preserved
  });

  it('patches speedKmh', () => {
    const s = new StateStore(initial);
    s.patch({ speedKmh: 40 });
    expect(s.get().speedKmh).toBe(40);
  });

  it('notifies subscribers and honours unsubscribe', () => {
    const s = new StateStore(initial);
    const calls: number[] = [];
    const off = s.subscribe((v) => calls.push(v.speedKmh));
    s.patch({ speedKmh: 10 });
    s.patch({ speedKmh: 20 });
    off();
    s.patch({ speedKmh: 30 });
    expect(calls).toEqual([10, 20]);
  });
});
