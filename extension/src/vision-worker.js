import { inspectImage as runInspectImage, redactImage as runRedactImage, summarizeInspection, runLocalGenAI } from './vision.js';
import { summarizeOCR } from './ocr.js';

function dataUrlToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Failed to decode image: ' + String(e)));
    img.src = dataUrl;
  });
}

async function inspectImage(imageDataUrl) {
  const img = await dataUrlToImage(imageDataUrl);
  const inspection = await runInspectImage(img);
  const summary = summarizeInspection(inspection);
  const ocrSummary = inspection.ocr ? summarizeOCR(inspection.ocr) : '';

  return {
    status: 'success',
    ...inspection,
    summary,
    ocrSummary,
  };
}

async function redactImage(imageDataUrl, inspection) {
  const img = await dataUrlToImage(imageDataUrl);
  const redactedDataUrl = await runRedactImage(img, inspection);
  return {
    status: 'success',
    redactedDataUrl,
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

  if (message.type === 'RUN_LOCAL_LLM') {
    (async () => {
      let canvas = null;
      if (message.imageDataUrl) {
        const img = await dataUrlToImage(message.imageDataUrl);
        canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
      }
      return await runLocalGenAI(message.prompt, canvas);
    })()
      .then((response) => sendResponse({ success: true, response }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));

    return true;
  }

  return false;
});