import { applyTier0Text } from './regexRules.js';

const MAX_ELEMENTS = 500;
const MAX_TEXT_PER_NODE = 1200;

function isVisible(el) {
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function getOrAssignId(el) {
  if (el.id) return el.id;
  if (el.dataset.agentId) return el.dataset.agentId;
  const id = `agent_${crypto.randomUUID().slice(0, 10)}`;
  el.dataset.agentId = id;
  return id;
}

function directText(el) {
  return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_PER_NODE);
}

function walkOpenShadowRoots(root, out, seen) {
  if (!root || seen.has(root)) return;
  seen.add(root);
  for (const node of root.querySelectorAll('*')) {
    out.push(node);
    if (node.shadowRoot) walkOpenShadowRoots(node.shadowRoot, out, seen);
  }
}

function findBackgroundImage(el) {
  const bg = getComputedStyle(el).backgroundImage;
  if (!bg || bg === 'none') return null;
  const match = bg.match(/url\(["']?(.*?)["']?\)/i);
  return match?.[1] || null;
}

export function extractPageState() {
  const nodes = [];
  walkOpenShadowRoots(document, nodes, new Set());
  const elements = [];
  const images = [];
  const tier0Mapping = {};
  const tier0Counters = {};
  const valueToToken = new Map();

  for (const el of nodes) {
    if (elements.length >= MAX_ELEMENTS || !isVisible(el)) continue;
    const tag = el.tagName;
    const id = getOrAssignId(el);
    const r = el.getBoundingClientRect();

    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const type = tag === 'INPUT' ? el.type : tag.toLowerCase();
      const isSecret = type === 'password' || /password|passcode|otp|pin|token/i.test(`${type} ${el.name || ''} ${el.placeholder || ''}`);
      if (isSecret) el.dataset.agentSensitive = 'true';

      let rawContent = '';
      if (isSecret) {
        rawContent = '[REDACTED_PASSWORD]';
      } else {
        const val = el.value ? String(el.value).trim() : '';
        const label = el.getAttribute('aria-label') || el.placeholder || el.name || '';
        rawContent = val ? (label ? `${label}: ${val}` : val) : label;
      }

      const content = isSecret
        ? '[REDACTED_PASSWORD]'
        : applyTier0Text(rawContent, tier0Mapping, tier0Counters, valueToToken);

      elements.push({
        id,
        type: isSecret ? 'password' : 'input',
        inputType: type,
        content,
        bbox: [r.x, r.y, r.width, r.height],
        sensitive: isSecret,
      });
      continue;
    }

    if (tag === 'IMG') {
      const src = el.currentSrc || el.src || '';
      const image = {
        id,
        type: 'image',
        alt: applyTier0Text(el.alt || '', tier0Mapping, tier0Counters, valueToToken),
        width: el.naturalWidth || el.width || 0,
        height: el.naturalHeight || el.height || 0,
        sameOrigin: (() => { try { return new URL(src).origin === location.origin; } catch { return false; } })(),
        srcHost: (() => { try { return new URL(src).host; } catch { return ''; } })(),
        bbox: [r.x, r.y, r.width, r.height],
      };
      images.push(image);
      elements.push(image);
      continue;
    }

    const bgUrl = findBackgroundImage(el);
    if (bgUrl) {
      elements.push({
        id, type: 'background-image', alt: '',
        srcHost: (() => { try { return new URL(bgUrl, location.href).host; } catch { return ''; } })(),
        bbox: [r.x, r.y, r.width, r.height],
      });
    }

    if (['BUTTON', 'A', 'LABEL', 'H1', 'H2', 'H3', 'H4', 'LI', 'P', 'SPAN', 'DIV'].includes(tag)) {
      const text = directText(el);
      if (text) {
        elements.push({
          id,
          type: tag.toLowerCase(),
          content: applyTier0Text(text, tier0Mapping, tier0Counters, valueToToken),
          bbox: [r.x, r.y, r.width, r.height],
        });
      }
    }
  }

  return {
    url: location.origin + location.pathname,
    title: applyTier0Text(document.title || '', tier0Mapping, tier0Counters, valueToToken),
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    elements,
    images,
    tier0Mapping,
  };
}

export function getElement(targetId) {
  if (!targetId) return null;
  return document.getElementById(targetId) || document.querySelector(`[data-agent-id="${CSS.escape(targetId)}"]`);
}

export function executeCommand(command) {
  const el = getElement(command.targetId);
  if (!el) return { ok: false, reason: 'target_not_found' };

  if (command.action === 'click') {
    const form = el.closest('form');
    const formHasSensitive = !!form?.querySelector('input[type="password"], [data-agent-sensitive="true"]');
    const looksFinal = /submit|pay|purchase|confirm|send|login|sign[ -]?in/i.test(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`);
    if (formHasSensitive && looksFinal) return { ok: false, reason: 'sensitive_submit_requires_confirmation' };
    el.click();
    return { ok: true };
  }

  if (command.action === 'scroll') {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { ok: true };
  }

  if (command.action === 'type') {
    const sensitive = el.dataset.agentSensitive === 'true' || el instanceof HTMLInputElement && /password|otp|pin|secret|token/i.test(el.type || '');
    if (sensitive) return { ok: false, reason: 'sensitive_input_requires_confirmation' };
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    setter?.call(el, String(command.value ?? ''));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }

  return { ok: false, reason: 'unsupported_action' };
}
