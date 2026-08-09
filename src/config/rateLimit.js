export function isNonApiRequest(request) {
  const url = request?.raw?.url || request?.url || '';
  return !/^\/api(?:[/?]|$)/.test(url);
}
