const RULES = [
  { name: 'EMAIL', regex: /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/gu, predicate: isPersonalEmail },
  { name: 'CREDIT_CARD', regex: /\b(?:\d[ -]?){13,19}\b/gu, predicate: luhnCandidate },
  { name: 'AADHAAR', regex: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/gu },
  { name: 'PHONE', regex: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{5,10}/gu, predicate: plausiblePhone },
  { name: 'PAN', regex: /\b[A-Z]{5}\d{4}[A-Z]\b/giu },
  { name: 'PINCODE', regex: /\b[1-9]\d{5}\b/g },
  { name: 'SECRET', regex: /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|[A-Za-z0-9_-]{40,})\b/gu },
];

function isPersonalEmail(value) {
  const generic = /^(?:support|info|sales|contact|help|admin|hello|team|billing|careers|jobs|press|marketing|legal|privacy|security|inquiry|enquiry|feedback|service|customerservice|noreply|no-reply)@/i;
  return !generic.test(value);
}

function digits(value) { return value.replace(/\D/g, ''); }
function luhnCandidate(value) {
  const d = digits(value);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    let n = Number(d[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
function plausiblePhone(value) {
  const d = digits(value);
  return d.length >= 10 && d.length <= 13;
}

export function applyTier0Text(text, mapping = {}, counters = {}, valueToToken = new Map()) {
  let out = String(text ?? '');
  for (const rule of RULES) {
    rule.regex.lastIndex = 0;
    out = out.replace(rule.regex, (match) => {
      if (rule.predicate && !rule.predicate(match)) return match;
      if (/^\[[A-Z_]+(_\d+)?\]$/i.test(match)) return match;

      let token;
      if (valueToToken && valueToToken.has(match)) {
        token = valueToToken.get(match);
      } else {
        const n = (counters[rule.name] = (counters[rule.name] || 0) + 1);
        token = `[${rule.name}_${n}]`;
        if (valueToToken) valueToToken.set(match, token);
      }

      mapping[token] = match;
      const bareToken = `[${rule.name}]`;
      if (!mapping[bareToken]) {
        mapping[bareToken] = match;
      }

      return token;
    });
  }
  return out;
}

export function rehydrate(text, mapping) {
  if (typeof text !== 'string' || !text || !mapping) return text;
  let out = text;
  // Sort tokens by length descending so longer tokens ([PAN_1]) are replaced before prefix tokens ([PAN]).
  const tokens = Object.keys(mapping).sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    if (!token) continue;
    const val = mapping[token];
    if (typeof val !== 'string') continue;

    if (out.includes(token)) {
      out = out.split(token).join(val);
    }
    // Also match case-insensitively in case LLM outputs lowercase e.g. [pan_1] or [pan]
    const escaped = token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const rx = new RegExp(escaped, 'gi');
    if (rx.test(out)) {
      out = out.replace(rx, val);
    }
  }
  return out;
}

export function sanitizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.origin + u.pathname;
  } catch {
    return 'about:blank';
  }
}

export function containsSensitiveMarker(text) {
  return /\[(EMAIL|CREDIT_CARD|PHONE|AADHAAR|PAN|PINCODE|SECRET)(_\d+)?\]/iu.test(text);
}
