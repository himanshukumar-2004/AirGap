function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function imageToDataUrl(img) {
  if (img._cachedDataUrl) {
    return img._cachedDataUrl;
  }

  const src = img.currentSrc || img.src;

  // 1. If it's already a data URL, return it directly
  if (src && src.startsWith('data:image/')) {
    img._cachedDataUrl = src;
    return src;
  }

  // 2. Try drawing to an in-memory canvas and exporting (fastest for same-origin or CORS images)
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width || 300;
    canvas.height = img.naturalHeight || img.height || 150;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      img._cachedDataUrl = dataUrl;
      return dataUrl;
    }
  } catch (err) {
    // Tainted canvas error: fall through to fetch strategies
  }

  // 3. Try fetching directly in page context (works for blob: URLs or CORS-enabled images)
  if (src) {
    try {
      const resp = await fetch(src);
      if (resp.ok) {
        const blob = await resp.blob();
        const dataUrl = await blobToDataUrl(blob);
        img._cachedDataUrl = dataUrl;
        return dataUrl;
      }
    } catch {
      // Content script fetch failed (e.g. strict CORS), fall through
    }

    // 4. Request the background service worker to fetch with host_permissions (<all_urls>)
    try {
      const bgResp = await chrome.runtime.sendMessage({
        action: 'fetchImageDataUrl',
        url: src,
      });
      if (bgResp?.dataUrl) {
        img._cachedDataUrl = bgResp.dataUrl;
        return bgResp.dataUrl;
      }
      if (bgResp?.error) {
        console.warn('Background fetchImageDataUrl failed:', bgResp.error);
      }
    } catch (bgErr) {
      console.warn('Could not contact background for fetchImageDataUrl:', bgErr);
    }
  }

  throw new Error('Unable to convert image to data URL (cross-origin protected)');
}

export async function inspectImage(img) {
  const imageDataUrl = await imageToDataUrl(img);

  const res = await chrome.runtime.sendMessage({
    action: 'inspectImage',
    imageDataUrl,
  });

  const inspection = res?.result || res || {};
  inspection.__imageDataUrl = imageDataUrl;
  return inspection;
}

export async function redactImage(img, inspection) {
  const imageDataUrl = inspection?.__imageDataUrl || await imageToDataUrl(img);

  const res = await chrome.runtime.sendMessage({
    action: 'redactImage',
    imageDataUrl,
    inspection,
  });

  if (res?.result?.redactedDataUrl) {
    return res.result.redactedDataUrl;
  }
  if (res?.redactedDataUrl) {
    return res.redactedDataUrl;
  }
  if (typeof res === 'string' && res.startsWith('data:image/')) {
    return res;
  }
  throw new Error('redaction failed: invalid worker response');
}


export function summarizeInspection(inspection) {
  if (!inspection) return '';

  if (typeof inspection.summary === 'string') {
    return inspection.summary;
  }

  return JSON.stringify(inspection);
}