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

  // Build a unique CSS selector path for an element
  function selectorPath(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur !== document.documentElement) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift('#' + CSS.escape(cur.id));
        break;
      }
      if (cur.parentElement) {
        const siblings = Array.from(cur.parentElement.children).filter(
          c => c.tagName === cur.tagName
        );
        if (siblings.length > 1) {
          seg += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
        }
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // Compact text preview (collapse whitespace, truncate)
  function textPreview(el, maxLen = 80) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLen ? text.substring(0, maxLen) + '…' : text;
  }

  // Get page structure as a compact tree
  function getPageStructure(maxDepth = 6, rootSelector = 'body') {
    const root = document.querySelector(rootSelector);
    if (!root) return { error: `No element matches "${rootSelector}"` };

    function walk(el, depth) {
      if (depth > maxDepth) return null;
      // Skip our injected style, scripts, and hidden elements
      if (el.id === STYLE_ID) return null;
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg') return null;

      const node = { tag };
      if (el.id) node.id = el.id;
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim();
        if (classes) node.classes = classes.split(/\s+/).slice(0, 5).join(' ');
      }
      const role = el.getAttribute('role');
      if (role) node.role = role;

      const childNodes = [];
      for (const child of el.children) {
        const c = walk(child, depth + 1);
        if (c) childNodes.push(c);
      }
      if (childNodes.length > 0) node.children = childNodes;

      return node;
    }

    return walk(root, 0);
  }

  // Query selector and return matching elements with summaries
  function querySelector(selector, limit = 20) {
    let els;
    try {
      els = document.querySelectorAll(selector);
    } catch (e) {
      return { error: `Invalid selector: ${e.message}` };
    }

    const results = [];
    const count = Math.min(els.length, limit);
    for (let i = 0; i < count; i++) {
      const el = els[i];
      const entry = {
        index: i,
        tag: el.tagName.toLowerCase(),
        selector: selectorPath(el),
        text: textPreview(el),
      };
      if (el.id) entry.id = el.id;
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim();
        if (classes) entry.classes = classes;
      }
      results.push(entry);
    }

    return { total: els.length, returned: count, results };
  }

  // Get detailed info about a specific element
  function getElementDetails(selector, includeChildren = true) {
    let el;
    try {
      el = document.querySelector(selector);
    } catch (e) {
      return { error: `Invalid selector: ${e.message}` };
    }
    if (!el) return { error: `No element matches "${selector}"` };

    const computed = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    const details = {
      tag: el.tagName.toLowerCase(),
      selector: selectorPath(el),
      attributes: {},
      dimensions: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
      },
      computedStyle: {
        display: computed.display,
        position: computed.position,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        fontSize: computed.fontSize,
        fontFamily: computed.fontFamily,
        margin: computed.margin,
        padding: computed.padding,
        border: computed.border,
        overflow: computed.overflow,
        visibility: computed.visibility,
        opacity: computed.opacity,
        zIndex: computed.zIndex,
        flexDirection: computed.flexDirection,
        justifyContent: computed.justifyContent,
        alignItems: computed.alignItems,
        gridTemplateColumns: computed.gridTemplateColumns,
      },
      text: textPreview(el, 200),
    };

    // Collect all attributes
    for (const attr of el.attributes) {
      details.attributes[attr.name] = attr.value;
    }

    // Inner HTML preview
    const innerHtml = el.innerHTML;
    if (innerHtml.length <= 500) {
      details.innerHTML = innerHtml;
    } else {
      details.innerHTML = innerHtml.substring(0, 500) + '… (truncated)';
    }

    // Direct children summary
    if (includeChildren) {
      details.children = Array.from(el.children).slice(0, 30).map(child => {
        const c = { tag: child.tagName.toLowerCase() };
        if (child.id) c.id = child.id;
        if (child.className && typeof child.className === 'string') {
          const classes = child.className.trim();
          if (classes) c.classes = classes;
        }
        c.text = textPreview(child, 60);
        return c;
      });
      if (el.children.length > 30) {
        details.childrenTotal = el.children.length;
      }
    }

    return details;
  }

  // Search visible text content on the page
  function searchPageText(query, useRegex = false, limit = 20) {
    let matcher;
    if (useRegex) {
      try {
        matcher = new RegExp(query, 'i');
      } catch (e) {
        return { error: `Invalid regex: ${e.message}` };
      }
    }

    const results = [];
    // Walk text-containing elements (skip script, style, etc.)
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          const tag = node.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg') {
            return NodeFilter.FILTER_REJECT;
          }
          if (node.id === STYLE_ID) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    while (walker.nextNode() && results.length < limit) {
      const el = walker.currentNode;
      // Only match on the element's own direct text (not descendant text)
      const ownText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

      if (!ownText) continue;

      const matches = useRegex
        ? matcher.test(ownText)
        : ownText.toLowerCase().includes(query.toLowerCase());

      if (matches) {
        const entry = {
          tag: el.tagName.toLowerCase(),
          selector: selectorPath(el),
          text: ownText.length > 200 ? ownText.substring(0, 200) + '…' : ownText,
        };
        if (el.id) entry.id = el.id;
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim();
          if (classes) entry.classes = classes;
        }
        results.push(entry);
      }
    }

    return { total: results.length, results };
  }

  // Search element attributes on the page
  function searchPageAttributes(query, attribute = null, useRegex = false, limit = 20) {
    let matcher;
    if (useRegex) {
      try {
        matcher = new RegExp(query, 'i');
      } catch (e) {
        return { error: `Invalid regex: ${e.message}` };
      }
    }

    const queryLower = query.toLowerCase();
    const results = [];
    const allEls = document.body.querySelectorAll('*');

    for (const el of allEls) {
      if (results.length >= limit) break;
      if (el.id === STYLE_ID) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg') continue;

      for (const attr of el.attributes) {
        if (attribute && attr.name !== attribute) continue;

        const nameMatch = useRegex
          ? matcher.test(attr.name)
          : attr.name.toLowerCase().includes(queryLower);
        const valueMatch = useRegex
          ? matcher.test(attr.value)
          : attr.value.toLowerCase().includes(queryLower);

        if (nameMatch || valueMatch) {
          const entry = {
            tag,
            selector: selectorPath(el),
            attribute: attr.name,
            value: attr.value.length > 200 ? attr.value.substring(0, 200) + '…' : attr.value,
          };
          if (el.id) entry.id = el.id;
          results.push(entry);
          break; // one match per element is enough
        }
      }
    }

    return { total: results.length, results };
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

      case 'GET_PAGE_STRUCTURE':
        sendResponse(getPageStructure(message.maxDepth, message.rootSelector));
        break;

      case 'QUERY_SELECTOR':
        sendResponse(querySelector(message.selector, message.limit));
        break;

      case 'GET_ELEMENT_DETAILS':
        sendResponse(getElementDetails(message.selector, message.includeChildren));
        break;

      case 'SEARCH_PAGE_TEXT':
        sendResponse(searchPageText(message.query, message.regex, message.limit));
        break;

      case 'SEARCH_PAGE_ATTRIBUTES':
        sendResponse(searchPageAttributes(message.query, message.attribute, message.regex, message.limit));
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
