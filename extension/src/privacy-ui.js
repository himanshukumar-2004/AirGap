let overlay;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = '__sih_privacy_gate';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font-family:Inter,system-ui,sans-serif;';
  document.documentElement.appendChild(overlay);
  return overlay;
}

export function showPrivacyCheck({ imageAlt, summary, domainBlocked }) {
  return new Promise((resolve) => {
    const root = ensureOverlay();
    root.style.display = 'flex';
    root.innerHTML = `
      <div style="width:min(460px,calc(100vw - 32px));background:#fff;color:#111;border-radius:18px;padding:22px;box-shadow:0 20px 80px rgba(0,0,0,.35)">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.55">Privacy Check</div>
        <h2 style="margin:7px 0 8px;font-size:22px">The agent wants visual context</h2>
        <p style="margin:0 0 14px;line-height:1.5">This image was <b>not</b> automatically uploaded. It will be inspected locally first.</p>
        <div style="padding:12px;border-radius:12px;background:#f5f5f5;margin-bottom:12px">
          <div><b>Image:</b> ${escapeHtml(imageAlt || 'unnamed image')}</div>
          <div style="margin-top:6px"><b>Local inspection:</b> ${escapeHtml(summary)}</div>
          <div style="margin-top:6px"><b>Site:</b> ${escapeHtml(location.host)}</div>
        </div>
        ${domainBlocked ? '<div style="color:#a00;font-weight:700;margin-bottom:12px">This site is blocked by privacy policy. Transmission is disabled.</div>' : '<div style="font-size:12px;opacity:.65;margin-bottom:14px">Only a locally redacted representation can be sent.</div>'}
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="__privacy_deny" style="padding:10px 15px;border:1px solid #ccc;border-radius:10px;background:#fff;cursor:pointer">Keep private</button>
          <button id="__privacy_allow" ${domainBlocked ? 'disabled' : ''} style="padding:10px 15px;border:0;border-radius:10px;background:#111;color:#fff;cursor:pointer;opacity:${domainBlocked ? '.4' : '1'}">Allow once</button>
        </div>
      </div>`;
    root.querySelector('#__privacy_deny').onclick = () => { root.style.display = 'none'; resolve(false); };
    root.querySelector('#__privacy_allow').onclick = () => { root.style.display = 'none'; resolve(true); };
  });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}
