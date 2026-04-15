// background.js — service worker: orchestration hub

import { runConversation } from './lib/llm.js';
import { getSettings, getMatchingRules } from './lib/storage.js';

// Open side panel on action click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Enable side panel for all tabs
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'CHAT':
      handleChat(message, sendResponse);
      return true; // async

    case 'EXECUTE_TOOL':
      handleToolExecution(message, sendResponse);
      return true; // async

    case 'GET_MATCHING_RULES':
      handleGetMatchingRules(message, sendResponse);
      return true; // async

    case 'GET_CURRENT_CSS':
      handleGetCurrentCSS(sendResponse);
      return true; // async

    default:
      return false;
  }
});

// Handle SPA navigation — re-apply rules
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  const rules = await getMatchingRules(details.url);
  if (rules.length > 0) {
    const css = rules.map(r => r.css).join('\n\n');
    chrome.tabs.sendMessage(details.tabId, { type: 'AUTO_APPLY', css }).catch(() => {});
  }
});

async function handleChat(message, sendResponse) {
  try {
    const settings = await getSettings();
    const result = await runConversation(settings, message.messages, async (toolName, args) => {
      return executeToolOnTab(message.tabId, toolName, args);
    });
    sendResponse({ success: true, result });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function executeToolOnTab(tabId, toolName, args) {
  switch (toolName) {
    case 'inject_css': {
      await chrome.tabs.sendMessage(tabId, { type: 'INJECT_CSS', css: args.css });
      return { content: `CSS injected successfully (${args.css.length} chars)` };
    }

    case 'get_page_html': {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_HTML' });
      return { content: response.html };
    }

    case 'take_screenshot': {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      const base64 = dataUrl.replace('data:image/png;base64,', '');

      // Resize if too large (> 1MB base64)
      if (base64.length > 1_000_000) {
        const dataUrlJpeg = await chrome.tabs.captureVisibleTab(null, {
          format: 'jpeg',
          quality: 60,
        });
        const base64Jpeg = dataUrlJpeg.replace('data:image/jpeg;base64,', '');
        return { base64Image: base64Jpeg, content: 'Screenshot captured (compressed).' };
      }

      return { base64Image: base64, content: 'Screenshot captured.' };
    }

    default:
      return { content: `Unknown tool: ${toolName}` };
  }
}

async function handleToolExecution(message, sendResponse) {
  try {
    const result = await executeToolOnTab(message.tabId, message.toolName, message.args);
    sendResponse({ success: true, result });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetMatchingRules(message, sendResponse) {
  try {
    const rules = await getMatchingRules(message.url);
    if (rules.length > 0) {
      const css = rules.map(r => r.css).join('\n\n');
      sendResponse({ css });
    } else {
      sendResponse({ css: null });
    }
  } catch (error) {
    sendResponse({ css: null });
  }
}

async function handleGetCurrentCSS(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CSS' });
      sendResponse({ css: response.css });
    } else {
      sendResponse({ css: '' });
    }
  } catch (error) {
    sendResponse({ css: '' });
  }
}
