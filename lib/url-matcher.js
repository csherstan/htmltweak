// url-matcher.js — URL pattern matching utilities

export function matchesPattern(pattern, url) {
  try {
    const regex = patternToRegex(pattern);
    return regex.test(url);
  } catch {
    return false;
  }
}

function patternToRegex(pattern) {
  let regex = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp('^' + regex + '$');
}
