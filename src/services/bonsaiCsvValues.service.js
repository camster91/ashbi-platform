function normalizedNumber(value, fractionPattern) {
  const raw = String(value ?? '').trim();
  const valid = raw.includes(',')
    ? new RegExp(`^-?\\d{1,3}(?:,\\d{3})+(?:\\.${fractionPattern})?$`).test(raw)
    : new RegExp(`^-?\\d+(?:\\.${fractionPattern})?$`).test(raw);
  return valid ? raw.replace(/,/g, '') : null;
}

export function parseBonsaiMoney(value) {
  const normalized = normalizedNumber(value, '\\d{1,2}');
  if (normalized === null) return null;
  const sign = normalized.startsWith('-') ? -1 : 1;
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const minor = sign * ((Number(whole) * 100) + Number(fraction.padEnd(2, '0')));
  return Number.isSafeInteger(minor) ? minor / 100 : null;
}

export function parseBonsaiDecimal(value) {
  const normalized = normalizedNumber(value, '\\d+');
  if (normalized === null) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
