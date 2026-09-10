import browser from 'webextension-polyfill';
import { encryptMapping, decryptMapping, getOrCreateKey } from './crypto.js';
import { containsSensitiveMarker } from './regexRules.js';

const BACKEND_URL = 'http://localhost:8000';
let inFlight = false;

// Add organization-specific sensitive hosts here. Do not block localhost by default;
// it is commonly used for local development and the backend itself is localhost:8000.
const DEFAULT_DOMAIN_BLOCKS = [
  /(^|\.)internal\.example$/i,
];

let creatingOffscreenPromise = null;
async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')]
  });

  if (contexts.length > 0) {
    return;
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification:
      'Run local privacy-preserving machine learning inference.'
  });
  await creatingOffscreenPromise;
  creatingOffscreenPromise = null;
  await new Promise((r) => setTimeout(r, 150));
}

async function runVisionWorker(message) {
  await ensureOffscreenDocument();

  return await chrome.runtime.sendMessage({
    target: 'vision-worker',
    ...message,
  });
}

async function runTier1InOffscreen(elements) {
  await ensureOffscreenDocument();

  return await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'PROCESS_TIER1',
    elements
  });
}

async function runTier1(elements) {
  const result = await runTier1InOffscreen(elements);

  if (!result || result.success === false) {
    console.warn('Tier 1 NER failed:', result?.error);
    return {
      mapping: {},
      degraded: true,
      elements
    };
  }

  return {
    mapping: result.mapping || {},
    degraded: Boolean(result.degraded),
    elements: result.elements || elements
  };
}

function mergeEntityMappings(text, entities, mapping, counters) {
  let out = text;
  for (const ent of entities) {
    const raw = String(ent.word || '').replace(/^##/u, '');
    if (!raw || raw.length < 2) continue;
    const group = String(ent.entity_group || ent.entity || '').toUpperCase();
    let bucket = 'ENTITY';
    if (group.includes('PER')) bucket = 'PERSON';
    else if (group.includes('ORG')) bucket = 'ORG';
    else if (group.includes('LOC')) bucket = 'LOCATION';
    const n = (counters[bucket] = (counters[bucket] || 0) + 1);
    const token = `[${bucket}_${n}]`;
    if (out.includes(raw)) {
      out = out.split(raw).join(token);
      mapping[token] = raw;
    }
  }
  return out;
}

async function storeMappings(newMappings) {
  const key = await getOrCreateKey();
  const existing = await decryptMapping(key).catch(() => ({}));
  const merged = { ...existing, ...newMappings };
  await encryptMapping(key, merged);
  return merged;
}

function domainBlocked(host) {
  return DEFAULT_DOMAIN_BLOCKS.some((rule) => rule.test(host));
}

function validateCommands(commands, elements) {
  const ids = new Set(elements.map((e) => e.id));
  return (Array.isArray(commands) ? commands : []).filter((cmd) => {
    if (!ids.has(cmd.targetId)) return false;
    if (!['click', 'type', 'scroll'].includes(cmd.action)) return false;
    if (cmd.action === 'type' && typeof cmd.value !== 'string') return false;
    return true;
  }).slice(0, 8);
}

async function callBackend(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`backend_${response.status}`);
    return await response.json();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Cannot connect to backend server at ${BACKEND_URL}. Ensure the backend is running (python main.py).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'isDomainBlocked') {
    return Promise.resolve(domainBlocked(message.host || ''));
  }

  if (message.action === 'inspectImage') {
    return runVisionWorker({
      type: 'INSPECT_IMAGE',
      imageDataUrl: message.imageDataUrl,
    });
  }

  if (message.action === 'redactImage') {
    return runVisionWorker({
      type: 'REDACT_IMAGE',
      imageDataUrl: message.imageDataUrl,
      inspection: message.inspection,
    });
  }

  if (message.action === 'processContext') {
    return (async () => {
      if (inFlight) return { status: 'busy' };
      const host = (() => {
        try {
          return new URL(message.payload.url).host;
        } catch {
          return '';
        }
      })();

      if (domainBlocked(host)) {
        return {
          status: 'blocked',
          reason: 'domain_policy',
        };
      }
      inFlight = true;
      try {
        const payload = structuredClone(message.payload);

        // Run Tier 1 NER locally in the offscreen document.
        const tier1 = await runTier1(payload.elements);

        const mappings = tier1.mapping;
        const degraded = tier1.degraded;

        // Store the mapping locally so the original values can be restored
        // only after the backend responds.
        await storeMappings(mappings);

        // Never send actual image src values.
        for (const el of tier1.elements) {
          delete el.src;
        }

        const response = await callBackend('/orchestrate', {
          url: payload.url,
          title: payload.title,
          viewport: payload.viewport,
          elements: tier1.elements,
          images: payload.images?.map(({ src, ...safe }) => safe) || [],
          userPrompt: String(message.userPrompt || '').slice(0, 2_000),
        });
        const result = await handleBackendResponse(
          response,
          sender.tab?.id,
          message.userPrompt
        );
        return {
          ...result,
          tier1Degraded: degraded,
        };
      } catch (error) {
        return { status: 'error', error: String(error) };
      } finally {
        inFlight = false;
      }
    })();
  }

  if (message.action === 'sendApprovedImage') {
    return (async () => {
      try {
        const response = await callBackend('/orchestrate-with-image', {
          userPrompt: String(message.userPrompt || '').slice(0, 2_000),
          imageId: message.imageId,
          imageDataUrl: message.redactedDataUrl,
          inspection: message.inspection,
        });
        return await handleBackendResponse(response, sender.tab?.id, message.userPrompt);
      } catch (error) {
        return { status: 'error', error: String(error) };
      }
    })();
  }

  return undefined;
});

async function handleBackendResponse(response, tabId, userPrompt) {
  if (!response || response.status === 'error') return response || { status: 'error' };

  if (response.requestVisualContext) {
    if (!tabId || !response.imageId) return { status: 'error', error: 'invalid_visual_request' };
    return browser.tabs.sendMessage(tabId, {
      action: 'requestVisualContext',
      imageId: response.imageId,
      userPrompt,
    });
  }

  const mappingKey = await getOrCreateKey();
  const mapping = await decryptMapping(mappingKey).catch(() => ({}));
  const commands = validateCommands(response.commands, response.elements || response._elements || []);
  // Rehydrate placeholders only after the server response is back on the device.
  const restored = commands.map((cmd) => {
    if (typeof cmd.value === 'string') {
      let value = cmd.value;
      for (const [token, original] of Object.entries(mapping)) value = value.split(token).join(original);
      return { ...cmd, value };
    }
    return cmd;
  });
  let message = response.message || '';
  if (typeof message === 'string') {
    for (const [token, original] of Object.entries(mapping)) {
      message = message.split(token).join(original);
    }
  }

  let executionResults = [];
  if (tabId && restored.length > 0) {
    const execRes = await browser.tabs.sendMessage(tabId, { action: 'executeCommands', commands: restored });
    executionResults = execRes?.results || [];
  }

  return {
    status: 'success',
    message,
    commands: restored,
    executionResults,
  };
}
