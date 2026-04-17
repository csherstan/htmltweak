// background.js — service worker: orchestration hub

import { runConversation } from './lib/llm.js';
import { getSettings, getMatchingRules } from './lib/storage.js';

// Chrome opens the side panel on action click; we bind per-tab via setOptions
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Per-tab accumulated CSS from inject_css calls during a conversation.
// Each entry is an array of CSS strings; combined CSS is sent to the content script.
const tabCssState = new Map();

// Send message to tab, auto-injecting content script if not loaded
async function sendTabMessage(tabId, message) {
  try {
    console.log(`[htmltweak:bg] sendTabMessage tab=${tabId} type=${message.type}`);
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    // Content script not loaded — inject it and retry
    console.log(`[htmltweak:bg] sendTabMessage tab=${tabId} failed (${e.message}), injecting content script`);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    console.log(`[htmltweak:bg] sendTabMessage tab=${tabId} content script injected, retrying`);
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

// Handle messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const src = sender.tab ? `tab=${sender.tab.id}` : (sender.url?.includes('sidepanel') ? 'sidepanel' : 'extension');
  console.log(`[htmltweak:bg] onMessage type=${message.type} from=${src}`);
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
      console.log(`[htmltweak:bg] onMessage unknown type=${message.type}`);
      return false;
  }
});

// Clean up CSS state when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabCssState.delete(tabId);
});

// Reset accumulated CSS state on full page navigation (user navigated away)
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  tabCssState.delete(details.tabId);
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
    console.log(`[htmltweak:bg] handleChat provider=${settings.provider} model=${settings.model} messages=${message.messages.length} tabId=${message.tabId}`);
    const result = await runConversation(settings, message.messages, async (toolName, args) => {
      return executeToolOnTab(message.tabId, toolName, args);
    });
    console.log(`[htmltweak:bg] handleChat complete, result type=${result.type}`);
    sendResponse({ success: true, result });
  } catch (error) {
    console.error(`[htmltweak:bg] handleChat error:`, error.message);
    sendResponse({ success: false, error: error.message });
  }
}

async function executeToolOnTab(tabId, toolName, args) {
  console.log(`[htmltweak:bg] executeToolOnTab tab=${tabId} tool=${toolName} args=${JSON.stringify(args).slice(0, 200)}`);
  switch (toolName) {
    case 'inject_css': {
      if (args.replace) {
        // Explicit replace: wipe accumulated state and use only the new CSS
        tabCssState.set(tabId, [args.css]);
        console.log(`[htmltweak:bg] inject_css replace mode, wiped prior state`);
      } else {
        // Accumulate: append new CSS to existing state
        const existing = tabCssState.get(tabId) || [];
        existing.push(args.css);
        tabCssState.set(tabId, existing);
      }
      const combined = tabCssState.get(tabId).join('\n\n');
      await sendTabMessage(tabId, { type: 'INJECT_CSS', css: combined });
      console.log(`[htmltweak:bg] inject_css complete, ${args.css.length} new chars, ${combined.length} total chars`);
      return { content: `CSS injected successfully (${args.css.length} new chars, ${combined.length} total accumulated chars)` };
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
      console.log(`[htmltweak:bg] take_screenshot capturing tab`);
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      const base64 = dataUrl.replace('data:image/png;base64,', '');
      console.log(`[htmltweak:bg] take_screenshot captured, base64 length=${base64.length}`);

      // Resize if too large (> 1MB base64)
      if (base64.length > 1_000_000) {
        console.log(`[htmltweak:bg] take_screenshot compressing to jpeg (base64 > 1MB)`);
        const dataUrlJpeg = await chrome.tabs.captureVisibleTab(null, {
          format: 'jpeg',
          quality: 60,
        });
        const base64Jpeg = dataUrlJpeg.replace('data:image/jpeg;base64,', '');
        return { base64Image: base64Jpeg, mediaType: 'image/jpeg', content: 'Screenshot captured (compressed).' };
      }

      return { base64Image: base64, mediaType: 'image/png', content: 'Screenshot captured.' };
    }

    case 'reply': {
      // reply is handled in the LLM loop — just acknowledge here
      console.log(`[htmltweak:bg] reply tool called: ${(args.text || '').slice(0, 200)}`);
      return { content: 'Reply delivered.' };
    }

    case 'status_update': {
      // Send status update to sidepanel for live display
      console.log(`[htmltweak:bg] status_update: ${(args.text || '').slice(0, 200)}`);
      chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', text: args.text }).catch(() => {
        // Sidepanel may not be listening — that's fine
      });
      return { content: 'Status update sent.' };
    }

    default:
      console.warn(`[htmltweak:bg] executeToolOnTab unknown tool: ${toolName}`);
      return { content: `Unknown tool: ${toolName}` };
  }
}

async function handleToolExecution(message, sendResponse) {
  try {
    console.log(`[htmltweak:bg] handleToolExecution tool=${message.toolName} tab=${message.tabId}`);
    const result = await executeToolOnTab(message.tabId, message.toolName, message.args);
    sendResponse({ success: true, result });
  } catch (error) {
    console.error(`[htmltweak:bg] handleToolExecution error:`, error.message);
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
    console.log(`[htmltweak:bg] handleGetCurrentCSS activeTab=${tab?.id || 'none'}`);
    if (tab) {
      const response = await sendTabMessage(tab.id, { type: 'GET_CSS' });
      console.log(`[htmltweak:bg] handleGetCurrentCSS got css length=${response.css?.length || 0}`);
      sendResponse({ css: response.css });
    } else {
      sendResponse({ css: '' });
    }
  } catch (error) {
    console.error(`[htmltweak:bg] handleGetCurrentCSS error:`, error.message);
    sendResponse({ css: '' });
  }
}
