/**
 * Safely parse a JSON string, returning a fallback value on failure
 * instead of throwing and crashing the server.
 */
export function safeParse(str, fallback = null) {
  if (str == null) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
