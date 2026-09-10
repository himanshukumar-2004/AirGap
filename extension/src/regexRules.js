const RULES = [
  { name: 'EMAIL', regex: /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/gu },
  { name: 'CREDIT_CARD', regex: /\b(?:\d[ -]?){13,19}\b/gu, predicate: luhnCandidate },
  { name: 'AADHAAR', regex: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/gu },
  { name: 'PHONE', regex: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{5,10}/gu, predicate: plausiblePhone },
  { name: 'PAN', regex: /\b[A-Z]{5}\d{4}[A-Z]\b/gu },
  { name: 'PINCODE', regex: /\b[1-9]\d{5}\b/g },
  { name: 'SECRET', regex: /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|[A-Za-z0-9_-]{40,})\b/gu },
];

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

export function applyTier0Text(text) {
  let out = String(text ?? '');
  for (const rule of RULES) {
    out = out.replace(rule.regex, (match) => {
      if (rule.predicate && !rule.predicate(match)) return match;
      return `[${rule.name}]`;
    });
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
  return /\[(EMAIL|CREDIT_CARD|PHONE|AADHAAR|PAN|PINCODE|SECRET)\]/u.test(text);
}
