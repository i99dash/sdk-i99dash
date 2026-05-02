# AdbHelper-style mini-app

A reference **privileged** mini-app for `i99dash`. Lays
out the same UX shape as a phone-to-phone ADB client (app picker,
system controls, file browser) but every operation targets **the
head-unit it's running on** — not a remote device.

## What it demonstrates

- `AdminClient.fromWindow()` + `invoke('templateId', params)` for
  every privileged op
- The split between tier-1 ops (instant local read), tier-2 control
  (covered by the install-time session cap), and tier-2 step-up
  (re-auth required)
- Cleanly mocked locally via `i99dash dev` so you can iterate
  without a real car

## Quickstart

```bash
pnpm install
pnpm dev
# → opens http://localhost:5174 with the bridge shim + mock fixtures
```

## Templates used

| Screen | Templates                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------- |
| Apps   | `pm.list_packages`, `pm.disable_user`, `pm.enable_user`                                               |
| System | `sys.reboot` (step-up), `diag.tail_logs`, `diag.mqtt_status`, `diag.restart_mqtt`, `diag.clear_cache` |
| Files  | `fs.ls` (allow-listed paths)                                                                          |

## What this mini-app _cannot_ do

The Beetle ADB Helper APK manages **remote** Android devices via
USB-OTG / Wi-Fi ADB and a bundled `adb` binary. None of that runs in
a sandboxed mini-app:

- ❌ USB-OTG access
- ❌ ADB-protocol over Wi-Fi
- ❌ Screen-mirroring of a remote device (scrcpy)
- ❌ Fastboot / bootloader operations
- ❌ File transfer between two devices

Those features belong in a first-party Flutter feature (under
`i99dash/lib/features/`), not in a mini-app sandbox. See the design
doc at `backend-i99dash/docs/admin-permissions.md` for the rationale.

## License

MIT (per the SDK monorepo).
