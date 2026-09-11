import browser from 'webextension-polyfill';
import { encryptMapping, decryptMapping, getOrCreateKey } from './crypto.js';
import { containsSensitiveMarker, applyTier0Text, rehydrate } from './regexRules.js';

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

function groupEntities(tokens) {
  const groups = [];
  let curr = null;

  for (const t of tokens) {
    const isSubword = t.word.startsWith('##');
    const cleanWord = isSubword ? t.word.slice(2) : t.word;
    const tag = t.entity ? t.entity.replace(/^[BI]-/, '') : (t.entity_group || '');

    if (curr && isSubword) {
      curr.word += cleanWord;
      curr.indices.push(t.index);
      continue;
    }

    if (curr && (t.entity?.startsWith('I-') || (t.entity?.startsWith('B-') && tag === curr.tag && t.index === curr.indices[curr.indices.length - 1] + 1))) {
      curr.word += ' ' + cleanWord;
      curr.indices.push(t.index);
      continue;
    }

    if (curr) {
      groups.push(curr);
    }
    curr = { tag, word: cleanWord, indices: [t.index] };
  }
  if (curr) groups.push(curr);
  return groups;
}

function escapeRegex(string) {
  return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

function mergeEntityMappings(text, entities, mapping, counters, valueToToken = new Map()) {
  let out = text;
  const groups = groupEntities(entities);

  // Find all email addresses in text to prevent corrupting email domains
  const emailMatches = out.match(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/gu) || [];

  for (const group of groups) {
    const raw = String(group.word || '').trim();
    if (!raw || raw.length < 2) continue;

    const g = group.tag.toUpperCase();
    let bucket = null;
    if (g.includes('PER')) {
      bucket = 'PERSON';
    } else if (g.includes('ORG')) {
      bucket = 'ORG';
    } else if (g.includes('LOC')) {
      bucket = 'LOCATION';
    }

    // Do not redact MISC or unclassified non-PII entities
    if (!bucket) continue;

    // Do not redact if raw is part of an existing email address
    const inEmail = emailMatches.some(em => em.toLowerCase().includes(raw.toLowerCase()));
    if (inEmail) continue;

    let token;
    if (valueToToken && valueToToken.has(raw)) {
      token = valueToToken.get(raw);
    } else {
      const n = (counters[bucket] = (counters[bucket] || 0) + 1);
      token = `[${bucket}_${n}]`;
      if (valueToToken) valueToToken.set(raw, token);
    }

    // Replace with word boundary to avoid partial token replacement
    const wordRx = new RegExp(`(?<!\\w)${escapeRegex(raw)}(?!\\w)`, 'g');
    if (wordRx.test(out)) {
      out = out.replace(wordRx, token);
      mapping[token] = raw;
      const bareToken = `[${bucket}]`;
      if (!mapping[bareToken]) {
        mapping[bareToken] = raw;
      }
    } else if (out.includes(raw)) {
      out = out.split(raw).join(token);
      mapping[token] = raw;
      const bareToken = `[${bucket}]`;
      if (!mapping[bareToken]) {
        mapping[bareToken] = raw;
      }
    }
  }
  return out;
}

async function storeMappings(newMappings, reset = false) {
  const key = await getOrCreateKey();
  const existing = reset ? {} : await decryptMapping(key).catch(() => ({}));
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
    console.log(`[Privacy Gateway Service Worker -> ${path}] Outgoing Request Payload:`, body);
    const response = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errDetail = await response.text().catch(() => '');
      console.error(`Backend error ${response.status}:`, errDetail);
      throw new Error(`backend_${response.status}: ${errDetail}`);
    }
    const data = await response.json();
    console.log(`[Privacy Gateway Service Worker <- ${path}] Incoming Response:`, data);
    return data;
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Cannot connect to backend server at ${BACKEND_URL}. Ensure the backend is running (python main.py).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function bufferToDataUrl(buffer, mimeType = 'image/png') {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'fetchImageDataUrl') {
    return (async () => {
      try {
        const response = await fetch(message.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const mimeType = response.headers.get('content-type') || 'image/png';
        const buffer = await response.arrayBuffer();
        return { dataUrl: bufferToDataUrl(buffer, mimeType) };
      } catch (err) {
        return { error: String(err) };
      }
    })();
  }

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
        const tier0Mapping = payload.tier0Mapping || {};
        const promptCounters = {};
        const valueToToken = new Map();

        // Populate valueToToken with existing tier0 mappings to deduplicate identical tokens
        for (const [tok, val] of Object.entries(tier0Mapping)) {
          if (!tok.includes('_')) continue;
          valueToToken.set(val, tok);
        }

        // Sanitize user prompt to prevent raw PII from leaving the browser
        const sanitizedPrompt = applyTier0Text(
          String(message.userPrompt || '').slice(0, 2_000),
          tier0Mapping,
          promptCounters,
          valueToToken
        );

        // Store tier0 mappings (reset = true starts a fresh session mapping for this run)
        await storeMappings(tier0Mapping, true);

        // Run Tier 1 NER locally in the offscreen document.
        const tier1 = await runTier1(payload.elements);

        const tier1Mapping = tier1.mapping || {};
        const degraded = tier1.degraded;

        // Merge Tier 1 NER mappings into the local encrypted storage
        await storeMappings(tier1Mapping, false);

        // Never send actual image src values.
        for (const el of tier1.elements) {
          delete el.src;
        }

        const backendPayload = {
          url: payload.url,
          title: payload.title,
          viewport: payload.viewport,
          elements: tier1.elements,
          images: payload.images?.map(({ src, ...safe }) => safe) || [],
          userPrompt: sanitizedPrompt,
        };

        const response = await callBackend('/orchestrate', backendPayload);
        const result = await handleBackendResponse(
          response,
          sender.tab?.id,
          message.userPrompt
        );
        return {
          ...result,
          tier1Degraded: degraded,
          sentPayload: backendPayload,
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
        if (message.pageContext?.tier0Mapping) {
          await storeMappings(message.pageContext.tier0Mapping, false);
        }
        const sanitizedPrompt = applyTier0Text(String(message.userPrompt || '').slice(0, 2_000));
        const pageContext = {
          ...(message.pageContext || {}),
          userPrompt: sanitizedPrompt,
        };
        const backendPayload = {
          userPrompt: sanitizedPrompt,
          imageId: message.imageId,
          imageDataUrl: message.redactedDataUrl,
          inspection: message.inspection,
          pageContext,
        };
        const response = await callBackend('/orchestrate-with-image', backendPayload);
        const result = await handleBackendResponse(response, sender.tab?.id, message.userPrompt);
        return {
          ...result,
          sentPayload: {
            ...backendPayload,
            imageDataUrl: `${backendPayload.imageDataUrl.slice(0, 50)}... [${backendPayload.imageDataUrl.length} chars]`,
          },
        };
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
    return {
      status: 'success',
      requestVisualContext: true,
      imageId: response.imageId,
    };
  }

  const mappingKey = await getOrCreateKey();
  const mapping = await decryptMapping(mappingKey).catch(() => ({}));
  const commands = validateCommands(response.commands, response.elements || response._elements || []);
  // Rehydrate placeholders only after the server response is back on the device.
  const restored = commands.map((cmd) => {
    if (typeof cmd.value === 'string') {
      return { ...cmd, value: rehydrate(cmd.value, mapping) };
    }
    return cmd;
  });
  let message = response.message || '';
  if (typeof message === 'string') {
    message = rehydrate(message, mapping);
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
