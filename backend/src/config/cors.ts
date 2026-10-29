import './environment.js';

export function getFrontendOrigin(
  environment: Record<string, string | undefined> = process.env,
): string {
  const value = environment.FRONTEND_ORIGIN ?? 'http://localhost:3000';
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new Error('Invalid origin');
    }
    return url.origin;
  } catch {
    throw new Error(
      'FRONTEND_ORIGIN musi być poprawnym originem HTTP/HTTPS, np. http://localhost:3000.',
    );
  }
}
