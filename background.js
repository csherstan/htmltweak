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

// Handle full page loads (including reloads) — auto-apply saved rules
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  console.log('[htmltweak:bg] onCompleted fired for URL:', details.url, 'tabId:', details.tabId);
  const rules = await getMatchingRules(details.url);
  console.log('[htmltweak:bg] onCompleted matched rules:', rules.length, rules.map(r => ({ id: r.id, urlPattern: r.urlPattern, enabled: r.enabled, cssLen: r.css?.length })));
  if (rules.length > 0) {
    const css = rules.map(r => r.css).join('\n\n');
    console.log('[htmltweak:bg] onCompleted sending AUTO_APPLY, css length:', css.length);
    chrome.tabs.sendMessage(details.tabId, { type: 'AUTO_APPLY', css }).catch((err) => {
      console.log('[htmltweak:bg] onCompleted sendMessage failed, injecting content script:', err.message);
      // Content script not loaded — inject and retry
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['content.js'],
      }).then(() => {
        console.log('[htmltweak:bg] onCompleted content script injected, retrying AUTO_APPLY');
        chrome.tabs.sendMessage(details.tabId, { type: 'AUTO_APPLY', css }).catch((err2) => {
          console.log('[htmltweak:bg] onCompleted retry AUTO_APPLY failed:', err2.message);
        });
      }).catch((err2) => {
        console.log('[htmltweak:bg] onCompleted content script injection failed:', err2.message);
      });
    });
  } else {
    console.log('[htmltweak:bg] onCompleted no matching rules for URL:', details.url);
  }
});

// Handle SPA navigation — re-apply rules
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  console.log('[htmltweak:bg] onHistoryStateUpdated fired for URL:', details.url, 'tabId:', details.tabId);
  const rules = await getMatchingRules(details.url);
  console.log('[htmltweak:bg] onHistoryStateUpdated matched rules:', rules.length, rules.map(r => ({ id: r.id, urlPattern: r.urlPattern, enabled: r.enabled, cssLen: r.css?.length })));
  if (rules.length > 0) {
    const css = rules.map(r => r.css).join('\n\n');
    console.log('[htmltweak:bg] onHistoryStateUpdated sending AUTO_APPLY, css length:', css.length);
    chrome.tabs.sendMessage(details.tabId, { type: 'AUTO_APPLY', css }).catch((err) => {
      console.log('[htmltweak:bg] onHistoryStateUpdated sendMessage failed, injecting content script:', err.message);
      // Content script not loaded — inject and retry
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['content.js'],
      }).then(() => {
        console.log('[htmltweak:bg] onHistoryStateUpdated content script injected, retrying AUTO_APPLY');
        chrome.tabs.sendMessage(details.tabId, { type: 'AUTO_APPLY', css }).catch((err2) => {
          console.log('[htmltweak:bg] onHistoryStateUpdated retry AUTO_APPLY failed:', err2.message);
        });
      }).catch((err2) => {
        console.log('[htmltweak:bg] onHistoryStateUpdated content script injection failed:', err2.message);
      });
    });
  } else {
    console.log('[htmltweak:bg] onHistoryStateUpdated no matching rules for URL:', details.url);
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
    console.log('[htmltweak:bg] handleGetMatchingRules called for URL:', message.url);
    const rules = await getMatchingRules(message.url);
    console.log('[htmltweak:bg] handleGetMatchingRules matched rules:', rules.length, rules.map(r => ({ id: r.id, urlPattern: r.urlPattern, enabled: r.enabled, cssLen: r.css?.length })));
    if (rules.length > 0) {
      const css = rules.map(r => r.css).join('\n\n');
      console.log('[htmltweak:bg] handleGetMatchingRules responding with css length:', css.length);
      sendResponse({ css });
    } else {
      console.log('[htmltweak:bg] handleGetMatchingRules no matching rules, responding with null');
      sendResponse({ css: null });
    }
  } catch (error) {
    console.log('[htmltweak:bg] handleGetMatchingRules error:', error.message);
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
