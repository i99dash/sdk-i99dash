/// In-memory simulation of the host's native-capability families
/// (display / surface / cursor / gesture / pkg / boot) for the
/// dev-server. Returns the same wire shapes the real host returns
/// so the SDK's typed controllers run unchanged in local dev.
///
/// The fakes are lazy and stateful within a dev-server lifetime:
///
///   * `display.list` returns a fixed 3-display rig (IVI / Passenger /
///     Cluster · overlay) so cluster code paths exercise.
///   * `surface.create` mints a synthetic surfaceId, records the
///     mount, and returns the typical `{surfaceId, path, displayId,
///     route}` shape. The dev UI's preview pane reads the active
///     surface map to render iframes for non-IVI displays.
///   * `pkg.list` returns a fixed roster — Maps, Music, Camera,
///     Phone, Settings — which the developer can override via
///     `setPackages([...])`.
///   * `pkg.launch` / `pkg.move` log the call, return the typical
///     `{ok: true, path}` shape.
///   * `boot.set` / `list` / `unset` are scoped to the active
///     mini-app's appId (read from the dev context).
///
/// State persists across mini-app reloads (so an iframe refresh
/// doesn't lose mounted surfaces) but resets when the dev server
/// restarts. The dev UI's "Reset" button on the inspector clears
/// it explicitly.

export interface FakeDisplay {
  id: number;
  name: string;
  width: number;
  height: number;
  densityDpi: number;
  isDefault: boolean;
  isPresentation: boolean;
  isCluster: boolean;
}

export interface FakeSurface {
  surfaceId: string;
  displayId: number;
  route: string;
  path: 'presentation' | 'overlay' | 'am-start';
  appId: string;
  mountedAt: string;
}

export interface FakePackage {
  packageName: string;
  label: string;
  versionName: string;
  versionCode: number;
  isSystem: boolean;
}

export interface FakeBootEntry {
  appId: string;
  packageName: string;
  displayId: number;
  route?: string;
  setAtMs: number;
}

export interface NativeCapCall {
  at: string;
  op: string;
  params: Record<string, unknown>;
  response: unknown;
}

const DEFAULT_DISPLAYS: FakeDisplay[] = [
  {
    id: 0,
    name: 'ivi',
    width: 2560,
    height: 1600,
    densityDpi: 320,
    isDefault: true,
    isPresentation: false,
    isCluster: false,
  },
  {
    id: 1,
    name: 'fse',
    width: 1920,
    height: 720,
    densityDpi: 240,
    isDefault: false,
    isPresentation: true,
    isCluster: false,
  },
  {
    id: 5,
    name: 'shared_fission_bg_XDJAScreenProjection_1',
    width: 1920,
    height: 720,
    densityDpi: 320,
    isDefault: false,
    isPresentation: true,
    isCluster: true,
  },
];

const DEFAULT_PACKAGES: FakePackage[] = [
  {
    packageName: 'com.byd.maps',
    label: 'Maps',
    versionName: '5.0.1',
    versionCode: 50001,
    isSystem: false,
  },
  {
    packageName: 'com.byd.music',
    label: 'Music',
    versionName: '3.2',
    versionCode: 30200,
    isSystem: false,
  },
  {
    packageName: 'com.byd.camera',
    label: 'Camera',
    versionName: '2.1',
    versionCode: 20100,
    isSystem: false,
  },
  {
    packageName: 'com.byd.phone',
    label: 'Phone',
    versionName: '1.5',
    versionCode: 10500,
    isSystem: false,
  },
  {
    packageName: 'com.byd.settings',
    label: 'Settings',
    versionName: '1.0',
    versionCode: 10000,
    isSystem: true,
  },
];

const NATIVE_CAP_RING_CAPACITY = 50;

/**
 * Mutable simulation. Methods either return success-shaped envelopes
 * or `{success: false, error: {code, message}}` matching the host's
 * BridgeOpError envelope so the SDK's typed controllers branch on
 * the same `code` strings they branch on in production.
 */
