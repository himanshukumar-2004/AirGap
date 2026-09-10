import browser from 'webextension-polyfill';
import { extractPageState, executeCommand, getElement } from './dom.js';
import {inspectImage, redactImage, summarizeInspection} from './vision-client.js';
import { showPrivacyCheck } from './privacy-ui.js';
// import { extractPageContext } from './dom.js';

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms)
    ),
  ]);
}

async function inspectAndGateImage(imageId) {
  const image = getElement(imageId);
  if (!(image instanceof HTMLImageElement)) throw new Error('requested image is not available');
  if (!image.complete) await image.decode().catch(() => {});

  const inspection = await withTimeout(inspectImage(image), 8000, 'vision_inspection').catch((err) => ({
  detectorUnavailable: true, ocrUnavailable: true, detections: [], warnings: [], error: String(err),
  }));
  const summary = summarizeInspection(inspection);
  const domainBlocked = await browser.runtime.sendMessage({ action: 'isDomainBlocked', host: location.host });
  const approved = await showPrivacyCheck({ imageAlt: image.alt, summary, domainBlocked });
  if (!approved) return { approved: false };

  const redactedDataUrl = await redactImage(image, inspection);
  if (!redactedDataUrl?.startsWith('data:image/')) throw new Error('redaction failed');
  return { approved: true, imageId, redactedDataUrl, inspection };
}

browser.runtime.onMessage.addListener(async (message) => {
  if (message.action === 'runAgent') {
    const payload = extractPageState();
    return browser.runtime.sendMessage({ action: 'processContext', payload, userPrompt: message.userPrompt });
  }

  if (message.action === 'requestVisualContext') {
    try {
      const result = await inspectAndGateImage(message.imageId);
      if (!result.approved) return { approved: false };
      return browser.runtime.sendMessage({
        action: 'sendApprovedImage', ...result,
        userPrompt: message.userPrompt,
        pageContext: extractPageState(),
      });
    } catch (error) {
      return { approved: false, error: String(error) };
    }
  }

  if (message.action === 'executeCommands') {
    const results = [];
    for (const command of message.commands || []) {
      const result = executeCommand(command);
      if (result.reason === 'sensitive_input_requires_confirmation' || result.reason === 'sensitive_submit_requires_confirmation') {
        const proceed = await showPrivacyCheck({
          imageAlt: result.reason === 'sensitive_submit_requires_confirmation' ? `Agent wants to submit ${command.targetId}` : `Agent wants to type into ${command.targetId}`,
          summary: result.reason === 'sensitive_submit_requires_confirmation' ? 'This is a final action in a form containing a sensitive field.' : 'No value has been entered yet.',
          domainBlocked: false,
        });
        if (!proceed) { results.push({ ok: false, reason: 'user_denied' }); continue; }
        const el = getElement(command.targetId);
        if (!el) { results.push({ ok: false, reason: 'target_not_found' }); continue; }
        if (result.reason === 'sensitive_submit_requires_confirmation') el.click();
        else {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
          setter?.call(el, String(command.value ?? ''));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        results.push({ ok: true, confirmed: true });
      } else results.push(result);
    }
    return { results };
  }
});
