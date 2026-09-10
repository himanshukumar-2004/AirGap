import browser from 'webextension-polyfill';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import * as ort from 'onnxruntime-web';
import { inspectTextInImage } from './ocr.js';
import { LlmInference, FilesetResolver as GenAiFilesetResolver } from '@mediapipe/tasks-genai';

const DETECTOR_CLASSES = [
  'face', 'id_card', 'passport', 'credit_card', 'license_plate', 'qr_code',
  'signature', 'medical_document', 'medical_image',
];
const CLASSIFY_PROMPT = `Look at this image. Answer with exactly one word from this list, nothing else:
face, id_card, passport, credit_card, license_plate, qr_code, signature, medical_document, medical_image, none`;

const HIGH_RISK = new Set([
  'id_card', 'passport', 'credit_card', 'license_plate', 'qr_code',
  'signature', 'medical_document', 'medical_image',
]);

let faceModelPromise;
let customSessionPromise;
let customClassesPromise;
let llmPromise;

let faceDetectorPromise;

async function loadFaceModel() {
  if (!faceDetectorPromise) {
    faceDetectorPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        browser.runtime.getURL('mediapipe/wasm')
      );

      return FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: browser.runtime.getURL(
            'models/blazeface/blaze_face_full_range.tflite'
          ),
        },
        runningMode: 'IMAGE',
      });
    })();
  }

  return faceDetectorPromise;
}

async function loadClassifierLLM() {
  if (!llmPromise) {
    llmPromise = (async () => {
      const genai = await GenAiFilesetResolver.forGenAiTasks(
        browser.runtime.getURL('mediapipe/genai-wasm')
      );

      return LlmInference.createFromOptions(genai, {
        baseOptions: {
          modelAssetPath: browser.runtime.getURL(
            'models/privacy-detector/gemma-4-E2B-it-web.task'
          ),
        },
        maxTokens: 8,
        topK: 1,
        temperature: 0,
      });
    })();
  }

  return llmPromise;
}

async function loadCustomDetector() {
  return null;
}

async function loadCustomClasses() {
  if (!customClassesPromise) {
    customClassesPromise = fetch(browser.runtime.getURL('models/privacy-detector/classes.json'))
      .then((r) => r.ok ? r.json() : DETECTOR_CLASSES)
      .catch(() => DETECTOR_CLASSES);
  }
  return customClassesPromise;
}

function canvasFromImage(img, maxSize = 896) {
  const w = img.naturalWidth || img.videoWidth || img.width;
  const h = img.naturalHeight || img.videoHeight || img.height;
  if (!w || !h) throw new Error('image has no decodable dimensions');
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, scaleX: w / canvas.width, scaleY: h / canvas.height, sourceWidth: w, sourceHeight: h };
}

function letterbox(img, size = 640) {
  const ratio = Math.min(size / img.width, size / img.height);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#727272';
  ctx.fillRect(0, 0, size, size);
  const dx = Math.floor((size - w) / 2);
  const dy = Math.floor((size - h) / 2);
  ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, w, h);
  return { canvas, ratio, dx, dy };
}

function toTensor(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const chw = new Float32Array(3 * canvas.width * canvas.height);
  const size = canvas.width * canvas.height;
  let p = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    // YOLOX's default export expects raw 0–255 values in BGR order —
    // no /255 normalization, channels reversed relative to canvas's RGBA.
    chw[p] = rgba[i + 2];           // B
    chw[p + size] = rgba[i + 1];    // G
    chw[p + 2 * size] = rgba[i];    // R
    p += 1;
  }
  return new ort.Tensor('float32', chw, [1, 3, canvas.height, canvas.width]);
}

