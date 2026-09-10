import browser from 'webextension-polyfill';

const runButton = document.getElementById('run');
const status = document.getElementById('status');
const resultBox = document.getElementById('result-box');
const resultBody = document.getElementById('result-body');
const resultActions = document.getElementById('result-actions');

function renderSavedRun(run) {
  if (!run) return;
  if (run.prompt) {
    const promptInput = document.getElementById('prompt');
    if (promptInput && !promptInput.value) {
      promptInput.value = run.prompt;
    }
  }

  if (run.status === 'error') {
    status.className = 'status error';
    status.textContent = `Error: ${run.error || 'Unknown error'}`;
    return;
  }

  if (run.status === 'blocked') {
    status.className = 'status warning';
    status.textContent = 'Action blocked by domain privacy policy.';
    return;
  }

  if (run.status === 'denied') {
    status.className = 'status warning';
    status.textContent = 'Image transmission was kept private by user.';
    return;
  }

  if (run.status === 'completed') {
    status.className = 'status';
    status.textContent = 'Agent run completed.';
    if (run.tier1Degraded) {
      status.className = 'status warning';
      status.textContent += ' ⚠ Name detection unavailable — only pattern PII masked.';
    }

    if (run.message) {
      resultBody.textContent = run.message;
    } else {
      resultBody.textContent = run.commands?.length > 0
        ? 'Commands executed successfully.'
        : 'Page analyzed. No actions required.';
    }

    if (run.commands && run.commands.length > 0) {
      const summaryList = run.commands.map((c, i) => `${i + 1}. ${c.action.toUpperCase()} on #${c.targetId}${c.value ? ` ("${c.value}")` : ''}`).join('\n');
      resultActions.textContent = `Actions:\n${summaryList}`;
      resultActions.style.display = 'block';
    } else {
      resultActions.style.display = 'none';
    }

    if (resultBox) resultBox.style.display = 'block';
  }
}

// Load previous run if available on popup open
chrome.storage.local.get(['lastAgentRun']).then((data) => {
  if (data?.lastAgentRun) {
    renderSavedRun(data.lastAgentRun);
  }
});

// Listen for storage updates in real-time if popup is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.lastAgentRun?.newValue) {
    renderSavedRun(changes.lastAgentRun.newValue);
    runButton.disabled = false;
  }
});

runButton.addEventListener('click', async () => {
  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt) return;

  runButton.disabled = true;
  status.className = 'status';
  status.textContent = 'Agent run started. Check on-page status or keep popup open…';
  if (resultBox) resultBox.style.display = 'none';

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active browser tab found.');

    const result = await browser.tabs.sendMessage(tab.id, { action: 'runAgent', userPrompt: prompt });

    if (result?.status === 'busy') {
      status.className = 'status warning';
      status.textContent = 'Another agent run is already active.';
      runButton.disabled = false;
      return;
    }

    if (result?.status === 'error') {
      status.className = 'status error';
      status.textContent = `Error: ${result.error || 'Unknown error'}`;
      runButton.disabled = false;
      return;
    }
  } catch (error) {
    status.className = 'status error';
    status.textContent = `Could not start: ${String(error?.message || error)}`;
    runButton.disabled = false;
  }
});


