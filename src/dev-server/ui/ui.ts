/// The tiny control-panel UI served at `/_sdk/ui`. Vanilla TS-compiled-
/// to-string so the dev-server can emit a single bundle with no extra
/// asset build-step. All state lives on the dev-server; the UI is a
/// thin remote control.
export const UI_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>sdk-i99dash · dev-server</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; padding: 24px; max-width: 640px; }
    h1 { font-size: 18px; margin: 0 0 16px; }
    fieldset { border: 1px solid #8884; border-radius: 8px; margin: 0 0 16px; padding: 12px 16px; }
    legend { font-weight: 600; }
    label { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; gap: 12px; }
    input[type="text"], select { padding: 4px 8px; border-radius: 4px; border: 1px solid #8884; font: inherit; min-width: 160px; }
    .muted { opacity: 0.6; font-size: 12px; margin-top: 4px; }
    .state { font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; background: #8881; padding: 12px; border-radius: 6px; }
    .row { display: flex; gap: 8px; }
  </style>
</head>
<body>
  <h1>dev-server controls</h1>

  <fieldset>
    <legend>driving</legend>
    <label>
      <span>moving (speed &gt; 5 km/h)</span>
      <input type="checkbox" id="driving" />
    </label>
    <div class="muted">Controls the safety gate. Off = 0 km/h, on = 40 km/h.</div>
  </fieldset>

  <fieldset>
    <legend>context</legend>
    <label>
      <span>BYD device ID (activeCarId)</span>
      <input type="text" id="bydDeviceId" />
    </label>
    <label>
      <span>locale</span>
      <select id="locale">
        <option value="en">en</option>
        <option value="ar">ar</option>
      </select>
    </label>
    <label>
      <span>theme</span>
      <select id="theme">
        <option value="light">light</option>
        <option value="dark">dark</option>
      </select>
    </label>
  </fieldset>

  <fieldset>
    <legend>current state</legend>
    <div class="state" id="state">…</div>
  </fieldset>

  <script>
    (async function () {
      const dRef = document.getElementById('driving');
      const vRef = document.getElementById('bydDeviceId');
      const lRef = document.getElementById('locale');
      const tRef = document.getElementById('theme');
      const sRef = document.getElementById('state');

      async function refresh() {
        const s = await fetch('/_sdk/state').then(r => r.json());
        dRef.checked = s.speedKmh > 5;
        vRef.value = s.context.activeCarId;
        lRef.value = s.context.locale;
        tRef.value = s.context.isDark ? 'dark' : 'light';
        sRef.textContent = JSON.stringify(s, null, 2);
      }

      async function patch(body) {
        await fetch('/_sdk/state', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        await refresh();
      }

      dRef.addEventListener('change', () => patch({ speedKmh: dRef.checked ? 40 : 0 }));
      vRef.addEventListener('change', () => patch({ context: { activeCarId: vRef.value } }));
      lRef.addEventListener('change', () => patch({ context: { locale: lRef.value } }));
      tRef.addEventListener('change', () => patch({ context: { isDark: tRef.value === 'dark' } }));

      await refresh();
    })();
  </script>
</body>
</html>
`;
