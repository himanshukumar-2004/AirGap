function imageToDataUrl(img) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas_context_unavailable'));
        return;
      }

      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    } catch (error) {
      reject(error);
    }
  });
}

export async function inspectImage(img) {
  const imageDataUrl = await imageToDataUrl(img);

  return await chrome.runtime.sendMessage({
    action: 'inspectImage',
    imageDataUrl,
  });
}

export async function redactImage(img, inspection) {
  const imageDataUrl = await imageToDataUrl(img);

  return await chrome.runtime.sendMessage({
    action: 'redactImage',
    imageDataUrl,
    inspection,
  });
}

export function summarizeInspection(inspection) {
  if (!inspection) return '';

  if (typeof inspection.summary === 'string') {
    return inspection.summary;
  }

  return JSON.stringify(inspection);
}