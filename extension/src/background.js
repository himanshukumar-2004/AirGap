import browser from 'webextension-polyfill';
import { pipeline, env } from '@huggingface/transformers';
import { encryptMapping, decryptMapping, getOrCreateKey } from './crypto.js';
import { containsSensitiveMarker } from './regexRules.js';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = browser.runtime.getURL('models/');
env.backends.onnx.wasm.wasmPaths = browser.runtime.getURL('transformers/');

const BACKEND_URL = 'http://localhost:8000';
let nerPipeline = null;
let inFlight = false;
let nerLoadAttempts = 0;

// Add organization-specific sensitive hosts here. Do not block localhost by default;
// it is commonly used for local development and the backend itself is localhost:8000.
const DEFAULT_DOMAIN_BLOCKS = [
  /(^|\.)internal\.example$/i,
];

async function getNerPipeline() {
  if (nerPipeline) return nerPipeline;
  if (nerLoadAttempts >= 2) return null; // stop retrying forever, not silently forever either
  nerLoadAttempts++;
  try {
    nerPipeline = await pipeline('token-classification', 'ner', { quantized: true, device: 'wasm' });
    return nerPipeline;
  } catch {
    return null;
  }
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

async function runTier1(elements) {
  const ner = await getNerPipeline();
  const mapping = {};
  const counters = {};
  if (!ner) return { mapping, degraded: true }; // surfaced below, not swallowed
  for (const el of elements) {
    if (!el.content || !['text','p','span','div','label','h1','h2','h3','li','button','a'].includes(el.type)) continue;
    const entities = await ner(el.content);
    el.content = mergeEntityMappings(el.content, entities, mapping, counters);
  }
  return { mapping, degraded: false };
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
  } finally {
    clearTimeout(timer);
  }
}

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message.action === 'isDomainBlocked') {
    return domainBlocked(message.host || '');
  }

  if (message.action === 'processContext') {
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
      const {
        mapping: mappings,
        degraded,
      } = await runTier1(payload.elements);
      await storeMappings(mappings);

      // Never send actual image src values. The backend only gets inventory/metadata.
      for (const el of payload.elements) delete el.src;
      const response = await callBackend('/orchestrate', {
        url: payload.url,
        title: payload.title,
        viewport: payload.viewport,
        elements: payload.elements,
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
  }

  if (message.action === 'sendApprovedImage') {
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
  if (tabId) await browser.tabs.sendMessage(tabId, { action: 'executeCommands', commands: restored });
  return { status: 'success', commands: restored };
}
