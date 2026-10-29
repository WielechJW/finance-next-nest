import { normalizeEmail } from './normalize-email.js';

describe('normalizeEmail', () => {
  it('normalizes surrounding whitespace and letter case', () => {
    expect(normalizeEmail('  ANNA@Example.com  ')).toBe('anna@example.com');
  });

  it('preserves dots and plus aliases', () => {
    expect(normalizeEmail('Anna.Kowalska+Finance@Example.com')).toBe(
      'anna.kowalska+finance@example.com',
    );
  });
});
