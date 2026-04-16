// sidepanel.js — chat UI logic

import { getSettings, saveRule, generateUrlPattern } from '../lib/storage.js';

const messagesEl = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const settingsBtn = document.getElementById('settings-btn');
const saveRuleBtn = document.getElementById('save-rule-btn');
const saveBar = document.getElementById('save-bar');
const savePattern = document.getElementById('save-pattern');
const saveConfirm = document.getElementById('save-confirm');
const saveCancel = document.getElementById('save-cancel');

// Chat state (held in side panel, survives service worker termination)
let chatMessages = []; // messages in LLM API format
let currentCSS = ''; // last injected CSS
let isProcessing = false;

// Get the active tab ID
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// Get the active tab URL
async function getActiveTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || '';
}

// Add a message bubble to the UI
function addMessageBubble(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = content;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

// Add a tool call indicator
function addToolIndicator(toolName) {
  const labels = {
    inject_css: 'Injecting CSS...',
    get_page_html: 'Reading page structure...',
    take_screenshot: 'Taking screenshot...',
  };
  return addMessageBubble('tool-indicator', labels[toolName] || `Running ${toolName}...`);
}

// Send a chat message
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isProcessing) return;

  isProcessing = true;
  sendBtn.disabled = true;
  userInput.value = '';

  addMessageBubble('user', text);
  chatMessages.push({ role: 'user', content: text });
  console.log(`[htmltweak:sidepanel] sendMessage: "${text.slice(0, 100)}" (${chatMessages.length} messages in history)`);

  const loadingEl = addMessageBubble('assistant', 'Thinking');
  loadingEl.classList.add('loading-dots');

  try {
    const tabId = await getActiveTabId();
    if (!tabId) throw new Error('No active tab found');

    // Check if the tab is a chrome:// or extension page
    const url = await getActiveTabUrl();
    console.log(`[htmltweak:sidepanel] sendMessage targeting tab=${tabId} url=${url.slice(0, 100)}`);
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      throw new Error('PageTweaker cannot modify Chrome internal pages (chrome:// URLs).');
    }

    const response = await chrome.runtime.sendMessage({
      type: 'CHAT',
      messages: chatMessages,
      tabId: tabId,
    });

    loadingEl.remove();

    if (!response.success) {
      throw new Error(response.error);
    }

    const assistantText = response.result.content;
    console.log(`[htmltweak:sidepanel] sendMessage response: "${assistantText?.slice(0, 200)}"`);
    addMessageBubble('assistant', assistantText);
    chatMessages.push({ role: 'assistant', content: assistantText });

    // Enable save button if we have CSS
    updateSaveButton();

  } catch (error) {
    loadingEl.remove();
    console.error(`[htmltweak:sidepanel] sendMessage error:`, error.message);
    addMessageBubble('error', `Error: ${error.message}`);
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    userInput.focus();
  }
}

// Update save button state
async function updateSaveButton() {
  try {
    const tabId = await getActiveTabId();
    if (!tabId) return;
    // Use runtime message to background to get CSS (avoids direct tab messaging issues)
    const response = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_CSS' });
    currentCSS = response.css || '';
    console.log(`[htmltweak:sidepanel] updateSaveButton css length=${currentCSS.length}`);
    saveRuleBtn.disabled = !currentCSS;
  } catch {
    saveRuleBtn.disabled = true;
  }
}

// Show save rule bar
async function showSaveBar() {
  const url = await getActiveTabUrl();
  savePattern.value = generateUrlPattern(url);
  saveBar.classList.remove('hidden');
  savePattern.focus();
}

// Confirm save rule
async function confirmSaveRule() {
  const pattern = savePattern.value.trim();
  if (!pattern || !currentCSS) return;

  try {
    console.log(`[htmltweak:sidepanel] confirmSaveRule pattern="${pattern}" css length=${currentCSS.length}`);
    await saveRule({
      urlPattern: pattern,
      css: currentCSS,
    });
    saveBar.classList.add('hidden');
    addMessageBubble('tool-indicator', `Rule saved for pattern: ${pattern}`);
  } catch (error) {
    console.error(`[htmltweak:sidepanel] confirmSaveRule error:`, error.message);
    addMessageBubble('error', `Failed to save rule: ${error.message}`);
  }
}

// Event listeners
sendBtn.addEventListener('click', sendMessage);

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

saveRuleBtn.addEventListener('click', showSaveBar);
saveConfirm.addEventListener('click', confirmSaveRule);
saveCancel.addEventListener('click', () => {
  saveBar.classList.add('hidden');
});

savePattern.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    confirmSaveRule();
  }
  if (e.key === 'Escape') {
    saveBar.classList.add('hidden');
  }
});

// Initial state check
console.log('[htmltweak:sidepanel] initialized');
updateSaveButton();
