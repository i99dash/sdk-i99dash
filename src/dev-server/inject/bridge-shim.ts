/// Raw JS string, served at `/_sdk/bridge.js` and `<script>`-injected
/// into the dev's `index.html`. When loaded it defines the host
/// bridge on `window.__i99dashHost` (the canonical branded name) so
/// the real SDK runs unchanged in local dev.
///
/// Kept as a template literal (not a compiled .js file) so the
/// dev-server package emits a single .js/.cjs output — no multi-file
/// asset pipeline, no build-time file copies.
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

  var api = {
    callHandler: async function (name) {
      var args = Array.prototype.slice.call(arguments, 1);
      switch (name) {
        case 'getContext':
          return get('/_sdk/context');
        case 'callApi':
          return post('/_sdk/call-api', args[0]);
        default:
          return { success: false, error: { code: 'unknown_handler', message: name } };
      }
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
