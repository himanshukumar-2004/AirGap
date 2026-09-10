import './src/vision-worker.js';
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.useWasmCache = false;
env.localModelPath = chrome.runtime.getURL('models/');
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('transformers/');
env.backends.onnx.wasm.numThreads = 1;

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

function mergeEntityMappings(text, entities, mapping, counters, valueToToken = new Map()) {
  let out = text;

  for (const ent of entities) {
    const raw = String(ent.word || '').replace(/^##/u, '');

    if (!raw || raw.length < 2) continue;

    const group = String(
      ent.entity_group || ent.entity || ''
    ).toUpperCase();

    let bucket = 'ENTITY';

    if (group.includes('PER')) {
      bucket = 'PERSON';
    } else if (group.includes('ORG')) {
      bucket = 'ORG';
    } else if (group.includes('LOC')) {
      bucket = 'LOCATION';
    }

    let token;
    if (valueToToken && valueToToken.has(raw)) {
      token = valueToToken.get(raw);
    } else {
      const n = (counters[bucket] = (counters[bucket] || 0) + 1);
      token = `[${bucket}_${n}]`;
      if (valueToToken) valueToToken.set(raw, token);
    }

    if (out.includes(raw)) {
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