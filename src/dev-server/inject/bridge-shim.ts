/// Raw JS string, served at `/_sdk/bridge.js` and `<script>`-injected
/// into the dev's `index.html`. When loaded it defines the host
/// bridge on `window.__i99dashHost` (the canonical branded name) so
/// the real SDK runs unchanged in local dev.
///
/// Kept as a template literal (not a compiled .js file) so the
/// dev-server package emits a single .js/.cjs output — no multi-file
/// asset pipeline, no build-time file copies.
///
/// **Native-capability families** (Phase A/B/C — display, surface,
/// cursor, gesture, pkg, boot) are routed through this shim with
/// dev-time fakes so mini-app authors can develop against the typed
/// SDK controllers without sideloading to a Leopard 8. The fakes
/// return plausible shapes — a 3-display rig (IVI / Passenger /
/// Cluster · overlay), an in-memory surface map, a small package
/// roster — so the SDK's `client.display.list()` / `client.surface.create`
/// / `client.pkg.launch` / `client.boot.set` all produce the same
/// data shapes the device returns. Calls and responses are POSTed
/// to `/_sdk/native-cap` so the dev UI's inspector can see what
/// the mini-app is doing.
export const BRIDGE_SHIM_JS = /* javascript */ `
(function () {
  if (window.__i99dashHost && window.__i99dashHost.callHandler) return;

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('dev-server ' + res.status);
    return res.json();
  }

  async function get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('dev-server ' + res.status);
    return res.json();
  }

  // Native-capability family ops route through one POST endpoint so
  // the dev UI can record + replay them. The host-side wire shape
  // for each family op is mirrored exactly; the real SDK code path
  // doesn't know it's running against a fake.
  function isNativeCap(name) {
    if (typeof name !== 'string') return false;
    var dot = name.indexOf('.');
    if (dot <= 0) return false;
    var family = name.slice(0, dot);
    return (
      family === 'display' ||
      family === 'surface' ||
      family === 'cursor' ||
      family === 'gesture' ||
      family === 'pkg' ||
      family === 'boot'
    );
  }

  async function callNativeCap(name, args) {
    var raw = await post('/_sdk/native-cap', {
      op: name,
      params: (args && args[0] && args[0].params) || {},
      idempotencyKey: (args && args[0] && args[0].idempotencyKey) || null,
    });
    return raw;
  }

  var api = {
    callHandler: async function (name) {
      var args = Array.prototype.slice.call(arguments, 1);
      if (name === 'getContext') return get('/_sdk/context');
      if (isNativeCap(name)) return callNativeCap(name, args);
      return {
        success: false,
        error: { code: 'unknown_handler', message: name },
      };
    },
  };

  window.__i99dashHost = api;
  // Alias under the legacy global so code in transit between the old
  // and new names keeps working during rollout. Scheduled for removal.
  if (!window.flutter_inappwebview) {
    window.flutter_inappwebview = api;
  }
})();
`;
