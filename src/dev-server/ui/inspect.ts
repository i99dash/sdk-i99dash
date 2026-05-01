/// `/_sdk/inspect` — a single-file HTML page that polls
/// `/_sdk/inspect/data` and renders the most recent callApi
/// decisions. No framework, no build — this ships as a string baked
/// into the dev-server bundle so there's nothing to install.
///
/// Why a static string and not a separate file: the dev-server is a
/// single tsup-bundled package; pulling a real .html file in would
/// require a copy-asset step in the build pipeline. The page is
/// ~3 KB; the gain isn't worth the build complexity.
///
/// Polling cadence is 1 Hz — high enough to feel live during fixture
/// debugging, low enough that a 24-hour idle dev-server doesn't even
/// register on a CPU graph. The data endpoint is cheap (in-memory
/// ring buffer copy).

export const INSPECT_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>i99dash · callApi inspector</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    margin: 0;
    padding: 24px;
    background: #0e0e10;
    color: #e8e8ea;
  }
  h1 { font-size: 16px; margin: 0 0 16px; opacity: 0.7; font-weight: 500; }
  .empty { opacity: 0.5; padding: 32px; text-align: center; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #222; vertical-align: top; }
  th { font-size: 11px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.04em; }
  td { font-size: 13px; }
  td.path { word-break: break-all; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
  }
  .badge.matched { background: #143a1a; color: #6dd28a; }
  .badge.no_fixture { background: #3a1a14; color: #d28a6d; }
  .badge.bad_request { background: #3a3a14; color: #d2c46d; }
  .fixture { color: #87b3ff; }
  .detail { opacity: 0.6; font-size: 12px; }
  .at { opacity: 0.5; font-size: 12px; white-space: nowrap; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .live { display: inline-flex; align-items: center; gap: 6px; opacity: 0.6; font-size: 12px; }
  .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #6dd28a; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
</head>
<body>
<div class="toolbar">
  <h1>callApi inspector — last 20 decisions</h1>
  <span class="live"><span class="live-dot"></span>polling 1/sec</span>
</div>
<div id="root"><div class="empty">no callApi requests yet — your mini-app's first call will appear here.</div></div>
<script>
  const root = document.getElementById('root');
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function render(decisions) {
    if (!decisions.length) {
      root.innerHTML = '<div class="empty">no callApi requests yet — your mini-app\'s first call will appear here.</div>';
      return;
    }
    const rows = decisions.slice().reverse().map((d) => {
      const at = new Date(d.at).toLocaleTimeString();
      const queryStr = d.request.query ? ' ' + JSON.stringify(d.request.query) : '';
      const fixture = d.fixtureFile
        ? '<span class="fixture">' + escapeHtml(d.fixtureFile.split('/').pop() || d.fixtureFile) + '</span>'
        : '';
      const detail = d.detail ? '<div class="detail">' + escapeHtml(d.detail) + '</div>' : '';
      return (
        '<tr>' +
        '<td class="at">' + escapeHtml(at) + '</td>' +
        '<td><span class="badge ' + escapeHtml(d.outcome) + '">' + escapeHtml(d.outcome) + '</span></td>' +
        '<td class="path">' + escapeHtml(d.request.method) + ' ' + escapeHtml(d.request.path) + escapeHtml(queryStr) + '</td>' +
        '<td>' + fixture + detail + '</td>' +
        '</tr>'
      );
    }).join('');
    root.innerHTML = (
      '<table>' +
      '<thead><tr><th>time</th><th>outcome</th><th>request</th><th>fixture / detail</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>'
    );
  }
  async function poll() {
    try {
      const res = await fetch('/_sdk/inspect/data');
      if (!res.ok) return;
      const json = await res.json();
      render(json.decisions || []);
    } catch (_) {
      // network blip — try again next tick
    }
  }
  poll();
  setInterval(poll, 1000);
</script>
</body>
</html>`;
