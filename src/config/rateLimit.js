export function isNonApiRequest(request) {
  const url = request?.raw?.url || request?.url || '';
  return !/^\/api(?:[/?]|$)/.test(url) || /^\/api\/(?:health|live)(?:[?]|$)/.test(url);
}