export class NativeCapStore {
  private displays: FakeDisplay[] = [...DEFAULT_DISPLAYS];
  private packages: FakePackage[] = [...DEFAULT_PACKAGES];
  private surfaces = new Map<string, FakeSurface>();
  private boot = new Map<string, FakeBootEntry>(); // key = `${appId}|${packageName}`
  private surfaceCounter = 0;
  private listeners = new Set<(snapshot: NativeCapSnapshot) => void>();
  private readonly calls: NativeCapCall[] = [];

  /// Current dev-side appId — taken from the dev context so boot
  /// rows are scoped per-mini-app the same way the device scopes
  /// them by `(user, bydDeviceId, app)`.
  private activeAppId: string;

  constructor(activeAppId: string) {
    this.activeAppId = activeAppId;
  }

  setActiveAppId(appId: string) {
    this.activeAppId = appId;
  }

  setPackages(p: FakePackage[]) {
    this.packages = p;
    this.notify();
  }

  reset() {
    this.surfaces.clear();
    this.boot.clear();
    this.surfaceCounter = 0;
    this.calls.length = 0;
    this.notify();
  }

  /**
   * Dispatch one native-cap op to the right fake. Op string is
   * `<family>.<verb>` mirroring the host. Returns the same
   * `{success, data?, error?}` envelope `FamilyExecutor` returns.
   */
  dispatch(
    op: string,
    params: Record<string, unknown>,
  ): { success: boolean; data?: unknown; error?: { code: string; message: string } } {
    const dot = op.indexOf('.');
    const family = dot > 0 ? op.slice(0, dot) : '';
    const verb = dot > 0 ? op.slice(dot + 1) : '';
    let result: { success: boolean; data?: unknown; error?: { code: string; message: string } };
    try {
      result = this.dispatchInner(family, verb, params);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result = {
        success: false,
        error: { code: 'dev_server_error', message },
      };
    }
    this.recordCall(op, params, result);
    return result;
  }

  private dispatchInner(
    family: string,
    verb: string,
    params: Record<string, unknown>,
  ): { success: boolean; data?: unknown; error?: { code: string; message: string } } {
    switch (family) {
      case 'display':
        if (verb === 'list') return ok({ displays: this.displays });
        return notFound(`display.${verb}`);
      case 'surface':
        if (verb === 'create') return ok(this.surfaceCreate(params));
        if (verb === 'navigate') return ok(this.surfaceNavigate(params));
        if (verb === 'destroy') return ok(this.surfaceDestroy(params));
        if (verb === 'list') return ok({ surfaces: [...this.surfaces.values()] });
        return notFound(`surface.${verb}`);
      case 'cursor':
        // Stubs — IVI-side cursor visualisation isn't available in
        // a browser dev session, but the SDK calls still return ok
        // so the flow runs through.
        if (verb === 'attach' || verb === 'detach' || verb === 'move' || verb === 'style') {
          return ok({ ok: true });
        }
        return notFound(`cursor.${verb}`);
      case 'gesture':
        if (verb === 'tap' || verb === 'swipe' || verb === 'longPress') {
          return ok({ ok: true, path: 'a11y' });
        }
        return notFound(`gesture.${verb}`);
      case 'pkg':
        if (verb === 'list') {
          const includeSystem = params.includeSystem === true;
          return ok({
            packages: includeSystem ? this.packages : this.packages.filter((p) => !p.isSystem),
          });
        }
        if (verb === 'foreground') {
          return ok({ packageName: null, activityClass: '', atMillis: Date.now() });
        }
        if (verb === 'usage') {
          return ok({ rows: [], windowMs: (params.windowMs as number) ?? 0 });
        }
        if (verb === 'launch') return ok(this.pkgLaunch(params));
        if (verb === 'move') return ok(this.pkgMove(params));
        return notFound(`pkg.${verb}`);
      case 'boot':
        if (verb === 'set') return ok(this.bootSet(params));
        if (verb === 'list') return ok({ entries: this.bootList() });
        if (verb === 'unset') return ok(this.bootUnset(params));
        return notFound(`boot.${verb}`);
      default:
        return notFound(`${family}.${verb}`);
    }
  }

