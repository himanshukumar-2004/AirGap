let overlay;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = '__sih_privacy_gate';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font-family:Inter,system-ui,sans-serif;';
  document.documentElement.appendChild(overlay);
  return overlay;
}

export function showPrivacyCheck({ imageAlt, summary, domainBlocked, redactedDataUrl }) {
  return new Promise((resolve) => {
    const root = ensureOverlay();
    root.style.display = 'flex';
    root.innerHTML = `
      <div style="width:min(480px,calc(100vw - 32px));background:#fff;color:#111;border-radius:18px;padding:22px;box-shadow:0 20px 80px rgba(0,0,0,.35);max-height:90vh;overflow-y:auto">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.55">Privacy Check</div>
        <h2 style="margin:7px 0 8px;font-size:22px">Visual Context Protection</h2>
        <p style="margin:0 0 12px;line-height:1.5;font-size:13px;color:#374151">This image was inspected and redacted locally. Review the sanitized version below before allowing transmission:</p>
        ${redactedDataUrl ? `
          <div style="margin:10px 0 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:10px;text-align:center">
            <div style="font-size:11px;font-weight:600;color:#4b5563;margin-bottom:8px;text-align:left">🛡️ Sanitized Image Preview (Faces & Sensitive Data Masked):</div>
            <img src="${redactedDataUrl}" style="max-width:100%;max-height:220px;border-radius:8px;object-fit:contain;border:1px solid #d1d5db;box-shadow:0 2px 8px rgba(0,0,0,0.08)" alt="Redacted preview" />
          </div>
        ` : ''}
        <div style="padding:12px;border-radius:12px;background:#f5f5f5;margin-bottom:12px;font-size:12px">
          <div><b>Target Image:</b> ${escapeHtml(imageAlt || 'unnamed image')}</div>
          <div style="margin-top:6px"><b>Local Inspection:</b> ${escapeHtml(summary)}</div>
          <div style="margin-top:6px"><b>Site:</b> ${escapeHtml(location.host)}</div>
        </div>
        ${domainBlocked ? '<div style="color:#a00;font-weight:700;margin-bottom:12px">This site is blocked by privacy policy. Transmission is disabled.</div>' : '<div style="font-size:12px;color:#6b7280;margin-bottom:14px">Only this locally redacted representation will be sent to the backend.</div>'}
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="__privacy_deny" style="padding:10px 18px;border:1px solid #d1d5db;border-radius:10px;background:#ffffff;color:#1f2937;font-size:14px;font-weight:500;cursor:pointer">Deny</button>
          <button id="__privacy_allow" ${domainBlocked ? 'disabled' : ''} style="padding:10px 18px;border:0;border-radius:10px;background:#111827;color:#ffffff;font-size:14px;font-weight:500;cursor:pointer;opacity:${domainBlocked ? '.4' : '1'}">Allow once</button>
        </div>
      </div>`;
    root.querySelector('#__privacy_deny').onclick = () => { root.style.display = 'none'; resolve(false); };
    root.querySelector('#__privacy_allow').onclick = () => { root.style.display = 'none'; resolve(true); };
  });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

let agentHud;

function ensureAgentHud() {
  if (agentHud) return agentHud;
  agentHud = document.createElement('div');
  agentHud.id = '__sih_agent_hud';
  agentHud.style.cssText = [
    'position: fixed',
    'bottom: 24px',
    'right: 24px',
    'max-width: 440px',
    'width: calc(100vw - 48px)',
    'z-index: 2147483646',
    'background: #ffffff',
    'color: #111827',
    'border-radius: 14px',
    'box-shadow: 0 10px 30px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.08)',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'font-size: 13px',
    'padding: 16px',
    'transition: all 0.2s ease',
    'box-sizing: border-box',
    'display: none',
  ].join(';');
  document.documentElement.appendChild(agentHud);
  return agentHud;
}

export function showAgentHud({ title = 'Privacy Agent', status = '', message = '', actions = [], isError = false, canClose = true, redactedImageUrl = null }) {
  const hud = ensureAgentHud();
  hud.style.display = 'block';

  let actionsHtml = '';
  if (Array.isArray(actions) && actions.length > 0) {
    const list = actions.map((a, i) => `<div style="margin-top:2px">${i + 1}. <b>${escapeHtml(a.action.toUpperCase())}</b> on #${escapeHtml(a.targetId || '')}${a.value ? ` ("${escapeHtml(a.value)}")` : ''}</div>`).join('');
    actionsHtml = `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #e5e7eb;font-size:11px;color:#4b5563"><b>Executed Actions:</b>${list}</div>`;
  }

  let imageHtml = '';
  if (redactedImageUrl && typeof redactedImageUrl === 'string') {
    imageHtml = `
      <div style="margin-top:10px;padding:8px 10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;display:flex;align-items:center;gap:12px">
        <img src="${redactedImageUrl}" style="width:68px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #d1d5db;box-shadow:0 1px 3px rgba(0,0,0,0.1)" alt="Redacted Image" />
        <div style="font-size:11px;line-height:1.4;color:#374151">
          <div style="font-weight:600;color:#111827">Sanitized Visual Context</div>
          <div>Faces & sensitive text masked locally prior to backend transmission.</div>
        </div>
      </div>`;
  }

  let closeBtnHtml = canClose
    ? `<button id="__sih_hud_close" style="background:none;border:none;color:#9ca3af;font-size:18px;cursor:pointer;padding:0 4px;line-height:1" title="Dismiss">✕</button>`
    : '';

  hud.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${isError ? '#dc2626' : '#2563eb'}">${escapeHtml(title)}</div>
      ${closeBtnHtml}
    </div>
    ${status ? `<div style="font-size:12px;color:#6b7280;margin-bottom:6px">${escapeHtml(status)}</div>` : ''}
    ${message ? `<div style="font-size:13px;line-height:1.5;color:#111827;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow-y:auto">${escapeHtml(message)}</div>` : ''}
    ${imageHtml}
    ${actionsHtml}
  `;

  if (canClose) {
    const closeBtn = hud.querySelector('#__sih_hud_close');
    if (closeBtn) {
      closeBtn.onclick = () => {
        hud.style.display = 'none';
      };
    }
  }
}

export function hideAgentHud() {
  if (agentHud) {
    agentHud.style.display = 'none';
  }
}

