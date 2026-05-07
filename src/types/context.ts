import { z } from 'zod';

/// Snapshot of host state the mini-app can read through `getContext`.
///
/// Keeping the shape here in a schema means the runtime can validate
/// what the host returned and fail loud on drift — new fields the host
/// adds must be reflected here before SDK consumers can read them.
export const MiniAppContextSchema = z.object({
  /// Opaque stable identifier for the signed-in user. Empty string
  /// when no account is bound. Treat as non-public.
  userId: z.string(),
  /// BYD media/cloud device ID of the active car (the value formerly
  /// referred to as the car's "VIN" in this SDK — see MIGRATING.md;
  /// it is NOT the ISO 3779 chassis VIN). Empty string when unbound.
  /// Sensitive — don't render in plain text or log to third parties.
  activeCarId: z.string(),
  /// Host UI locale. Drives text direction + localised strings.
  locale: z.enum(['ar', 'en']),
  /// Host theme brightness; use to sync your CSS color-scheme.
  isDark: z.boolean(),
  /// Manifest `version` the host launched you with; echoed so you can
  /// sanity-check cache-busting behaviour.
  appVersion: z.string(),
  /// Manifest `id` the host launched you with; echoed for debugging.
  appId: z.string(),
});

export type MiniAppContext = z.infer<typeof MiniAppContextSchema>;
