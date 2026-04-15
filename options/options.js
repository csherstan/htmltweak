// options.js — settings and rules management

import { getSettings, saveSettings, getRules, saveRule, deleteRule, toggleRule } from '../lib/storage.js';

const PROVIDER_DEFAULTS = {
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2-vision', needsKey: false },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', needsKey: true },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4-20250514', needsKey: true },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514', needsKey: true },
};

// Elements
const providerEl = document.getElementById('provider');
const baseUrlEl = document.getElementById('base-url');
const apiKeyEl = document.getElementById('api-key');
const apiKeyGroup = document.getElementById('api-key-group');
const modelEl = document.getElementById('model');
const saveSettingsBtn = document.getElementById('save-settings');
const testConnectionBtn = document.getElementById('test-connection');
const testResultEl = document.getElementById('test-result');

const rulesBody = document.getElementById('rules-body');
const noRules = document.getElementById('no-rules');
const exportBtn = document.getElementById('export-rules');
const importInput = document.getElementById('import-rules-file');

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`${tab.dataset.tab}-panel`).classList.remove('hidden');
  });
});

// Load settings
async function loadSettings() {
  const settings = await getSettings();
  providerEl.value = settings.provider;
  baseUrlEl.value = settings.baseUrl;
  apiKeyEl.value = settings.apiKey;
  modelEl.value = settings.model;
  updateApiKeyVisibility(settings.provider);
}

function updateApiKeyVisibility(provider) {
  const defaults = PROVIDER_DEFAULTS[provider];
  apiKeyGroup.style.display = defaults.needsKey ? 'block' : 'none';
}

// Provider change updates defaults
providerEl.addEventListener('change', () => {
  const defaults = PROVIDER_DEFAULTS[providerEl.value];
  baseUrlEl.value = defaults.baseUrl;
  modelEl.value = defaults.model;
  updateApiKeyVisibility(providerEl.value);
});

// Save settings
saveSettingsBtn.addEventListener('click', async () => {
  await saveSettings({
    provider: providerEl.value,
    baseUrl: baseUrlEl.value.replace(/\/+$/, ''), // strip trailing slash
    apiKey: apiKeyEl.value,
    model: modelEl.value,
  });
  showTestResult('Settings saved!', 'success');
});

// Test connection
testConnectionBtn.addEventListener('click', async () => {
  testResultEl.className = 'test-result';
  testResultEl.textContent = 'Testing...';
  testResultEl.classList.remove('hidden');

  try {
    const settings = {
      provider: providerEl.value,
      baseUrl: baseUrlEl.value.replace(/\/+$/, ''),
      apiKey: apiKeyEl.value,
      model: modelEl.value,
    };

    let url, headers;
    if (settings.provider === 'anthropic') {
      url = `${settings.baseUrl}/messages`;
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: settings.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      if (response.ok || response.status === 400) {
        showTestResult('Connection successful!', 'success');
      } else {
        const text = await response.text();
        showTestResult(`Connection failed (${response.status}): ${text}`, 'error');
      }
    } else {
      url = `${settings.baseUrl}/models`;
      headers = { 'Content-Type': 'application/json' };
      if (settings.apiKey) {
        headers['Authorization'] = `Bearer ${settings.apiKey}`;
      }
      const response = await fetch(url, { headers });
      if (response.ok) {
        showTestResult('Connection successful!', 'success');
      } else {
        const text = await response.text();
        showTestResult(`Connection failed (${response.status}): ${text}`, 'error');
      }
    }
  } catch (error) {
    showTestResult(`Connection failed: ${error.message}`, 'error');
  }
});

function showTestResult(message, type) {
  testResultEl.textContent = message;
  testResultEl.className = `test-result ${type}`;
  testResultEl.classList.remove('hidden');
}

// Rules management
async function loadRules() {
  const rules = await getRules();
  renderRules(rules);
}

function renderRules(rules) {
  rulesBody.innerHTML = '';

  if (rules.length === 0) {
    noRules.style.display = 'block';
    document.getElementById('rules-table').style.display = 'none';
    return;
  }

  noRules.style.display = 'none';
  document.getElementById('rules-table').style.display = 'table';

  for (const rule of rules) {
    const tr = document.createElement('tr');

    // Enabled toggle
    const tdEnabled = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = rule.enabled;
    checkbox.addEventListener('change', async () => {
      await toggleRule(rule.id);
      loadRules();
    });
    tdEnabled.appendChild(checkbox);

    // URL pattern
    const tdPattern = document.createElement('td');
    const patternInput = document.createElement('input');
    patternInput.type = 'text';
    patternInput.value = rule.urlPattern;
    patternInput.addEventListener('change', async () => {
      await saveRule({ ...rule, urlPattern: patternInput.value });
      loadRules();
    });
    tdPattern.appendChild(patternInput);

    // CSS
    const tdCSS = document.createElement('td');
    const cssArea = document.createElement('textarea');
    cssArea.value = rule.css;
    cssArea.addEventListener('change', async () => {
      await saveRule({ ...rule, css: cssArea.value });
      loadRules();
    });
    tdCSS.appendChild(cssArea);

    // Actions
    const tdActions = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      await deleteRule(rule.id);
      loadRules();
    });
    tdActions.appendChild(deleteBtn);

    tr.appendChild(tdEnabled);
    tr.appendChild(tdPattern);
    tr.appendChild(tdCSS);
    tr.appendChild(tdActions);
    rulesBody.appendChild(tr);
  }
}

// Export rules
exportBtn.addEventListener('click', async () => {
  const rules = await getRules();
  const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pagetweaker-rules.json';
  a.click();
  URL.revokeObjectURL(url);
});

// Import rules
importInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error('Invalid format');

    for (const rule of imported) {
      await saveRule({
        urlPattern: rule.urlPattern,
        css: rule.css,
        enabled: rule.enabled !== false,
      });
    }

    loadRules();
    showTestResult(`Imported ${imported.length} rules`, 'success');
  } catch (error) {
    showTestResult(`Import failed: ${error.message}`, 'error');
  }

  importInput.value = '';
});

// Initialize
loadSettings();
loadRules();
