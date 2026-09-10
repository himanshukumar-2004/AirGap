import browser from 'webextension-polyfill';
import { PaddleOCR } from '@paddleocr/paddleocr-js';

let ocrPromise = null;

function localUrl(path) {
  return browser.runtime.getURL(path);
}

async function loadOCR() {
  if (!ocrPromise) {
    ocrPromise = PaddleOCR.create({
      textDetectionModelName: 'PP-OCRv5_mobile_det',
      textDetectionModelAsset: {
        url: localUrl('models/ocr/det.tar')
      },

      textRecognitionModelName: 'en_PP-OCRv5_mobile_rec',
      textRecognitionModelAsset: {
        url: localUrl('models/ocr/rec.tar')
      },

      textDetectionBatchSize: 1,
      textRecognitionBatchSize: 1,

      ortOptions: {
        backend: 'wasm',
        numThreads: 1,
        wasmPaths: localUrl('transformers/')
      }
    });
  }

  return ocrPromise;
}

function polygonToBox(poly) {
  if (!Array.isArray(poly) || poly.length === 0) return null;

  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);

  return [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys)
  ];
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * These rules are deliberately conservative.
 * OCR only discovers text + coordinates.
 * These rules determine which OCR regions are sensitive.
 */
const SENSITIVE_PATTERNS = [
  {
    type: 'email',
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  },

  {
    type: 'phone',
    regex: /(?:\+91[\s-]?)?[6-9]\d{9}\b/
  },

  {
    type: 'aadhaar',
    regex: /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/
  },

  {
    type: 'credit_card',
    regex: /\b(?:\d[ -]*?){13,19}\b/
  },

  {
    type: 'pan',
    regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i
  },

  {
    type: 'password',
    regex: /\b(?:password|passwd|passcode|pwd)\s*[:=-]\s*\S+/i
  },

  {
    type: 'secret',
    regex: /\b(?:secret|api[_ -]?key|access[_ -]?token|auth[_ -]?token)\s*[:=-]\s*\S+/i
  },

  {
    type: 'otp',
    regex: /\b(?:otp|one[\s-]?time[\s-]?password)\s*[:=-]?\s*\d{4,8}\b/i
  }
];

function classifyText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return pattern.type;
    }
  }

  /*
   * Context-sensitive password detection:
   *
   * "Password"
   * "MySecret123"
   *
   * might arrive as two OCR lines rather than one.
   *
   * We cannot safely classify the second line here without
   * contextual grouping, so that enhancement is handled below.
   */

  return null;
}

function isPasswordLabel(text) {
  return /^(password|passwd|passcode|pwd)$/i.test(
    normalizeText(text)
  );
}

function mergeAdjacentPasswordRegions(items) {
  const output = [...items];

  for (let i = 0; i < items.length; i += 1) {
    const current = items[i];

    if (!isPasswordLabel(current.text)) continue;

    const [x1, y1, x2, y2] = current.box;

    for (let j = 0; j < items.length; j += 1) {
      if (i === j) continue;

      const candidate = items[j];
      const [
        cx1,
        cy1,
        cx2,
        cy2
      ] = candidate.box;

      const verticallyClose =
        Math.abs(cy1 - y2) < Math.max(20, (y2 - y1) * 2);

      const horizontallyAligned =
        cx1 >= x1 - 150 &&
        cx1 <= x2 + 150;

      if (verticallyClose && horizontallyAligned) {
        output.push({
          ...candidate,
          sensitiveType: 'password'
        });
      }
    }
  }

  return output;
}

export async function inspectTextInImage(canvas) {
  const ocr = await loadOCR();

  const [result] = await ocr.predict(canvas, {
    textDetLimitSideLen: 960,
    textDetLimitType: 'max',
    textDetThresh: 0.25,
    textDetBoxThresh: 0.45,
    textRecScoreThresh: 0.55
  });

  if (!result) {
    return {
      available: true,
      items: [],
      sensitiveItems: []
    };
  }

  const items = [];

  for (const item of result.items || []) {
    const text = normalizeText(item.text);
    const box = polygonToBox(item.poly);

    if (!text || !box) continue;

    items.push({
      text,
      score: item.score ?? 0,
      box,
      sensitiveType: classifyText(text)
    });
  }

  const contextualItems = mergeAdjacentPasswordRegions(items);

  const sensitiveItems = contextualItems.filter(
    (item) => item.sensitiveType
  );

  return {
    available: true,
    items: contextualItems,
    sensitiveItems,
    metrics: result.metrics || null,
    runtime: result.runtime || null
  };
}

export function summarizeOCR(ocrResult) {
  const counts = {};

  for (const item of ocrResult.sensitiveItems || []) {
    counts[item.sensitiveType] =
      (counts[item.sensitiveType] || 0) + 1;
  }

  const entries = Object.entries(counts);

  if (!entries.length) {
    return 'No sensitive text detected';
  }

  return entries
    .map(([type, count]) =>
      `${count} ${type.replaceAll('_', ' ')}`
    )
    .join(', ');
}