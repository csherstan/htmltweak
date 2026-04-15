// content.js — CSS injection, DOM extraction, auto-apply
// IIFE because content scripts can't use ES modules in MV3

(function() {
  'use strict';

  const STYLE_ID = 'pagetweaker-injected';

  // Inject or replace CSS
  function injectCSS(css) {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = css;
  }

  // Remove injected CSS
  function removeCSS() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  // Get current injected CSS
  function getCurrentCSS() {
    const el = document.getElementById(STYLE_ID);
    return el ? el.textContent : '';
  }

  // Get truncated page HTML with scripts/styles stripped
  function getPageHTML() {
    const clone = document.documentElement.cloneNode(true);

    // Remove script and style elements
    const remove = clone.querySelectorAll('script, style, link[rel="stylesheet"], noscript, svg');
    remove.forEach(el => el.remove());

    // Remove our injected style
    const injected = clone.querySelector('#' + STYLE_ID);
    if (injected) injected.remove();

    // Remove common noise attributes
    const allElements = clone.querySelectorAll('*');
    allElements.forEach(el => {
      el.removeAttribute('data-reactid');
      el.removeAttribute('data-react-checksum');
      // Remove inline styles to reduce noise (CSS will override anyway)
      el.removeAttribute('style');
    });

    let html = clone.outerHTML;

    // Truncate to ~50KB
    const MAX_LENGTH = 50000;
    if (html.length > MAX_LENGTH) {
      html = html.substring(0, MAX_LENGTH) + '\n<!-- ... truncated -->';
    }

    return html;
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'INJECT_CSS':
        injectCSS(message.css);
        sendResponse({ success: true });
        break;

      case 'REMOVE_CSS':
        removeCSS();
        sendResponse({ success: true });
        break;

      case 'GET_CSS':
        sendResponse({ css: getCurrentCSS() });
        break;

      case 'GET_PAGE_HTML':
        sendResponse({ html: getPageHTML() });
        break;

      case 'AUTO_APPLY':
        if (message.css) {
          injectCSS(message.css);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false });
        }
        break;

      default:
        sendResponse({ error: 'Unknown message type' });
    }
    return true; // keep channel open for async response
  });

  // Request auto-apply rules on load
  chrome.runtime.sendMessage({
    type: 'GET_MATCHING_RULES',
    url: window.location.href,
  }, (response) => {
    if (chrome.runtime.lastError) return; // extension context invalidated
    if (response && response.css) {
      injectCSS(response.css);
    }
  });
})();
