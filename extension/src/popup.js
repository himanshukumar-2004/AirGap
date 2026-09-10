import browser from 'webextension-polyfill';

const runButton = document.getElementById('run');
const status = document.getElementById('status');
const resultBox = document.getElementById('result-box');
const resultBody = document.getElementById('result-body');
const resultActions = document.getElementById('result-actions');

runButton.addEventListener('click', async () => {
  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt) return;

  runButton.disabled = true;
  status.className = 'status';
  status.textContent = 'Sanitizing DOM & querying agent…';
  if (resultBox) resultBox.style.display = 'none';

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active browser tab found.');

    const result = await browser.tabs.sendMessage(tab.id, { action: 'runAgent', userPrompt: prompt });

    if (!result) {
      status.className = 'status error';
      status.textContent = 'No response received from agent.';
      return;
    }

    if (result.status === 'error') {
      status.className = 'status error';
      status.textContent = `Error: ${result.error || 'Unknown error'}`;
      return;
    }

    if (result.status === 'busy') {
      status.className = 'status warning';
      status.textContent = 'Another agent run is already active.';
      return;
    }

    if (result.status === 'blocked') {
      status.className = 'status warning';
      status.textContent = 'Action blocked by domain privacy policy.';
      return;
    }

    status.textContent = 'Agent run completed.';
    if (result.tier1Degraded) {
      status.className = 'status warning';
      status.textContent += ' ⚠ Name detection unavailable — only pattern-based PII was masked.';
    }

    let hasOutput = false;

    if (result.message) {
      resultBody.textContent = result.message;
      hasOutput = true;
    } else {
      resultBody.textContent = result.commands?.length > 0
        ? 'Commands executed successfully.'
        : 'Page analyzed. No actions required.';
      hasOutput = true;
    }

    if (result.commands && result.commands.length > 0) {
      const summaryList = result.commands.map((c, i) => `${i + 1}. ${c.action.toUpperCase()} on #${c.targetId}${c.value ? ` ("${c.value}")` : ''}`).join('\n');
      resultActions.textContent = `Actions:\n${summaryList}`;
      resultActions.style.display = 'block';
      hasOutput = true;
    } else {
      resultActions.style.display = 'none';
    }

    if (hasOutput && resultBox) {
      resultBox.style.display = 'block';
    }
  } catch (error) {
    status.className = 'status error';
    status.textContent = `Could not start: ${String(error?.message || error)}`;
  } finally {
    runButton.disabled = false;
  }
});

