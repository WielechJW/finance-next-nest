import { describe, expect, it } from 'vitest';
import { csvCell, encodeCsv } from './csv-writer.js';

describe('investment CSV output', () => {
  it('quotes formulas, delimiters and control characters while preserving signed decimals', () => {
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell(' ＠SUM(1,2)')).toBe(`"' ＠SUM(1,2)"`);
    expect(csvCell('-123456789012345.67')).toBe('"-123456789012345.67"');
    expect(csvCell('tekst, "cytat"\r\nwiersz\tkolumna')).toBe(
      '"tekst, ""cytat""\\nwiersz\\tkolumna"',
    );
    expect(encodeCsv(['cash'], [{ cash: '0.01' }])).toBe(
      '\ufeff"cash"\r\n"0.01"\r\n',
    );
  });
});
