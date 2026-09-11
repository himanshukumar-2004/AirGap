import browser from 'webextension-polyfill';
import { extractPageState, executeCommand, getElement } from './dom.js';
import { inspectImage, redactImage, summarizeInspection } from './vision-client.js';
import { showPrivacyCheck, showAgentHud } from './privacy-ui.js';
import { rehydrate } from './regexRules.js';

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

  const inspection = await withTimeout(inspectImage(image), 25000, 'vision_inspection').catch((err) => ({
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

function handleFinalResult(userPrompt, result, localMapping = {}) {
  if (!result || result.status === 'error') {
    const errorMsg = result?.error || 'Unknown error occurred';
    showAgentHud({
      title: 'Privacy Agent Error',
      message: errorMsg,
      isError: true,
      canClose: true,
    });
    chrome.storage.local.set({
      lastAgentRun: {
        prompt: userPrompt,
        status: 'error',
        error: errorMsg,
        timestamp: Date.now(),
      },
    });
    return;
  }

  if (result.status === 'blocked') {
    showAgentHud({
      title: 'Privacy Policy',
      message: 'Action was blocked by domain privacy policy.',
      isError: true,
      canClose: true,
    });
    chrome.storage.local.set({
      lastAgentRun: {
        prompt: userPrompt,
        status: 'blocked',
        timestamp: Date.now(),
      },
    });
    return;
  }

  let message = result.message || (result.commands?.length > 0 ? 'Commands executed successfully.' : 'Page analyzed. No actions required.');
  if (localMapping && Object.keys(localMapping).length > 0) {
    message = rehydrate(message, localMapping);
  }

  const commands = (result.commands || []).map((cmd) => {
    if (cmd && typeof cmd.value === 'string' && localMapping && Object.keys(localMapping).length > 0) {
      return { ...cmd, value: rehydrate(cmd.value, localMapping) };
    }
    return cmd;
  });

  if (result.sentPayload) {
    console.log(
      '%c[Privacy Gateway] Sanitized Backend Request Payload:',
      'color: #2563eb; font-weight: bold; font-size: 13px;',
      result.sentPayload
    );
  }

  showAgentHud({
    title: 'Agent Response',
    status: result.tier1Degraded ? '⚠ Name detection unavailable — only pattern PII masked.' : 'Completed',
    message,
    actions: commands,
    sentPayload: result.sentPayload,
    canClose: true,
  });

  chrome.storage.local.set({
    lastAgentRun: {
      prompt: userPrompt,
      status: 'completed',
      message,
      commands,
      sentPayload: result.sentPayload,
      tier1Degraded: Boolean(result.tier1Degraded),
      timestamp: Date.now(),
    },
  });
}

async function runAgentFlow(userPrompt) {
  showAgentHud({
    title: 'Privacy Agent',
    status: 'Reading page & sanitizing text locally...',
    canClose: false,
  });

  try {
    const payload = extractPageState();
    const result = await browser.runtime.sendMessage({
      action: 'processContext',
      payload,
      userPrompt,
    });

    if (!result || result.status === 'error' || result.status === 'blocked') {
      handleFinalResult(userPrompt, result, payload.tier0Mapping);
      return;
    }

    if (result.requestVisualContext) {
      showAgentHud({
        title: 'Visual Privacy Gate',
        status: 'Inspecting image locally...',
        canClose: false,
      });

      const gated = await inspectAndGateImage(result.imageId);
      if (!gated.approved) {
        showAgentHud({
          title: 'Privacy Agent',
          status: 'Image transmission kept private by user.',
          canClose: true,
        });
        chrome.storage.local.set({
          lastAgentRun: {
            prompt: userPrompt,
            status: 'denied',
            message: 'Image transmission kept private by user.',
            timestamp: Date.now(),
          },
        });
        return;
      }

      showAgentHud({
        title: 'Privacy Agent',
        status: 'Image locally redacted. Requesting agent response from gateway...',
        canClose: false,
      });

      const approvedContext = extractPageState();
      const finalResult = await browser.runtime.sendMessage({
        action: 'sendApprovedImage',
        ...gated,
        userPrompt,
        pageContext: approvedContext,
      });

      handleFinalResult(userPrompt, {
        ...finalResult,
        tier1Degraded: result.tier1Degraded,
      }, approvedContext.tier0Mapping);
      return;
    }

    handleFinalResult(userPrompt, result, payload.tier0Mapping);
  } catch (error) {
    const errText = String(error?.message || error);
    showAgentHud({
      title: 'Privacy Agent Error',
      message: errText,
      isError: true,
      canClose: true,
    });
    chrome.storage.local.set({
      lastAgentRun: {
        prompt: userPrompt,
        status: 'error',
        error: errText,
        timestamp: Date.now(),
      },
    });
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'runAgent') {
    runAgentFlow(message.userPrompt);
    return Promise.resolve({ status: 'started' });
  }

  if (message.action === 'requestVisualContext') {
    return (async () => {
      try {
        showAgentHud({
          title: 'Visual Privacy Gate',
          status: 'Inspecting image locally...',
          canClose: false,
        });

        const result = await inspectAndGateImage(message.imageId);
        if (!result.approved) {
          showAgentHud({
            title: 'Privacy Agent',
            status: 'Image transmission kept private by user.',
            canClose: true,
          });
          return { approved: false };
        }

        showAgentHud({
          title: 'Privacy Agent',
          status: 'Image locally redacted. Requesting agent response from gateway...',
          canClose: false,
        });

        const approvedContext = extractPageState();
        const finalResult = await browser.runtime.sendMessage({
          action: 'sendApprovedImage', ...result,
          userPrompt: message.userPrompt,
          pageContext: approvedContext,
        });

        handleFinalResult(message.userPrompt, finalResult, approvedContext.tier0Mapping);
        return finalResult;
      } catch (error) {
        const errText = String(error?.message || error);
        showAgentHud({
          title: 'Privacy Agent Error',
          message: errText,
          isError: true,
          canClose: true,
        });
        return { approved: false, error: errText };
      }
    })();
  }


  if (message.action === 'executeCommands') {
    return (async () => {
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
    })();
  }
});