  private surfaceCreate(p: Record<string, unknown>): FakeSurface {
    const id = `sfc_dev_${++this.surfaceCounter}`;
    const displayId = (p.displayId as number) ?? 0;
    const surface: FakeSurface = {
      surfaceId: id,
      displayId,
      route: (p.route as string) ?? '/',
      path: displayId === 0 ? 'presentation' : 'am-start',
      appId: this.activeAppId,
      mountedAt: new Date().toISOString(),
    };
    this.surfaces.set(id, surface);
    this.notify();
    return surface;
  }

  private surfaceNavigate(p: Record<string, unknown>) {
    const id = p.surfaceId as string;
    const surface = this.surfaces.get(id);
    if (!surface) throw new Error(`surface ${id} not found`);
    surface.route = (p.route as string) ?? surface.route;
    this.surfaces.set(id, surface);
    this.notify();
    return { ok: true };
  }

  private surfaceDestroy(p: Record<string, unknown>) {
    const id = p.surfaceId as string;
    const removed = this.surfaces.delete(id);
    this.notify();
    return { ok: removed };
  }

  private pkgLaunch(p: Record<string, unknown>) {
    const displayId = (p.displayId as number | undefined) ?? -1;
    return {
      ok: true,
      path: displayId < 0 || displayId === 0 ? 'intent-launch' : 'am-start',
      error: null,
    };
  }

  private pkgMove(p: Record<string, unknown>) {
    return {
      ok: true,
      path: 'move-task',
      error: null,
    };
  }

  private bootSet(p: Record<string, unknown>): FakeBootEntry {
    const packageName = p.packageName as string;
    const displayId = (p.displayId as number | undefined) ?? -1;
    const route = p.route as string | undefined;
    const entry: FakeBootEntry = {
      appId: this.activeAppId,
      packageName,
      displayId,
      route: route && route.length > 0 ? route : undefined,
      setAtMs: Date.now(),
    };
    this.boot.set(`${this.activeAppId}|${packageName}`, entry);
    this.notify();
    return entry;
  }

  private bootList(): FakeBootEntry[] {
    return [...this.boot.values()].filter((e) => e.appId === this.activeAppId);
  }

  private bootUnset(p: Record<string, unknown>) {
    const key = `${this.activeAppId}|${p.packageName as string}`;
    const removed = this.boot.delete(key);
    this.notify();
    return { removed: removed ? 1 : 0 };
  }

  private recordCall(op: string, params: Record<string, unknown>, response: unknown) {
    this.calls.push({
      at: new Date().toISOString(),
      op,
      params,
      response,
    });
    if (this.calls.length > NATIVE_CAP_RING_CAPACITY) this.calls.shift();
  }

  // ── Snapshots for the UI ─────────────────────────────────────

  snapshot(): NativeCapSnapshot {
    return {
      displays: [...this.displays],
      surfaces: [...this.surfaces.values()],
      packages: [...this.packages],
      boot: [...this.boot.values()],
      calls: [...this.calls],
    };
  }

  subscribe(cb: (s: NativeCapSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify() {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }
}

export interface NativeCapSnapshot {
  displays: FakeDisplay[];
  surfaces: FakeSurface[];
  packages: FakePackage[];
  boot: FakeBootEntry[];
  calls: NativeCapCall[];
}

function ok(data: unknown) {
  return { success: true, data };
}

function notFound(op: string) {
  return {
    success: false,
    error: { code: 'unknown_op', message: `dev-server doesn't fake ${op}` },
  };
}
