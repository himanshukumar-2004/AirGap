import browser from 'webextension-polyfill';

const runButton = document.getElementById('run');
const status = document.getElementById('status');

runButton.addEventListener('click', async () => {
  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt) return;
  runButton.disabled = true;
  status.textContent = 'Reading page locally…';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const result = await browser.tabs.sendMessage(tab.id, { action: 'runAgent', userPrompt: prompt });
    status.textContent = result?.status === 'error' ? `Error: ${result.error}` : 'Agent run started.';
    if (result?.status === 'busy') status.textContent = 'Another agent run is already active.';
    // popup.js
    if (result?.tier1Degraded) {
      status.textContent += ' ⚠ Name detection unavailable this run — only pattern-based PII was masked.';
    }
  } catch (error) {
    status.textContent = `Could not start: ${String(error)}`;
  } finally {
    runButton.disabled = false;
  }
});