function decodeYoloX(output, classes, ratio, dx, dy) {
  const tensor = output;
  const data = tensor.data;
  const dims = tensor.dims;
  const count = dims[dims.length - 2];
  const stride = dims[dims.length - 1];
  const detections = [];
  const strides = [8, 16, 32];
  const grids = [];
  for (const s of strides) {
    const g = 640 / s;
    for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) grids.push([x, y, s]);
  }
  for (let i = 0; i < Math.min(count, grids.length); i += 1) {
    const off = i * stride;
    const objectness = data[off + 4];
    let bestClass = -1;
    let bestScore = 0;
    for (let c = 0; c < classes.length; c += 1) {
      const score = objectness * data[off + 5 + c];
      if (score > bestScore) { bestScore = score; bestClass = c; }
    }
    if (bestClass < 0 || bestScore < 0.30) continue;
    const [gx, gy, s] = grids[i];
    const cx = (data[off] + gx) * s;
    const cy = (data[off + 1] + gy) * s;
    const w = Math.exp(Math.min(data[off + 2], 10)) * s;
    const h = Math.exp(Math.min(data[off + 3], 10)) * s;
    const x1 = (cx - w / 2 - dx) / ratio;
    const y1 = (cy - h / 2 - dy) / ratio;
    const x2 = (cx + w / 2 - dx) / ratio;
    const y2 = (cy + h / 2 - dy) / ratio;
    detections.push({
      label: classes[bestClass],
      score: bestScore,
      box: [Math.max(0, x1), Math.max(0, y1), Math.max(0, x2), Math.max(0, y2)],
    });
  }
  return nonMaxSuppression(detections);
}

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  return inter / Math.max(1, areaA + areaB - inter);
}
function nonMaxSuppression(dets) {
  const out = [];
  for (const d of [...dets].sort((a, b) => b.score - a.score)) {
    if (out.some((x) => x.label === d.label && iou(x.box, d.box) > 0.45)) continue;
    out.push(d);
  }
  return out;
}

async function tryCustomDetector(canvas) {
  return [];
}

async function tryGemmaClassifier(canvas) {
  try {
    const llm = await loadClassifierLLM();

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('image_encode_failed')),
        'image/png'
      );
    });

    const bitmap = await createImageBitmap(blob);

    const answer = (
      await llm.generateResponse([
        CLASSIFY_PROMPT,
        bitmap,
      ])
    ).trim().toLowerCase();

    if (!DETECTOR_CLASSES.includes(answer) || answer === 'face' || answer === 'none') {
      return [];
    }

    return [{
      label: answer,
      score: 1,
      box: [0, 0, canvas.width, canvas.height],
      source: 'gemma',
    }];
  } catch (error) {
    return {
      unavailable: true,
      error: String(error),
    };
  }
}

async function tryFaces(img) {
  try {
    const detector = await loadFaceModel();
    const { detections } = detector.detect(img);

    return detections.map((d) => ({
      label: 'face',
      score: d.categories?.[0]?.score ?? 1,
      box: [
        d.boundingBox.originX,
        d.boundingBox.originY,
        d.boundingBox.originX + d.boundingBox.width,
        d.boundingBox.originY + d.boundingBox.height,
      ],
    }));
  } catch (error) {
    return { unavailable: true, error: String(error) };
  }
}

export async function runLocalGenAI(prompt, canvasOrBitmap) {
  const llm = await loadClassifierLLM();
  if (canvasOrBitmap) {
    let bitmap = canvasOrBitmap;
    if (canvasOrBitmap instanceof HTMLCanvasElement) {
      const blob = await new Promise((resolve, reject) => {
        canvasOrBitmap.toBlob((v) => v ? resolve(v) : reject(new Error('encode_failed')), 'image/png');
      });
      bitmap = await createImageBitmap(blob);
    }
    return await llm.generateResponse([prompt, bitmap]);
  }
  return await llm.generateResponse(prompt);
}

