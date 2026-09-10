// offscreen.js

// Initialize your MediaPipe or Vision pipelines here safely (document & canvas exist here)
let isInitialized = false;

async function initVisionAgent() {
  if (isInitialized) return;
  
  // Example: Initialize your MediaPipe/WASM vision tasks here
  // const wasmPath = chrome.runtime.getURL('mediapipe/wasm/');
  // ... initialize detector ...

  isInitialized = true;
  console.log("Vision pipeline initialized inside offscreen document.");
}

// Listen for messages dispatched by background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages not intended for offscreen processing
  if (message.target !== 'offscreen') return false;

  if (message.type === 'PROCESS_FRAME') {
    handleInference(message.payload)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));

    return true; // Keeps the message channel open for async response
  }
});

async function handleInference(payload) {
  await initVisionAgent();

  // Perform detection/inference using the payload (e.g. image bitmap, base64 data)
  return {
    status: "detected",
    detections: []
  };
}