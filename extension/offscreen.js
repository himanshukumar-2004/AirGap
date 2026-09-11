// Silence benign MediaPipe and ONNX Runtime C++/Wasm initialization warnings
// so Chrome does not record them as extension errors.
globalThis.custom_dbg = function (text) {
  if (
    typeof text === 'string' &&
    (text.includes('gl_context') ||
      text.includes('OpenGL') ||
      text.includes('inference_feedback_manager') ||
      text.includes('XNNPACK') ||
      text.includes('feedback_manager'))
  ) {
    return;
  }
  console.log('[MediaPipe]', text);
};

const _origWarn = console.warn;
console.warn = function (...args) {
  const msg = args.map(String).join(' ');
  if (
    msg.includes('OpenGL error checking is disabled') ||
    msg.includes('inference_feedback_manager') ||
    msg.includes('CleanUnusedInitializersAndNodeArgs') ||
    msg.includes('Removing initializer')
  ) {
    return;
  }
  _origWarn.apply(console, args);
};

import './src/vision-worker.js';
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.useWasmCache = false;
env.localModelPath = chrome.runtime.getURL('models/');
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('transformers/');
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.logLevel = 'error';

let nerPipeline = null;
let nerLoadAttempts = 0;
let isInitialized = false;

async function getNerPipeline() {
  if (nerPipeline) return nerPipeline;

  if (nerLoadAttempts >= 2) {
    return null;
  }

  nerLoadAttempts += 1;

  try {
    nerPipeline = await pipeline(
      'token-classification',
      'ner',
      {
        quantized: true,
        device: 'wasm'
      }
    );

    return nerPipeline;
  } catch (error) {
    console.error('Failed to initialize NER:', error);
    return null;
  }
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

async function runTier1(elements) {
  const ner = await getNerPipeline();

  const mapping = {};
  const counters = {};
  const valueToToken = new Map();

  if (!ner) {
    return {
      mapping,
      degraded: true,
      elements
    };
  }

  for (const el of elements) {
    if (
      !el.content ||
      ![
        'text',
        'p',
        'span',
        'div',
        'label',
        'h1',
        'h2',
        'h3',
        'li',
        'button',
        'a'
      ].includes(el.type)
    ) {
      continue;
    }

    const entities = await ner(el.content);

    el.content = mergeEntityMappings(
      el.content,
      entities,
      mapping,
      counters,
      valueToToken
    );
  }

  return {
    mapping,
    degraded: false,
    elements
  };
}

async function initVisionAgent() {
  if (isInitialized) return;

  await getNerPipeline();

  isInitialized = true;

  console.log(
    'Vision/privacy pipeline initialized inside offscreen document.'
  );
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message.target !== 'offscreen') {
      return false;
    }

    if (message.type === 'PROCESS_TIER1') {
      runTier1(message.elements)
        .then((result) => {
          sendResponse({
            success: true,
            ...result
          });
        })
        .catch((error) => {
          sendResponse({
            success: false,
            error: String(error)
          });
        });

      return true;
    }

    if (message.type === 'INIT_VISION') {
      initVisionAgent()
        .then(() => {
          sendResponse({
            success: true
          });
        })
        .catch((error) => {
          sendResponse({
            success: false,
            error: String(error)
          });
        });

      return true;
    }

    return false;
  }
);