export async function inspectImage(img, options = {}) {
  const {
    canvas,
    scaleX,
    scaleY,
    sourceWidth,
    sourceHeight
  } = canvasFromImage(img);

  const [faces, ocr] = await Promise.all([
    tryFaces(img),
    inspectTextInImage(canvas).catch((error) => ({
      available: false,
      items: [],
      sensitiveItems: [],
      error: String(error)
    })),
  ]);

  let custom = [];
  try {
    custom = await tryCustomDetector(canvas);
  } catch {
    custom = [];
  }

  let fallback = [];
  if (options.useLocalLLM && (!Array.isArray(custom) || custom.length === 0)) {
    try {
      fallback = await tryGemmaClassifier(canvas);
    } catch {
      fallback = [];
    }
  }

  const detections = [];

  if (Array.isArray(faces)) {
    detections.push(...faces);
  }

  if (Array.isArray(custom)) {
    detections.push(...custom);
  }

  if (Array.isArray(fallback)) {
    detections.push(...fallback);
  }

  /*
   * OCR boxes use coordinates relative to the downscaled canvas.
   * Convert them back to source-image coordinates.
   */
  for (const item of ocr.sensitiveItems || []) {
    const [x1, y1, x2, y2] = item.box;

    detections.push({
      label: `text_${item.sensitiveType}`,
      score: item.score,
      box: [
        x1 * scaleX,
        y1 * scaleY,
        x2 * scaleX,
        y2 * scaleY
      ],
      source: 'ocr',
      text: item.text
    });
  }

  const warnings = [];

  for (const d of detections) {
    if (
      HIGH_RISK.has(d.label) ||
      d.label.startsWith('text_')
    ) {
      warnings.push({
        type: d.label,
        score: d.score
      });
    } else if (d.label === 'face') {
      warnings.push({
        type: 'face',
        score: d.score
      });
    }
  }

  return {
    sourceWidth,
    sourceHeight,
    faceCount: Array.isArray(faces) ? faces.length : 0,

    detections,

    warnings,

    ocr,

    detectorUnavailable:
      faces?.unavailable === true &&
      ocr?.available !== true,

    ocrUnavailable:
      ocr?.available !== true,

    hasHighRisk:
      detections.some(
        (d) =>
          HIGH_RISK.has(d.label) ||
          d.label.startsWith('text_')
      )
  };
}

export async function redactImage(img, inspection) {
  const { canvas, scaleX, scaleY } = canvasFromImage(img, 1600);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('redaction canvas unavailable');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // If any local detector is unavailable, we cannot claim that unknown visual
  // content is safe. The only privacy-preserving fallback is to send a fully
  // opaque representation after the user explicitly approves the request.
  if (inspection.detectorUnavailable) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '20px sans-serif';
    ctx.fillText('VISUAL CONTENT WITHHELD', 16, 32);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  for (const d of inspection.detections || []) {
    const [x1, y1, x2, y2] = d.box;
    const x = Math.max(0, x1 / scaleX);
    const y = Math.max(0, y1 / scaleY);
    const w = Math.max(1, (x2 - x1) / scaleX);
    const h = Math.max(1, (y2 - y1) / scaleY);

    if (d.label === 'face') {
      const faceCanvas = document.createElement('canvas');
      faceCanvas.width = Math.max(1, Math.round(w));
      faceCanvas.height = Math.max(1, Math.round(h));
      const fctx = faceCanvas.getContext('2d');
      if (fctx) {
        fctx.drawImage(canvas, x, y, w, h, 0, 0, faceCanvas.width, faceCanvas.height);
        ctx.save();
        ctx.filter = 'blur(20px)';
        ctx.drawImage(faceCanvas, 0, 0, faceCanvas.width, faceCanvas.height, x, y, w, h);
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(x, y, w, h);
    } else if (d.source === 'ocr' || d.label?.startsWith('text_')) {
      /*
       * OCR-derived secrets are text.
       * Mask the exact text region rather than the entire image.
       */
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y, w, h);
    } else if (HIGH_RISK.has(d.label)) {
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y, w, h);

      ctx.fillStyle = '#fff';
      ctx.font =
        `${Math.max(10, Math.min(24, h / 4))}px sans-serif`;

      ctx.fillText(
        'REDACTED',
        x + 6,
        y + Math.max(18, h / 2)
      );
    }
  }

  // Re-encoding strips metadata from the transmitted representation.
  return canvas.toDataURL('image/jpeg', 0.82);
}

export function summarizeInspection(inspection) {
  const counts = {};

  for (const d of inspection.detections) {
    const label = d.label.startsWith('text_')
      ? d.label.replace(/^text_/, '')
      : d.label;

    counts[label] =
      (counts[label] || 0) + 1;
  }

  const entries = Object.entries(counts);

  if (!entries.length) {
    return 'No sensitive visual content detected';
  }

  return entries
    .map(
      ([label, count]) =>
        `${count} ${label.replaceAll('_', ' ')}`
    )
    .join(', ');
}