// storage.js — chrome.storage.local CRUD for rules & settings

const SETTINGS_KEY = 'pagetweaker_settings';
const RULES_KEY = 'pagetweaker_rules';

const DEFAULT_SETTINGS = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'llama3.2-vision',
};

export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getRules() {
  const result = await chrome.storage.local.get(RULES_KEY);
  return result[RULES_KEY] || [];
}

export async function saveRule(rule) {
  const rules = await getRules();
  const existing = rules.findIndex(r => r.id === rule.id);
  if (existing >= 0) {
    rules[existing] = { ...rules[existing], ...rule, updatedAt: Date.now() };
  } else {
    rules.push({
      id: crypto.randomUUID(),
      urlPattern: rule.urlPattern,
      css: rule.css,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...rule,
    });
  }
  await chrome.storage.local.set({ [RULES_KEY]: rules });
  return rules;
}

export async function deleteRule(id) {
  const rules = await getRules();
  const filtered = rules.filter(r => r.id !== id);
  await chrome.storage.local.set({ [RULES_KEY]: filtered });
  return filtered;
}

export async function toggleRule(id) {
  const rules = await getRules();
  const rule = rules.find(r => r.id === id);
  if (rule) {
    rule.enabled = !rule.enabled;
    rule.updatedAt = Date.now();
    await chrome.storage.local.set({ [RULES_KEY]: rules });
  }
  return rules;
}

export async function getMatchingRules(url) {
  const rules = await getRules();
  const matching = rules.filter(r => r.enabled && matchesPattern(r.urlPattern, url));
  console.log(`[htmltweak:storage] getMatchingRules url="${url.slice(0, 100)}" total=${rules.length} enabled=${rules.filter(r => r.enabled).length} matched=${matching.length}`);
  return matching;
}

function matchesPattern(pattern, url) {
  try {
    const regex = patternToRegex(pattern);
    return regex.test(url);
  } catch {
    return false;
  }
}

function patternToRegex(pattern) {
  // Convert match patterns like *://example.com/* to regex
  let regex = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // escape special regex chars (except *)
    .replace(/\*/g, '.*');                    // convert * to .*
  return new RegExp('^' + regex + '$');
}

export function generateUrlPattern(url) {
  try {
    const u = new URL(url);
    return `*://${u.hostname}/*`;
  } catch {
    return '*://*/*';
  }
}
