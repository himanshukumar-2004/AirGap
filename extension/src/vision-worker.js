import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
// import { PaddleOCR } from '@paddleocr/paddleocr-js';
import {
  LlmInference,
  FilesetResolver as GenAiFilesetResolver,
} from '@mediapipe/tasks-genai';

const MODEL_BASE = chrome.runtime.getURL('models/');

let faceDetector = null;
// let ocr = null;
let llm = null;

async function initVision() {
  if (faceDetector) return;

  const visionFileset = await FilesetResolver.forVisionTasks(
    chrome.runtime.getURL('mediapipe/wasm')
  );

  faceDetector = await FaceDetector.createFromOptions(
    visionFileset,
    {
      baseOptions: {
        modelAssetPath: chrome.runtime.getURL(
          'models/blazeface/blaze_face_full_range.tflite'
        ),
      },
      runningMode: 'IMAGE',
    }
  );

  // ocr = await PaddleOCR.create({
  //   detModelPath: `${MODEL_BASE}ocr/det.tar`,
  //   recModelPath: `${MODEL_BASE}ocr/rec.tar`,
  //   useWasm: true,
  // });
}

async function inspectImage(imageDataUrl) {
  await initVision();

  // Put your existing image-analysis logic here.
  // For now this safely initializes the local engines.
  return {
    status: 'success',
    imageDataUrl,
    faceCount: 0,
    text: [],
  };
}

async function redactImage(imageDataUrl, inspection) {
  // Put your existing redaction logic here.
  return {
    status: 'success',
    imageDataUrl,
    inspection,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'vision-worker') {
    return false;
  }

  if (message.type === 'INSPECT_IMAGE') {
    inspectImage(message.imageDataUrl)
      .then((result) => {
        sendResponse({
          success: true,
          result,
        });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error: String(error),
        });
      });

    return true;
  }

  if (message.type === 'REDACT_IMAGE') {
    redactImage(message.imageDataUrl, message.inspection)
      .then((result) => {
        sendResponse({
          success: true,
          result,
        });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error: String(error),
        });
      });

    return true;
  }

  return false;
});