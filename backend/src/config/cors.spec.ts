import { getFrontendOrigin } from './cors.js';

describe('Frontend origin configuration', () => {
  it('defaults to the local Next.js origin', () => {
    expect(getFrontendOrigin({})).toBe('http://localhost:3000');
  });

  it('accepts an explicit HTTPS frontend origin', () => {
    expect(
      getFrontendOrigin({ FRONTEND_ORIGIN: 'https://finance.example.com/' }),
    ).toBe('https://finance.example.com');
  });

  it.each([
    '*',
    'invalid',
    'file:///tmp',
    'https://user:password@example.com',
    'https://example.com/path',
    'https://example.com?query=1',
  ])('rejects invalid origins (%#)', (FRONTEND_ORIGIN) => {
    expect(() => getFrontendOrigin({ FRONTEND_ORIGIN })).toThrow(
      'FRONTEND_ORIGIN',
    );
  });
});
