// background.js — service worker: orchestration hub

import { runConversation } from './lib/llm.js';
import { getSettings, getMatchingRules } from './lib/storage.js';

// Chrome opens the side panel on action click; we bind per-tab via setOptions
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Send message to tab, auto-injecting content script if not loaded
async function sendTabMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    // Content script not loaded — inject it and retry
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

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
    chrome.tabs.sendMessage(details.tabId, { type: 'AUTO_APPLY', css }).catch(() => {
      // Content script not loaded — inject and retry
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['content.js'],
      }).then(() => {
        chrome.tabs.sendMessage(details.tabId, { type: 'AUTO_APPLY', css }).catch(() => {});
      }).catch(() => {});
    });
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
      await sendTabMessage(tabId, { type: 'INJECT_CSS', css: args.css });
      return { content: `CSS injected successfully (${args.css.length} chars)` };
    }

    case 'get_page_structure': {
      const response = await sendTabMessage(tabId, {
        type: 'GET_PAGE_STRUCTURE',
        maxDepth: args.max_depth,
        rootSelector: args.root_selector,
      });
      return { content: JSON.stringify(response, null, 2) };
    }

    case 'query_selector': {
      const response = await sendTabMessage(tabId, {
        type: 'QUERY_SELECTOR',
        selector: args.selector,
        limit: args.limit,
      });
      return { content: JSON.stringify(response, null, 2) };
    }

    case 'get_element_details': {
      const response = await sendTabMessage(tabId, {
        type: 'GET_ELEMENT_DETAILS',
        selector: args.selector,
        includeChildren: args.include_children,
      });
      return { content: JSON.stringify(response, null, 2) };
    }

    case 'search_page_text': {
      const response = await sendTabMessage(tabId, {
        type: 'SEARCH_PAGE_TEXT',
        query: args.query,
        regex: args.regex,
        limit: args.limit,
      });
      return { content: JSON.stringify(response, null, 2) };
    }

    case 'search_page_attributes': {
      const response = await sendTabMessage(tabId, {
        type: 'SEARCH_PAGE_ATTRIBUTES',
        query: args.query,
        attribute: args.attribute,
        regex: args.regex,
        limit: args.limit,
      });
      return { content: JSON.stringify(response, null, 2) };
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
        return { base64Image: base64Jpeg, mediaType: 'image/jpeg', content: 'Screenshot captured (compressed).' };
      }

      return { base64Image: base64, mediaType: 'image/png', content: 'Screenshot captured.' };
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
      const response = await sendTabMessage(tab.id, { type: 'GET_CSS' });
      sendResponse({ css: response.css });
    } else {
      sendResponse({ css: '' });
    }
  } catch (error) {
    sendResponse({ css: '' });
  }
}
