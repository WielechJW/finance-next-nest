export function setCookieHeaders(response: {
  headers: Record<string, string | string[] | undefined>;
}): string[] {
  const value = response.headers['set-cookie'];
  return Array.isArray(value) ? value : value ? [value] : [];
}
